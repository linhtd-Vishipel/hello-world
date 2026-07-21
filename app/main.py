"""Demo FastAPI app showing the permission checks from app.permissions
enforced on a few representative endpoints, plus the full Customer module
described in docs/CUSTOMER_MODULE.md. In-memory data only.
"""
from dataclasses import dataclass
from datetime import date
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query

from app.customers import (
    AssignRequest,
    CustomerCreate,
    CustomerSource,
    CustomerStatus,
    CustomerType,
    CustomerUpdate,
    NoteCreate,
    StatusChangeRequest,
    TransferRequest,
)
from app.customers import AUDIT_LOG
from app.customers import add_note as add_customer_note_record
from app.customers import change_status as change_customer_status_record
from app.customers import create_customer as create_customer_record
from app.customers import delete_customer as delete_customer_record
from app.customers import duplicate_warnings
from app.customers import find_duplicates
from app.customers import get_or_404 as get_customer_or_404
from app.customers import pipeline as pipeline_view
from app.customers import reassign as reassign_customer_record
from app.customers import search_customers
from app.customers import transfer_branch as transfer_customer_record
from app.customers import update_customer as update_customer_record
from app.deps import get_current_user, require_object_access, require_permission
from app.devices import AUDIT_LOG as DEVICE_AUDIT_LOG
from app.devices import DeviceCategory, DeviceCreate, DeviceStatus, DeviceUpdate
from app.devices import add_note as add_device_note_record
from app.devices import change_status as change_device_status_record
from app.devices import create_device as create_device_record
from app.devices import delete_device as delete_device_record
from app.devices import get_or_404 as get_device_or_404
from app.devices import reassign as reassign_device_record
from app.devices import search_devices
from app.devices import transfer_branch as transfer_device_record
from app.devices import update_device as update_device_record
from app.devices import AssignRequest as DeviceAssignRequest
from app.devices import NoteCreate as DeviceNoteCreate
from app.devices import StatusChangeRequest as DeviceStatusChangeRequest
from app.devices import TransferRequest as DeviceTransferRequest
from app.permissions import CurrentUser, check_access, has_permission
from app.roles import Action, Module, Role

app = FastAPI(title="RBAC demo")


@dataclass
class ServiceOrder:
    id: int
    description: str
    branch_id: int
    assigned_to_id: Optional[int] = None
    customer_id: Optional[int] = None
    device_id: Optional[int] = None


SERVICE_ORDERS = {
    1: ServiceOrder(id=1, description="Fix printer", branch_id=1, assigned_to_id=10, customer_id=1, device_id=1),
    2: ServiceOrder(id=2, description="Install router", branch_id=2, assigned_to_id=20, customer_id=2, device_id=2),
}


def _open_service_order_customer_ids() -> set[int]:
    return {o.customer_id for o in SERVICE_ORDERS.values() if o.customer_id is not None}


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------


@app.post("/customers")
def create_customer(
    payload: CustomerCreate,
    user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.CREATE)),
):
    customer = create_customer_record(payload, user)
    warnings = duplicate_warnings(customer.name, customer.branch_id, exclude_id=customer.id)
    return {"customer": customer, "duplicate_warnings": warnings}


@app.get("/customers")
def list_customers(
    user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.READ)),
    keyword: Optional[str] = None,
    branch_id: Optional[int] = None,
    status: Optional[CustomerStatus] = None,
    customer_type: Optional[CustomerType] = None,
    assigned: Optional[str] = None,
    source: Optional[CustomerSource] = None,
    tags: Optional[list[str]] = Query(None),
    created_from: Optional[date] = None,
    created_to: Optional[date] = None,
    has_open_service_order: Optional[bool] = None,
    include_archived: bool = False,
):
    scope = has_permission(user.role, Module.CUSTOMERS, Action.READ)
    return search_customers(
        user,
        scope,
        keyword=keyword,
        branch_id=branch_id,
        status_filter=status,
        customer_type=customer_type,
        assigned=assigned,
        source=source,
        tags=tags,
        created_from=created_from,
        created_to=created_to,
        has_open_service_order=has_open_service_order,
        service_order_customer_ids=_open_service_order_customer_ids(),
        include_archived=include_archived,
    )


@app.get("/customers/mine")
def list_my_customers(user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.READ))):
    scope = has_permission(user.role, Module.CUSTOMERS, Action.READ)
    return search_customers(user, scope, assigned="me")


@app.get("/customers/pipeline")
def customers_pipeline(user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.READ))):
    scope = has_permission(user.role, Module.CUSTOMERS, Action.READ)
    return pipeline_view(search_customers(user, scope))


@app.get("/customers/duplicates")
def customers_duplicates(user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.READ))):
    if user.role not in (Role.ADMINISTRATOR, Role.BRANCH_MANAGER):
        raise HTTPException(status_code=403, detail="only administrators and branch managers can review duplicates")
    scope = has_permission(user.role, Module.CUSTOMERS, Action.READ)
    return find_duplicates(search_customers(user, scope))


@app.get("/customers/{customer_id}")
def get_customer(customer_id: int, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.READ, customer)
    # Sales Orders / Invoices tabs are omitted: those modules aren't modeled
    # in this demo yet. Service Orders is, so it's included here.
    service_orders = [
        o
        for o in SERVICE_ORDERS.values()
        if o.customer_id == customer_id and check_access(user, Module.SERVICE_ORDERS, Action.READ, o)
    ]
    return {
        "customer": customer,
        "service_orders": service_orders,
        "audit_log": AUDIT_LOG.get(customer_id, []),
    }


@app.put("/customers/{customer_id}")
def update_customer(customer_id: int, payload: CustomerUpdate, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    return update_customer_record(customer, payload, user)


@app.post("/customers/{customer_id}/status")
def change_customer_status(customer_id: int, payload: StatusChangeRequest, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    return change_customer_status_record(customer, payload.status, user)


@app.post("/customers/{customer_id}/transfer")
def transfer_customer(customer_id: int, payload: TransferRequest, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    return transfer_customer_record(customer, payload.branch_id, user)


@app.post("/customers/{customer_id}/assign")
def assign_customer(customer_id: int, payload: AssignRequest, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    return reassign_customer_record(customer, payload.assigned_to_id, user)


@app.post("/customers/{customer_id}/notes")
def add_customer_note(customer_id: int, payload: NoteCreate, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    return add_customer_note_record(customer, payload.text, user)


@app.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, user: CurrentUser = Depends(get_current_user)):
    customer = get_customer_or_404(customer_id)
    require_object_access(user, Module.CUSTOMERS, Action.DELETE, customer)
    linked = any(o.customer_id == customer_id for o in SERVICE_ORDERS.values())
    return delete_customer_record(customer, user, has_linked_records=linked)


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------


@app.post("/devices")
def create_device(
    payload: DeviceCreate,
    user: CurrentUser = Depends(require_permission(Module.DEVICES, Action.CREATE)),
):
    device = create_device_record(payload, user)
    return {"device": device}


@app.get("/devices")
def list_devices(
    user: CurrentUser = Depends(require_permission(Module.DEVICES, Action.READ)),
    keyword: Optional[str] = None,
    customer_id: Optional[int] = None,
    branch_id: Optional[int] = None,
    category: Optional[DeviceCategory] = None,
    status: Optional[DeviceStatus] = None,
    assigned: Optional[str] = None,
    under_warranty: Optional[bool] = None,
    created_from: Optional[date] = None,
    created_to: Optional[date] = None,
    include_archived: bool = False,
):
    scope = has_permission(user.role, Module.DEVICES, Action.READ)
    return search_devices(
        user,
        scope,
        keyword=keyword,
        customer_id=customer_id,
        branch_id=branch_id,
        category=category,
        status_filter=status,
        assigned=assigned,
        under_warranty=under_warranty,
        created_from=created_from,
        created_to=created_to,
        include_archived=include_archived,
    )


@app.get("/devices/mine")
def list_my_devices(user: CurrentUser = Depends(require_permission(Module.DEVICES, Action.READ))):
    scope = has_permission(user.role, Module.DEVICES, Action.READ)
    return search_devices(user, scope, assigned="me")


@app.get("/devices/{device_id}")
def get_device(device_id: int, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.READ, device)
    service_orders = [
        o
        for o in SERVICE_ORDERS.values()
        if o.device_id == device_id and check_access(user, Module.SERVICE_ORDERS, Action.READ, o)
    ]
    return {
        "device": device,
        "service_orders": service_orders,
        "audit_log": DEVICE_AUDIT_LOG.get(device_id, []),
    }


@app.put("/devices/{device_id}")
def update_device(device_id: int, payload: DeviceUpdate, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.UPDATE, device)
    return update_device_record(device, payload, user)


@app.post("/devices/{device_id}/status")
def change_device_status(device_id: int, payload: DeviceStatusChangeRequest, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.UPDATE, device)
    return change_device_status_record(device, payload.status, user)


@app.post("/devices/{device_id}/transfer")
def transfer_device(device_id: int, payload: DeviceTransferRequest, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.UPDATE, device)
    return transfer_device_record(device, payload.branch_id, user)


@app.post("/devices/{device_id}/assign")
def assign_device(device_id: int, payload: DeviceAssignRequest, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.UPDATE, device)
    return reassign_device_record(device, payload.assigned_to_id, user)


@app.post("/devices/{device_id}/notes")
def add_device_note(device_id: int, payload: DeviceNoteCreate, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.UPDATE, device)
    return add_device_note_record(device, payload.text, user)


@app.delete("/devices/{device_id}")
def delete_device(device_id: int, user: CurrentUser = Depends(get_current_user)):
    device = get_device_or_404(device_id)
    require_object_access(user, Module.DEVICES, Action.DELETE, device)
    linked = any(o.device_id == device_id for o in SERVICE_ORDERS.values())
    return delete_device_record(device, user, has_linked_records=linked)


# ---------------------------------------------------------------------------
# Service orders (unchanged demo endpoints)
# ---------------------------------------------------------------------------


@app.get("/service-orders/{order_id}")
def get_service_order(order_id: int, user: CurrentUser = Depends(get_current_user)):
    order = SERVICE_ORDERS.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Not found")
    require_object_access(user, Module.SERVICE_ORDERS, Action.READ, order)
    return order


@app.put("/service-orders/{order_id}")
def update_service_order(order_id: int, description: str, user: CurrentUser = Depends(get_current_user)):
    order = SERVICE_ORDERS.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Not found")
    require_object_access(user, Module.SERVICE_ORDERS, Action.UPDATE, order)
    order.description = description
    return order
