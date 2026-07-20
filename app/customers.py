"""Customer module: schema, validation, and business rules.

Implements the design in docs/CUSTOMER_MODULE.md. HTTP wiring (routes,
RBAC dependencies) lives in app/main.py; this module is framework-light
domain logic plus the in-memory store.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator

from app.permissions import CurrentUser
from app.roles import Role, Scope

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class CustomerType(str, Enum):
    INDIVIDUAL = "individual"
    COMPANY = "company"


class CustomerStatus(str, Enum):
    LEAD = "lead"
    ACTIVE = "active"
    INACTIVE = "inactive"


class CustomerSource(str, Enum):
    REFERRAL = "referral"
    WEBSITE = "website"
    COLD_CALL = "cold_call"
    WALK_IN = "walk_in"
    OTHER = "other"


_STATUS_TRANSITIONS: dict[CustomerStatus, set[CustomerStatus]] = {
    CustomerStatus.LEAD: {CustomerStatus.ACTIVE},
    CustomerStatus.ACTIVE: {CustomerStatus.INACTIVE},
    CustomerStatus.INACTIVE: {CustomerStatus.ACTIVE},
}

# Roles allowed to perform actions that go beyond the base RBAC CRUD grant
# on the Customers module (docs/CUSTOMER_MODULE.md, "Business Rules").
_STATUS_CHANGE_ROLES = {Role.SALES, Role.CUSTOMER_SERVICE, Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_TRANSFER_ROLES = {Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_REASSIGN_ROLES = {Role.CUSTOMER_SERVICE, Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_ASSIGNABLE_ROLES = {Role.SALES, Role.CUSTOMER_SERVICE, Role.TECHNICIAN}

_PHONE_RE = re.compile(r"^\+?\d{9,15}$")
_TAX_CODE_RE = re.compile(r"^\d{10}$|^\d{13}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Shared field validation
# ---------------------------------------------------------------------------


def _clean_name(v: str) -> str:
    v = v.strip()
    if not (2 <= len(v) <= 120):
        raise ValueError("name must be 2-120 characters")
    return v


def _clean_phone(v: str) -> str:
    if not _PHONE_RE.match(v):
        raise ValueError("phone must be 9-15 digits, optionally prefixed with '+'")
    return v


def _clean_email(v: Optional[str]) -> Optional[str]:
    if v is not None and not _EMAIL_RE.match(v):
        raise ValueError("invalid email format")
    return v


def _clean_tax_code(v: Optional[str]) -> Optional[str]:
    if v is not None and not _TAX_CODE_RE.match(v):
        raise ValueError("tax_code must be 10 or 13 digits")
    return v


def _clean_tags(v: list[str]) -> list[str]:
    if len(v) > 10:
        raise ValueError("a customer may have at most 10 tags")
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in v:
        tag = tag.strip()
        if not (1 <= len(tag) <= 30):
            raise ValueError("each tag must be 1-30 characters")
        if tag.lower() not in seen:
            seen.add(tag.lower())
            cleaned.append(tag)
    return cleaned


class Address(BaseModel):
    street: str
    ward: str
    district: str
    city: str


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CustomerCreate(BaseModel):
    customer_type: CustomerType
    name: str
    phone: str
    branch_id: int
    email: Optional[str] = None
    tax_code: Optional[str] = None
    contact_person: Optional[str] = None
    contact_title: Optional[str] = None
    address: Optional[Address] = None
    assigned_to_id: Optional[int] = None
    source: Optional[CustomerSource] = None
    tags: list[str] = Field(default_factory=list)

    _v_name = field_validator("name")(classmethod(lambda cls, v: _clean_name(v)))
    _v_phone = field_validator("phone")(classmethod(lambda cls, v: _clean_phone(v)))
    _v_email = field_validator("email")(classmethod(lambda cls, v: _clean_email(v)))
    _v_tax_code = field_validator("tax_code")(classmethod(lambda cls, v: _clean_tax_code(v)))
    _v_tags = field_validator("tags")(classmethod(lambda cls, v: _clean_tags(v)))

    @model_validator(mode="after")
    def _validate_company_fields(self) -> "CustomerCreate":
        if self.customer_type == CustomerType.COMPANY:
            if not self.tax_code:
                raise ValueError("tax_code is required for company customers")
            if not self.contact_person or not self.contact_title:
                raise ValueError("contact_person and contact_title are required for company customers")
        elif self.tax_code or self.contact_person or self.contact_title:
            raise ValueError("tax_code/contact_person/contact_title must be blank for individual customers")
        return self


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    tax_code: Optional[str] = None
    contact_person: Optional[str] = None
    contact_title: Optional[str] = None
    address: Optional[Address] = None
    source: Optional[CustomerSource] = None
    tags: Optional[list[str]] = None

    _v_name = field_validator("name")(classmethod(lambda cls, v: _clean_name(v) if v is not None else v))
    _v_phone = field_validator("phone")(classmethod(lambda cls, v: _clean_phone(v) if v is not None else v))
    _v_email = field_validator("email")(classmethod(lambda cls, v: _clean_email(v)))
    _v_tax_code = field_validator("tax_code")(classmethod(lambda cls, v: _clean_tax_code(v)))
    _v_tags = field_validator("tags")(classmethod(lambda cls, v: _clean_tags(v) if v is not None else v))


class StatusChangeRequest(BaseModel):
    status: CustomerStatus


class TransferRequest(BaseModel):
    branch_id: int


class AssignRequest(BaseModel):
    assigned_to_id: Optional[int] = None


class NoteCreate(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def _v_text(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("note text must not be empty")
        if len(v) > 2000:
            raise ValueError("note text must be at most 2000 characters")
        return v


# ---------------------------------------------------------------------------
# Storage entities
# ---------------------------------------------------------------------------


class Note(BaseModel):
    author_id: int
    text: str
    created_at: datetime = Field(default_factory=_utcnow)


class AuditEntry(BaseModel):
    actor_id: int
    action: str
    changes: dict
    created_at: datetime = Field(default_factory=_utcnow)


class Customer(BaseModel):
    id: int
    customer_type: CustomerType
    name: str
    phone: str
    branch_id: int
    status: CustomerStatus = CustomerStatus.LEAD
    tax_code: Optional[str] = None
    contact_person: Optional[str] = None
    contact_title: Optional[str] = None
    email: Optional[str] = None
    address: Optional[Address] = None
    assigned_to_id: Optional[int] = None
    source: Optional[CustomerSource] = None
    tags: list[str] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    created_by: int = 0
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    archived_at: Optional[datetime] = None


@dataclass
class DirectoryUser:
    """Minimal stand-in for a user directory, used only to validate
    `assigned_to_id`. Replace with a real user service before deploying.
    """

    id: int
    role: Role
    branch_id: int


CUSTOMERS: dict[int, Customer] = {}
AUDIT_LOG: dict[int, list[AuditEntry]] = {}

USERS: dict[int, DirectoryUser] = {
    10: DirectoryUser(id=10, role=Role.TECHNICIAN, branch_id=1),
    20: DirectoryUser(id=20, role=Role.TECHNICIAN, branch_id=2),
    30: DirectoryUser(id=30, role=Role.SALES, branch_id=1),
    40: DirectoryUser(id=40, role=Role.CUSTOMER_SERVICE, branch_id=1),
}


def _next_id() -> int:
    return max(CUSTOMERS, default=0) + 1


def _log(customer_id: int, user: CurrentUser, action: str, changes: dict) -> None:
    AUDIT_LOG.setdefault(customer_id, []).append(
        AuditEntry(actor_id=user.id, action=action, changes=changes)
    )


def _phone_taken(phone: str, branch_id: int, exclude_id: Optional[int] = None) -> bool:
    return any(
        c.phone == phone and c.branch_id == branch_id and c.id != exclude_id
        for c in CUSTOMERS.values()
    )


def _tax_code_taken(tax_code: str, exclude_id: Optional[int] = None) -> bool:
    return any(c.tax_code == tax_code and c.id != exclude_id for c in CUSTOMERS.values())


def _validate_assignee(assigned_to_id: int, branch_id: int) -> None:
    directory_user = USERS.get(assigned_to_id)
    if directory_user is None or directory_user.role not in _ASSIGNABLE_ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "assigned_to_id must reference a Sales, Customer Service, or Technician user",
        )
    if directory_user.branch_id != branch_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "assigned_to_id must belong to the customer's branch",
        )


def get_or_404(customer_id: int) -> Customer:
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer not found")
    return customer


# ---------------------------------------------------------------------------
# Mutating operations
# ---------------------------------------------------------------------------


def create_customer(payload: CustomerCreate, user: CurrentUser) -> Customer:
    if _phone_taken(payload.phone, payload.branch_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already in use in this branch")
    if payload.tax_code and _tax_code_taken(payload.tax_code):
        raise HTTPException(status.HTTP_409_CONFLICT, "tax_code already in use")
    if payload.assigned_to_id is not None:
        _validate_assignee(payload.assigned_to_id, payload.branch_id)

    customer = Customer(
        id=_next_id(),
        customer_type=payload.customer_type,
        name=payload.name,
        phone=payload.phone,
        branch_id=payload.branch_id,
        tax_code=payload.tax_code,
        contact_person=payload.contact_person,
        contact_title=payload.contact_title,
        email=payload.email,
        address=payload.address,
        assigned_to_id=payload.assigned_to_id,
        source=payload.source,
        tags=payload.tags,
        created_by=user.id,
    )
    CUSTOMERS[customer.id] = customer
    _log(customer.id, user, "create", payload.model_dump(mode="json"))
    return customer


def duplicate_warnings(name: str, branch_id: int, exclude_id: Optional[int] = None) -> list[int]:
    """IDs of existing customers in the same branch with a matching name
    (case/whitespace-insensitive). A soft warning, not a uniqueness block.
    """
    normalized = name.strip().lower()
    return [
        c.id
        for c in CUSTOMERS.values()
        if c.branch_id == branch_id and c.id != exclude_id and c.name.strip().lower() == normalized
    ]


def update_customer(customer: Customer, payload: CustomerUpdate, user: CurrentUser) -> Customer:
    updates = payload.model_dump(exclude_unset=True)
    if "phone" in updates and _phone_taken(updates["phone"], customer.branch_id, exclude_id=customer.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already in use in this branch")
    if "tax_code" in updates and updates["tax_code"] and _tax_code_taken(updates["tax_code"], exclude_id=customer.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "tax_code already in use")

    if customer.customer_type == CustomerType.COMPANY:
        tax_code = updates.get("tax_code", customer.tax_code)
        contact_person = updates.get("contact_person", customer.contact_person)
        contact_title = updates.get("contact_title", customer.contact_title)
        if not tax_code or not contact_person or not contact_title:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "tax_code/contact_person/contact_title are required for company customers",
            )

    for field_name, value in updates.items():
        setattr(customer, field_name, value)
    customer.updated_at = _utcnow()
    _log(customer.id, user, "update", updates)
    return customer


def change_status(customer: Customer, new_status: CustomerStatus, user: CurrentUser) -> Customer:
    if user.role not in _STATUS_CHANGE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot change customer status")
    allowed = _STATUS_TRANSITIONS.get(customer.status, set())
    if new_status not in allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"cannot transition status from '{customer.status.value}' to '{new_status.value}'",
        )
    old_status = customer.status
    customer.status = new_status
    customer.updated_at = _utcnow()
    _log(customer.id, user, "status_change", {"from": old_status.value, "to": new_status.value})
    return customer


def transfer_branch(customer: Customer, new_branch_id: int, user: CurrentUser) -> Customer:
    if user.role not in _TRANSFER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot transfer customers between branches")
    if user.role == Role.BRANCH_MANAGER and user.branch_id not in (customer.branch_id, new_branch_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "branch managers may only transfer customers into or out of their own branch",
        )
    if _phone_taken(customer.phone, new_branch_id, exclude_id=customer.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already in use in the destination branch")

    old_branch = customer.branch_id
    customer.branch_id = new_branch_id
    customer.assigned_to_id = None
    customer.updated_at = _utcnow()
    _log(customer.id, user, "transfer", {"from_branch": old_branch, "to_branch": new_branch_id})
    return customer


def reassign(customer: Customer, assigned_to_id: Optional[int], user: CurrentUser) -> Customer:
    if user.role not in _REASSIGN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot reassign customers")
    if assigned_to_id is not None:
        _validate_assignee(assigned_to_id, customer.branch_id)

    old_assignee = customer.assigned_to_id
    customer.assigned_to_id = assigned_to_id
    customer.updated_at = _utcnow()
    _log(customer.id, user, "reassign", {"from": old_assignee, "to": assigned_to_id})
    return customer


def add_note(customer: Customer, text: str, user: CurrentUser) -> Note:
    note = Note(author_id=user.id, text=text)
    customer.notes.append(note)
    customer.updated_at = _utcnow()
    _log(customer.id, user, "note", {"text": text})
    return note


def delete_customer(customer: Customer, user: CurrentUser, has_linked_records: bool) -> dict:
    """Soft-deletes (archives) unless the actor is an Administrator and no
    records (service orders, etc.) reference this customer, in which case
    it is removed outright.
    """
    if has_linked_records or user.role != Role.ADMINISTRATOR:
        customer.status = CustomerStatus.INACTIVE
        customer.archived_at = _utcnow()
        customer.updated_at = customer.archived_at
        _log(customer.id, user, "archive", {"archived_at": customer.archived_at.isoformat()})
        return {"detail": "archived", "hard_deleted": False, "customer": customer}

    del CUSTOMERS[customer.id]
    AUDIT_LOG.pop(customer.id, None)
    return {"detail": "deleted", "hard_deleted": True}


# ---------------------------------------------------------------------------
# Search / views
# ---------------------------------------------------------------------------


def _matches_keyword(customer: Customer, keyword: str) -> bool:
    keyword = keyword.strip().lower()
    haystack = " ".join(filter(None, [customer.name, customer.phone, customer.email, customer.tax_code])).lower()
    return keyword in haystack


def search_customers(
    user: CurrentUser,
    scope: Scope,
    *,
    keyword: Optional[str] = None,
    branch_id: Optional[int] = None,
    status_filter: Optional[CustomerStatus] = None,
    customer_type: Optional[CustomerType] = None,
    assigned: Optional[str] = None,
    source: Optional[CustomerSource] = None,
    tags: Optional[list[str]] = None,
    created_from: Optional[date] = None,
    created_to: Optional[date] = None,
    has_open_service_order: Optional[bool] = None,
    service_order_customer_ids: Optional[set[int]] = None,
    include_archived: bool = False,
) -> list[Customer]:
    results = list(CUSTOMERS.values())

    if scope == Scope.ASSIGNED:
        results = [c for c in results if c.assigned_to_id == user.id]
    elif scope == Scope.OWN_BRANCH:
        results = [c for c in results if c.branch_id == user.branch_id]
    elif scope != Scope.ALL:
        results = []

    if not include_archived:
        results = [c for c in results if c.archived_at is None]
    if keyword:
        results = [c for c in results if _matches_keyword(c, keyword)]
    if branch_id is not None:
        results = [c for c in results if c.branch_id == branch_id]
    if status_filter is not None:
        results = [c for c in results if c.status == status_filter]
    if customer_type is not None:
        results = [c for c in results if c.customer_type == customer_type]
    if assigned == "me":
        results = [c for c in results if c.assigned_to_id == user.id]
    elif assigned == "unassigned":
        results = [c for c in results if c.assigned_to_id is None]
    elif assigned is not None:
        results = [c for c in results if c.assigned_to_id == int(assigned)]
    if source is not None:
        results = [c for c in results if c.source == source]
    if tags:
        wanted = {t.lower() for t in tags}
        results = [c for c in results if wanted.issubset({t.lower() for t in c.tags})]
    if created_from is not None:
        results = [c for c in results if c.created_at.date() >= created_from]
    if created_to is not None:
        results = [c for c in results if c.created_at.date() <= created_to]
    if has_open_service_order is not None and service_order_customer_ids is not None:
        if has_open_service_order:
            results = [c for c in results if c.id in service_order_customer_ids]
        else:
            results = [c for c in results if c.id not in service_order_customer_ids]

    return results


def pipeline(customers: list[Customer]) -> dict[str, list[Customer]]:
    grouped: dict[str, list[Customer]] = {s.value: [] for s in CustomerStatus}
    for c in customers:
        grouped[c.status.value].append(c)
    return grouped


def find_duplicates(customers: list[Customer]) -> list[list[Customer]]:
    groups: dict[tuple[int, str], list[Customer]] = {}
    for c in customers:
        key = (c.branch_id, c.name.strip().lower())
        groups.setdefault(key, []).append(c)
    return [group for group in groups.values() if len(group) > 1]


def _seed_demo_data() -> None:
    if CUSTOMERS:
        return
    CUSTOMERS[1] = Customer(
        id=1,
        customer_type=CustomerType.COMPANY,
        name="Acme Co",
        phone="+84901111111",
        branch_id=1,
        status=CustomerStatus.ACTIVE,
        tax_code="0101234567",
        contact_person="Alice Nguyen",
        contact_title="Purchasing Manager",
        created_by=1,
    )
    CUSTOMERS[2] = Customer(
        id=2,
        customer_type=CustomerType.COMPANY,
        name="Globex",
        phone="+84902222222",
        branch_id=2,
        status=CustomerStatus.ACTIVE,
        tax_code="0207654321",
        contact_person="Bob Tran",
        contact_title="Operations Lead",
        created_by=1,
    )
    CUSTOMERS[3] = Customer(
        id=3,
        customer_type=CustomerType.INDIVIDUAL,
        name="Initech",
        phone="+84903333333",
        branch_id=1,
        status=CustomerStatus.ACTIVE,
        assigned_to_id=10,
        created_by=1,
    )


_seed_demo_data()
