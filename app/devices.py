"""Device module: schema, validation, and business rules.

Implements the design in docs/DEVICE_MODULE.md. HTTP wiring (routes, RBAC
dependencies) lives in app/main.py; this module is framework-light domain
logic plus the in-memory store.
"""
import re
from datetime import date, datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator

from app.customers import CUSTOMERS
from app.customers import USERS as DIRECTORY_USERS
from app.permissions import CurrentUser
from app.roles import Role, Scope

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class DeviceCategory(str, Enum):
    APPLIANCE = "appliance"
    ELECTRONICS = "electronics"
    MACHINERY = "machinery"
    VEHICLE = "vehicle"
    OTHER = "other"


class DeviceStatus(str, Enum):
    ACTIVE = "active"
    UNDER_REPAIR = "under_repair"
    RETIRED = "retired"


_STATUS_TRANSITIONS: dict[DeviceStatus, set[DeviceStatus]] = {
    DeviceStatus.ACTIVE: {DeviceStatus.UNDER_REPAIR, DeviceStatus.RETIRED},
    DeviceStatus.UNDER_REPAIR: {DeviceStatus.ACTIVE, DeviceStatus.RETIRED},
    DeviceStatus.RETIRED: set(),
}

# Roles allowed to perform actions that go beyond the base RBAC CRUD grant
# on the Devices module (docs/DEVICE_MODULE.md, "Business Rules").
_STATUS_CHANGE_ROLES = {Role.TECHNICIAN, Role.CUSTOMER_SERVICE, Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_TRANSFER_ROLES = {Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_REASSIGN_ROLES = {Role.CUSTOMER_SERVICE, Role.BRANCH_MANAGER, Role.ADMINISTRATOR}
_ASSIGNABLE_ROLES = {Role.TECHNICIAN}

_SERIAL_RE = re.compile(r"^[A-Za-z0-9-]{3,50}$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Shared field validation
# ---------------------------------------------------------------------------


def _clean_text(v: str, field_name: str, min_len: int = 1, max_len: int = 80) -> str:
    v = v.strip()
    if not (min_len <= len(v) <= max_len):
        raise ValueError(f"{field_name} must be {min_len}-{max_len} characters")
    return v


def _clean_serial_number(v: str) -> str:
    v = v.strip()
    if not _SERIAL_RE.match(v):
        raise ValueError("serial_number must be 3-50 letters, digits, or hyphens")
    return v


def _clean_purchase_date(v: Optional[date]) -> Optional[date]:
    if v is not None and v > date.today():
        raise ValueError("purchase_date must not be in the future")
    return v


def _clean_tags(v: list[str]) -> list[str]:
    if len(v) > 10:
        raise ValueError("a device may have at most 10 tags")
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


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class DeviceCreate(BaseModel):
    customer_id: int
    branch_id: int
    category: DeviceCategory
    brand: str
    model: str
    serial_number: str
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    assigned_to_id: Optional[int] = None
    tags: list[str] = Field(default_factory=list)

    _v_brand = field_validator("brand")(classmethod(lambda cls, v: _clean_text(v, "brand")))
    _v_model = field_validator("model")(classmethod(lambda cls, v: _clean_text(v, "model")))
    _v_serial = field_validator("serial_number")(classmethod(lambda cls, v: _clean_serial_number(v)))
    _v_purchase_date = field_validator("purchase_date")(classmethod(lambda cls, v: _clean_purchase_date(v)))
    _v_tags = field_validator("tags")(classmethod(lambda cls, v: _clean_tags(v)))

    @model_validator(mode="after")
    def _validate_warranty(self) -> "DeviceCreate":
        if self.warranty_expiry is not None and self.purchase_date is not None:
            if self.warranty_expiry < self.purchase_date:
                raise ValueError("warranty_expiry must not precede purchase_date")
        return self


class DeviceUpdate(BaseModel):
    category: Optional[DeviceCategory] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    tags: Optional[list[str]] = None

    _v_brand = field_validator("brand")(classmethod(lambda cls, v: _clean_text(v, "brand") if v is not None else v))
    _v_model = field_validator("model")(classmethod(lambda cls, v: _clean_text(v, "model") if v is not None else v))
    _v_serial = field_validator("serial_number")(
        classmethod(lambda cls, v: _clean_serial_number(v) if v is not None else v)
    )
    _v_purchase_date = field_validator("purchase_date")(classmethod(lambda cls, v: _clean_purchase_date(v)))
    _v_tags = field_validator("tags")(classmethod(lambda cls, v: _clean_tags(v) if v is not None else v))


class StatusChangeRequest(BaseModel):
    status: DeviceStatus


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


class Device(BaseModel):
    id: int
    customer_id: int
    branch_id: int
    category: DeviceCategory
    brand: str
    model: str
    serial_number: str
    status: DeviceStatus = DeviceStatus.ACTIVE
    purchase_date: Optional[date] = None
    warranty_expiry: Optional[date] = None
    assigned_to_id: Optional[int] = None
    tags: list[str] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    created_by: int = 0
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    archived_at: Optional[datetime] = None


DEVICES: dict[int, Device] = {}
AUDIT_LOG: dict[int, list[AuditEntry]] = {}


def _next_id() -> int:
    return max(DEVICES, default=0) + 1


def _log(device_id: int, user: CurrentUser, action: str, changes: dict) -> None:
    AUDIT_LOG.setdefault(device_id, []).append(AuditEntry(actor_id=user.id, action=action, changes=changes))


def _serial_taken(serial_number: str, exclude_id: Optional[int] = None) -> bool:
    return any(d.serial_number == serial_number and d.id != exclude_id for d in DEVICES.values())


def _validate_customer(customer_id: int) -> None:
    if customer_id not in CUSTOMERS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "customer_id must reference an existing customer")


def _validate_assignee(assigned_to_id: int, branch_id: int) -> None:
    directory_user = DIRECTORY_USERS.get(assigned_to_id)
    if directory_user is None or directory_user.role not in _ASSIGNABLE_ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "assigned_to_id must reference a Technician user",
        )
    if directory_user.branch_id != branch_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "assigned_to_id must belong to the device's branch",
        )


def get_or_404(device_id: int) -> Device:
    device = DEVICES.get(device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Device not found")
    return device


# ---------------------------------------------------------------------------
# Mutating operations
# ---------------------------------------------------------------------------


def create_device(payload: DeviceCreate, user: CurrentUser) -> Device:
    _validate_customer(payload.customer_id)
    if _serial_taken(payload.serial_number):
        raise HTTPException(status.HTTP_409_CONFLICT, "serial_number already in use")
    if payload.assigned_to_id is not None:
        _validate_assignee(payload.assigned_to_id, payload.branch_id)

    device = Device(
        id=_next_id(),
        customer_id=payload.customer_id,
        branch_id=payload.branch_id,
        category=payload.category,
        brand=payload.brand,
        model=payload.model,
        serial_number=payload.serial_number,
        purchase_date=payload.purchase_date,
        warranty_expiry=payload.warranty_expiry,
        assigned_to_id=payload.assigned_to_id,
        tags=payload.tags,
        created_by=user.id,
    )
    DEVICES[device.id] = device
    _log(device.id, user, "create", payload.model_dump(mode="json"))
    return device


def update_device(device: Device, payload: DeviceUpdate, user: CurrentUser) -> Device:
    updates = payload.model_dump(exclude_unset=True)
    if "serial_number" in updates and _serial_taken(updates["serial_number"], exclude_id=device.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "serial_number already in use")

    warranty_expiry = updates.get("warranty_expiry", device.warranty_expiry)
    purchase_date = updates.get("purchase_date", device.purchase_date)
    if warranty_expiry is not None and purchase_date is not None and warranty_expiry < purchase_date:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "warranty_expiry must not precede purchase_date")

    for field_name, value in updates.items():
        setattr(device, field_name, value)
    device.updated_at = _utcnow()
    _log(device.id, user, "update", updates)
    return device


def change_status(device: Device, new_status: DeviceStatus, user: CurrentUser) -> Device:
    if user.role not in _STATUS_CHANGE_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot change device status")
    allowed = _STATUS_TRANSITIONS.get(device.status, set())
    if new_status not in allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"cannot transition status from '{device.status.value}' to '{new_status.value}'",
        )
    old_status = device.status
    device.status = new_status
    device.updated_at = _utcnow()
    _log(device.id, user, "status_change", {"from": old_status.value, "to": new_status.value})
    return device


def transfer_branch(device: Device, new_branch_id: int, user: CurrentUser) -> Device:
    if user.role not in _TRANSFER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot transfer devices between branches")
    if user.role == Role.BRANCH_MANAGER and user.branch_id not in (device.branch_id, new_branch_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "branch managers may only transfer devices into or out of their own branch",
        )

    old_branch = device.branch_id
    device.branch_id = new_branch_id
    device.assigned_to_id = None
    device.updated_at = _utcnow()
    _log(device.id, user, "transfer", {"from_branch": old_branch, "to_branch": new_branch_id})
    return device


def reassign(device: Device, assigned_to_id: Optional[int], user: CurrentUser) -> Device:
    if user.role not in _REASSIGN_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' cannot reassign devices")
    if assigned_to_id is not None:
        _validate_assignee(assigned_to_id, device.branch_id)

    old_assignee = device.assigned_to_id
    device.assigned_to_id = assigned_to_id
    device.updated_at = _utcnow()
    _log(device.id, user, "reassign", {"from": old_assignee, "to": assigned_to_id})
    return device


def add_note(device: Device, text: str, user: CurrentUser) -> Note:
    note = Note(author_id=user.id, text=text)
    device.notes.append(note)
    device.updated_at = _utcnow()
    _log(device.id, user, "note", {"text": text})
    return note


def delete_device(device: Device, user: CurrentUser, has_linked_records: bool) -> dict:
    """Soft-deletes (retires) unless the actor is an Administrator and no
    records (service orders, etc.) reference this device, in which case it
    is removed outright.
    """
    if has_linked_records or user.role != Role.ADMINISTRATOR:
        device.status = DeviceStatus.RETIRED
        device.archived_at = _utcnow()
        device.updated_at = device.archived_at
        _log(device.id, user, "archive", {"archived_at": device.archived_at.isoformat()})
        return {"detail": "archived", "hard_deleted": False, "device": device}

    del DEVICES[device.id]
    AUDIT_LOG.pop(device.id, None)
    return {"detail": "deleted", "hard_deleted": True}


# ---------------------------------------------------------------------------
# Search / views
# ---------------------------------------------------------------------------


def _matches_keyword(device: Device, keyword: str) -> bool:
    keyword = keyword.strip().lower()
    haystack = " ".join([device.serial_number, device.brand, device.model]).lower()
    return keyword in haystack


def _under_warranty(device: Device) -> bool:
    return device.warranty_expiry is not None and device.warranty_expiry >= date.today()


def search_devices(
    user: CurrentUser,
    scope: Scope,
    *,
    keyword: Optional[str] = None,
    customer_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    category: Optional[DeviceCategory] = None,
    status_filter: Optional[DeviceStatus] = None,
    assigned: Optional[str] = None,
    under_warranty: Optional[bool] = None,
    created_from: Optional[date] = None,
    created_to: Optional[date] = None,
    include_archived: bool = False,
) -> list[Device]:
    results = list(DEVICES.values())

    if scope == Scope.ASSIGNED:
        results = [d for d in results if d.assigned_to_id == user.id]
    elif scope == Scope.OWN_BRANCH:
        results = [d for d in results if d.branch_id == user.branch_id]
    elif scope != Scope.ALL:
        results = []

    if not include_archived:
        results = [d for d in results if d.archived_at is None]
    if keyword:
        results = [d for d in results if _matches_keyword(d, keyword)]
    if customer_id is not None:
        results = [d for d in results if d.customer_id == customer_id]
    if branch_id is not None:
        results = [d for d in results if d.branch_id == branch_id]
    if category is not None:
        results = [d for d in results if d.category == category]
    if status_filter is not None:
        results = [d for d in results if d.status == status_filter]
    if assigned == "me":
        results = [d for d in results if d.assigned_to_id == user.id]
    elif assigned == "unassigned":
        results = [d for d in results if d.assigned_to_id is None]
    elif assigned is not None:
        results = [d for d in results if d.assigned_to_id == int(assigned)]
    if under_warranty is not None:
        results = [d for d in results if _under_warranty(d) == under_warranty]
    if created_from is not None:
        results = [d for d in results if d.created_at.date() >= created_from]
    if created_to is not None:
        results = [d for d in results if d.created_at.date() <= created_to]

    return results


def _seed_demo_data() -> None:
    if DEVICES:
        return
    DEVICES[1] = Device(
        id=1,
        customer_id=1,
        branch_id=1,
        category=DeviceCategory.MACHINERY,
        brand="Canon",
        model="ImageRunner 2530",
        serial_number="CN-2530-001",
        status=DeviceStatus.ACTIVE,
        purchase_date=date(2024, 1, 15),
        warranty_expiry=date(2027, 1, 15),
        created_by=1,
    )
    DEVICES[2] = Device(
        id=2,
        customer_id=2,
        branch_id=2,
        category=DeviceCategory.ELECTRONICS,
        brand="TP-Link",
        model="Archer AX55",
        serial_number="TPL-AX55-002",
        status=DeviceStatus.ACTIVE,
        purchase_date=date(2023, 6, 1),
        created_by=1,
    )
    DEVICES[3] = Device(
        id=3,
        customer_id=3,
        branch_id=1,
        category=DeviceCategory.APPLIANCE,
        brand="Daikin",
        model="Inverter FTKZ25",
        serial_number="DK-FTKZ25-003",
        status=DeviceStatus.ACTIVE,
        assigned_to_id=10,
        created_by=1,
    )


_seed_demo_data()
