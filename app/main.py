"""Demo FastAPI app showing the permission checks from app.permissions
enforced on a few representative endpoints. In-memory data only.
"""
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException

from app.deps import get_current_user, require_object_access, require_permission
from app.permissions import CurrentUser, has_permission
from app.roles import Action, Module, Scope

app = FastAPI(title="RBAC demo")


@dataclass
class Customer:
    id: int
    name: str
    branch_id: int
    assigned_to_id: Optional[int] = None


@dataclass
class ServiceOrder:
    id: int
    description: str
    branch_id: int
    assigned_to_id: Optional[int] = None


CUSTOMERS = {
    1: Customer(id=1, name="Acme Co", branch_id=1, assigned_to_id=None),
    2: Customer(id=2, name="Globex", branch_id=2, assigned_to_id=None),
    3: Customer(id=3, name="Initech", branch_id=1, assigned_to_id=10),
}

SERVICE_ORDERS = {
    1: ServiceOrder(id=1, description="Fix printer", branch_id=1, assigned_to_id=10),
    2: ServiceOrder(id=2, description="Install router", branch_id=2, assigned_to_id=20),
}


@app.post("/customers", dependencies=[Depends(require_permission(Module.CUSTOMERS, Action.CREATE))])
def create_customer(name: str, branch_id: int):
    new_id = max(CUSTOMERS) + 1
    CUSTOMERS[new_id] = Customer(id=new_id, name=name, branch_id=branch_id)
    return CUSTOMERS[new_id]


@app.get("/customers")
def list_customers(
    user: CurrentUser = Depends(require_permission(Module.CUSTOMERS, Action.READ)),
):
    scope = has_permission(user.role, Module.CUSTOMERS, Action.READ)
    customers = list(CUSTOMERS.values())
    if scope == Scope.ALL:
        return customers
    if scope == Scope.ASSIGNED:
        return [c for c in customers if c.assigned_to_id == user.id]
    if scope == Scope.OWN_BRANCH:
        return [c for c in customers if c.branch_id == user.branch_id]
    return []


@app.get("/customers/{customer_id}")
def get_customer(customer_id: int, user: CurrentUser = Depends(get_current_user)):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found")
    require_object_access(user, Module.CUSTOMERS, Action.READ, customer)
    return customer


@app.put("/customers/{customer_id}")
def update_customer(customer_id: int, name: str, user: CurrentUser = Depends(get_current_user)):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found")
    require_object_access(user, Module.CUSTOMERS, Action.UPDATE, customer)
    customer.name = name
    return customer


@app.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, user: CurrentUser = Depends(get_current_user)):
    customer = CUSTOMERS.get(customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Not found")
    require_object_access(user, Module.CUSTOMERS, Action.DELETE, customer)
    del CUSTOMERS[customer_id]
    return {"detail": "deleted"}


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
