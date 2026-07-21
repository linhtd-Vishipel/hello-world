"""Role-based permission matrix, matching docs/RBAC.md.

Two layers of enforcement are provided:
  - `has_permission(role, module, action)` - coarse check: is this action
    allowed for this role at all, and with what scope?
  - `check_access(user, module, action, resource=None)` - full check that
    also enforces the scope (own / assigned / own_branch) against a
    specific resource.
"""
from dataclasses import dataclass
from typing import Optional

from app.roles import Action, Module, Role, Scope

PermissionTable = dict[Role, dict[Module, dict[Action, Scope]]]


def _all(*actions: Action) -> dict[Action, Scope]:
    return {action: Scope.ALL for action in actions}


def _scoped(scope: Scope, *actions: Action) -> dict[Action, Scope]:
    return {action: scope for action in actions}


_CRUD = (Action.CREATE, Action.READ, Action.UPDATE, Action.DELETE)

PERMISSIONS: PermissionTable = {
    Role.ADMINISTRATOR: {module: _all(*_CRUD) for module in Module},
    Role.SALES: {
        Module.CUSTOMERS: _all(*_CRUD),
        Module.DEVICES: _all(Action.READ),
        Module.SALES_ORDERS: _scoped(Scope.OWN, *_CRUD),
        Module.SERVICE_ORDERS: _all(Action.READ),
        Module.INVENTORY: _all(Action.READ),
        Module.INVOICES: _scoped(Scope.OWN, Action.READ),
        Module.REPORTS: _scoped(Scope.OWN, Action.READ),
        Module.BRANCHES: _scoped(Scope.OWN_BRANCH, Action.READ),
    },
    Role.TECHNICIAN: {
        Module.CUSTOMERS: _scoped(Scope.ASSIGNED, Action.READ),
        Module.DEVICES: _scoped(Scope.ASSIGNED, Action.READ, Action.UPDATE),
        Module.SERVICE_ORDERS: _scoped(Scope.ASSIGNED, Action.READ, Action.UPDATE),
        Module.INVENTORY: _all(Action.READ),
        Module.REPORTS: _scoped(Scope.OWN, Action.READ),
        Module.BRANCHES: _scoped(Scope.OWN_BRANCH, Action.READ),
    },
    Role.CUSTOMER_SERVICE: {
        Module.CUSTOMERS: _all(*_CRUD),
        Module.DEVICES: _all(Action.CREATE, Action.READ, Action.UPDATE),
        Module.SERVICE_ORDERS: _all(Action.CREATE, Action.READ, Action.UPDATE),
        Module.SALES_ORDERS: _all(Action.READ),
        Module.INVENTORY: _all(Action.READ),
        Module.INVOICES: _all(Action.READ),
        Module.REPORTS: _scoped(Scope.OWN, Action.READ),
        Module.BRANCHES: _scoped(Scope.OWN_BRANCH, Action.READ),
    },
    Role.ACCOUNTING: {
        Module.CUSTOMERS: _all(Action.READ),
        Module.DEVICES: _all(Action.READ),
        Module.SALES_ORDERS: _all(Action.READ),
        Module.SERVICE_ORDERS: _all(Action.READ),
        Module.INVENTORY: _all(Action.READ),
        Module.INVOICES: _all(*_CRUD),
        Module.REPORTS: _all(Action.READ),
        Module.BRANCHES: _all(Action.READ),
    },
    Role.BRANCH_MANAGER: {
        Module.USERS: _scoped(Scope.OWN_BRANCH, Action.READ),
        Module.SETTINGS: _all(Action.READ),
        Module.CUSTOMERS: _scoped(Scope.OWN_BRANCH, *_CRUD),
        Module.DEVICES: _scoped(Scope.OWN_BRANCH, *_CRUD),
        Module.SALES_ORDERS: _scoped(Scope.OWN_BRANCH, *_CRUD),
        Module.SERVICE_ORDERS: _scoped(Scope.OWN_BRANCH, *_CRUD),
        Module.INVENTORY: _scoped(Scope.OWN_BRANCH, Action.READ, Action.UPDATE),
        Module.INVOICES: _scoped(Scope.OWN_BRANCH, Action.READ),
        Module.REPORTS: _scoped(Scope.OWN_BRANCH, Action.READ),
        Module.BRANCHES: _scoped(Scope.OWN_BRANCH, Action.READ, Action.UPDATE),
    },
}


def has_permission(role: Role, module: Module, action: Action) -> Scope:
    """Return the Scope granted to `role` for `action` on `module` (Scope.NONE if denied)."""
    return PERMISSIONS.get(role, {}).get(module, {}).get(action, Scope.NONE)


@dataclass
class CurrentUser:
    id: int
    role: Role
    branch_id: Optional[int] = None


def _scope_matches(scope: Scope, user: CurrentUser, resource) -> bool:
    if scope == Scope.ALL:
        return True
    if scope == Scope.NONE:
        return False
    if resource is None:
        # No specific record to check (e.g. a list endpoint). The caller
        # is responsible for filtering the result set by the same scope.
        return True
    if scope == Scope.OWN:
        return getattr(resource, "owner_id", None) == user.id
    if scope == Scope.ASSIGNED:
        return getattr(resource, "assigned_to_id", None) == user.id
    if scope == Scope.OWN_BRANCH:
        return getattr(resource, "branch_id", None) == user.branch_id
    return False


def check_access(
    user: CurrentUser,
    module: Module,
    action: Action,
    resource=None,
) -> bool:
    """Full permission check: role grant + scope match against `resource`."""
    scope = has_permission(user.role, module, action)
    if scope == Scope.NONE:
        return False
    return _scope_matches(scope, user, resource)
