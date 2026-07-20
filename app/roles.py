from enum import Enum


class Role(str, Enum):
    ADMINISTRATOR = "administrator"
    SALES = "sales"
    TECHNICIAN = "technician"
    CUSTOMER_SERVICE = "customer_service"
    ACCOUNTING = "accounting"
    BRANCH_MANAGER = "branch_manager"


class Module(str, Enum):
    USERS = "users"
    SETTINGS = "settings"
    CUSTOMERS = "customers"
    SALES_ORDERS = "sales_orders"
    SERVICE_ORDERS = "service_orders"
    INVENTORY = "inventory"
    INVOICES = "invoices"
    REPORTS = "reports"
    BRANCHES = "branches"


class Action(str, Enum):
    CREATE = "create"
    READ = "read"
    UPDATE = "update"
    DELETE = "delete"


class Scope(str, Enum):
    """How far a granted permission reaches.

    ALL         - any record in the module
    OWN         - only records the user owns/created (resource.owner_id == user.id)
    ASSIGNED    - only records assigned to the user (resource.assigned_to_id == user.id)
    OWN_BRANCH  - only records in the user's branch (resource.branch_id == user.branch_id)
    NONE        - no access (default when a role/module/action has no entry)
    """

    ALL = "all"
    OWN = "own"
    ASSIGNED = "assigned"
    OWN_BRANCH = "own_branch"
    NONE = "none"
