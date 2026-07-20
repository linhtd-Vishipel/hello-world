"""FastAPI dependencies for enforcing role-based permissions.

`get_current_user` is a stand-in for real authentication (e.g. decoding a
JWT). It trusts `X-User-Role` / `X-User-Id` / `X-Branch-Id` headers so the
permission layer can be exercised without wiring up a full auth system.
Replace it with real token verification before deploying.
"""
from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from app.permissions import CurrentUser, check_access, has_permission
from app.roles import Action, Module, Role, Scope


def get_current_user(
    x_user_id: int = Header(...),
    x_user_role: Role = Header(...),
    x_branch_id: Optional[int] = Header(None),
) -> CurrentUser:
    return CurrentUser(id=x_user_id, role=x_user_role, branch_id=x_branch_id)


def require_permission(module: Module, action: Action):
    """Dependency factory: 403s unless the user's role grants any access
    to `action` on `module`. Use for endpoints with no single target
    resource (e.g. create, or list endpoints where the handler must still
    filter results by scope).
    """

    def _check(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if has_permission(user.role, module, action) == Scope.NONE:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' cannot {action} {module}",
            )
        return user

    return _check


def require_object_access(user: CurrentUser, module: Module, action: Action, resource) -> None:
    """Call from within a route handler once the target resource has been
    fetched, to enforce scope (own / assigned / own_branch) against it.
    """
    if not check_access(user, module, action, resource):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{user.role}' cannot {action} this {module} record",
        )
