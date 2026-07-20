from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _headers(user_id: int, role: str, branch_id: int | None = None) -> dict:
    headers = {"X-User-Id": str(user_id), "X-User-Role": role}
    if branch_id is not None:
        headers["X-Branch-Id"] = str(branch_id)
    return headers


def test_sales_can_create_customer():
    resp = client.post(
        "/customers",
        params={"name": "New Client", "branch_id": 1},
        headers=_headers(1, "sales"),
    )
    assert resp.status_code == 200


def test_technician_cannot_create_customer():
    resp = client.post(
        "/customers",
        params={"name": "New Client", "branch_id": 1},
        headers=_headers(1, "technician"),
    )
    assert resp.status_code == 403


def test_technician_can_update_own_assigned_service_order():
    resp = client.put(
        "/service-orders/1",
        params={"description": "Fixed printer"},
        headers=_headers(10, "technician"),
    )
    assert resp.status_code == 200


def test_technician_cannot_update_unassigned_service_order():
    resp = client.put(
        "/service-orders/1",
        params={"description": "Should fail"},
        headers=_headers(99, "technician"),
    )
    assert resp.status_code == 403


def test_branch_manager_can_read_own_branch_customer():
    resp = client.get("/customers/1", headers=_headers(1, "branch_manager", branch_id=1))
    assert resp.status_code == 200


def test_branch_manager_cannot_read_other_branch_customer():
    resp = client.get("/customers/1", headers=_headers(1, "branch_manager", branch_id=2))
    assert resp.status_code == 403


def test_administrator_lists_all_customers():
    resp = client.get("/customers", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    ids = {c["id"] for c in resp.json()}
    assert {1, 2, 3}.issubset(ids)


def test_branch_manager_lists_only_own_branch_customers():
    resp = client.get("/customers", headers=_headers(1, "branch_manager", branch_id=1))
    assert resp.status_code == 200
    assert all(c["branch_id"] == 1 for c in resp.json())


def test_technician_lists_only_assigned_customers():
    resp = client.get("/customers", headers=_headers(10, "technician"))
    assert resp.status_code == 200
    assert all(c["assigned_to_id"] == 10 for c in resp.json())


def test_sales_can_update_customer():
    resp = client.put(
        "/customers/2",
        params={"name": "Globex Corp"},
        headers=_headers(1, "sales"),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Globex Corp"


def test_branch_manager_cannot_update_other_branch_customer():
    resp = client.put(
        "/customers/2",
        params={"name": "Nope"},
        headers=_headers(1, "branch_manager", branch_id=1),
    )
    assert resp.status_code == 403


def test_technician_cannot_update_customer():
    resp = client.put(
        "/customers/3",
        params={"name": "Nope"},
        headers=_headers(10, "technician"),
    )
    assert resp.status_code == 403


def test_customer_service_can_delete_customer():
    resp = client.post(
        "/customers",
        params={"name": "Temp Client", "branch_id": 1},
        headers=_headers(1, "customer_service"),
    )
    assert resp.status_code == 200
    new_id = resp.json()["id"]

    resp = client.delete(f"/customers/{new_id}", headers=_headers(1, "customer_service"))
    assert resp.status_code == 200

    resp = client.get(f"/customers/{new_id}", headers=_headers(1, "customer_service"))
    assert resp.status_code == 404


def test_accounting_cannot_delete_customer():
    resp = client.delete("/customers/1", headers=_headers(1, "accounting"))
    assert resp.status_code == 403
