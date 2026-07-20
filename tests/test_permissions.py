import pytest

from app.permissions import CurrentUser, check_access, has_permission
from app.roles import Action, Module, Role, Scope


def test_administrator_has_full_access_everywhere():
    for module in Module:
        for action in Action:
            assert has_permission(Role.ADMINISTRATOR, module, action) == Scope.ALL


def test_sales_can_manage_customers_but_not_invoices():
    assert has_permission(Role.SALES, Module.CUSTOMERS, Action.CREATE) == Scope.ALL
    assert has_permission(Role.SALES, Module.INVOICES, Action.CREATE) == Scope.NONE
    assert has_permission(Role.SALES, Module.INVOICES, Action.READ) == Scope.OWN


def test_technician_cannot_touch_sales_orders():
    assert has_permission(Role.TECHNICIAN, Module.SALES_ORDERS, Action.READ) == Scope.NONE


def test_technician_can_only_update_assigned_service_orders():
    assert has_permission(Role.TECHNICIAN, Module.SERVICE_ORDERS, Action.UPDATE) == Scope.ASSIGNED


def test_only_administrator_manages_users():
    for role in Role:
        if role in (Role.ADMINISTRATOR, Role.BRANCH_MANAGER):
            continue
        assert has_permission(role, Module.USERS, Action.CREATE) == Scope.NONE
    assert has_permission(Role.BRANCH_MANAGER, Module.USERS, Action.CREATE) == Scope.NONE
    assert has_permission(Role.BRANCH_MANAGER, Module.USERS, Action.READ) == Scope.OWN_BRANCH


class _Resource:
    def __init__(self, owner_id=None, assigned_to_id=None, branch_id=None):
        self.owner_id = owner_id
        self.assigned_to_id = assigned_to_id
        self.branch_id = branch_id


def test_check_access_denies_when_role_lacks_permission():
    user = CurrentUser(id=1, role=Role.TECHNICIAN, branch_id=1)
    resource = _Resource(branch_id=1)
    assert check_access(user, Module.INVOICES, Action.READ, resource) is False


def test_check_access_enforces_assigned_scope():
    resource = _Resource(assigned_to_id=42, branch_id=1)
    owner = CurrentUser(id=42, role=Role.TECHNICIAN, branch_id=1)
    other = CurrentUser(id=99, role=Role.TECHNICIAN, branch_id=1)
    assert check_access(owner, Module.SERVICE_ORDERS, Action.UPDATE, resource) is True
    assert check_access(other, Module.SERVICE_ORDERS, Action.UPDATE, resource) is False


def test_check_access_enforces_own_branch_scope():
    resource = _Resource(branch_id=1)
    same_branch = CurrentUser(id=1, role=Role.BRANCH_MANAGER, branch_id=1)
    other_branch = CurrentUser(id=2, role=Role.BRANCH_MANAGER, branch_id=2)
    assert check_access(same_branch, Module.CUSTOMERS, Action.UPDATE, resource) is True
    assert check_access(other_branch, Module.CUSTOMERS, Action.UPDATE, resource) is False


def test_check_access_enforces_own_scope():
    resource = _Resource(owner_id=7)
    owner = CurrentUser(id=7, role=Role.SALES, branch_id=1)
    other = CurrentUser(id=8, role=Role.SALES, branch_id=1)
    assert check_access(owner, Module.SALES_ORDERS, Action.UPDATE, resource) is True
    assert check_access(other, Module.SALES_ORDERS, Action.UPDATE, resource) is False


@pytest.mark.parametrize(
    "role,module,action,expected_scope",
    [
        (Role.ACCOUNTING, Module.INVOICES, Action.DELETE, Scope.ALL),
        (Role.ACCOUNTING, Module.SERVICE_ORDERS, Action.UPDATE, Scope.NONE),
        (Role.CUSTOMER_SERVICE, Module.SERVICE_ORDERS, Action.DELETE, Scope.NONE),
        (Role.CUSTOMER_SERVICE, Module.SERVICE_ORDERS, Action.CREATE, Scope.ALL),
        (Role.BRANCH_MANAGER, Module.SETTINGS, Action.UPDATE, Scope.NONE),
        (Role.BRANCH_MANAGER, Module.SETTINGS, Action.READ, Scope.ALL),
    ],
)
def test_matrix_spot_checks(role, module, action, expected_scope):
    assert has_permission(role, module, action) == expected_scope
