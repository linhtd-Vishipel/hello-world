from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _headers(user_id: int, role: str, branch_id: int | None = None) -> dict:
    headers = {"X-User-Id": str(user_id), "X-User-Role": role}
    if branch_id is not None:
        headers["X-Branch-Id"] = str(branch_id)
    return headers


def _create_customer(**overrides) -> dict:
    payload = {
        "customer_type": "individual",
        "name": "New Client",
        "phone": "+84909999999",
        "branch_id": 1,
    }
    payload.update(overrides)
    return payload


def test_sales_can_create_customer():
    resp = client.post(
        "/customers",
        json=_create_customer(),
        headers=_headers(1, "sales"),
    )
    assert resp.status_code == 200
    assert resp.json()["customer"]["name"] == "New Client"


def test_technician_cannot_create_customer():
    resp = client.post(
        "/customers",
        json=_create_customer(phone="+84908888888"),
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
    assert resp.json()["customer"]["id"] == 1


def test_branch_manager_cannot_read_other_branch_customer():
    resp = client.get("/customers/1", headers=_headers(1, "branch_manager", branch_id=2))
    assert resp.status_code == 403


def test_customer_detail_includes_linked_service_orders():
    resp = client.get("/customers/1", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    body = resp.json()
    assert [o["id"] for o in body["service_orders"]] == [1]
    assert body["audit_log"] == []


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


def test_list_customers_keyword_filter():
    resp = client.get("/customers", params={"keyword": "acme"}, headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    names = {c["name"] for c in resp.json()}
    assert names == {"Acme Co"}


def test_my_customers_view():
    resp = client.get("/customers/mine", headers=_headers(10, "technician"))
    assert resp.status_code == 200
    assert all(c["assigned_to_id"] == 10 for c in resp.json())


def test_customers_pipeline_groups_by_status():
    resp = client.get("/customers/pipeline", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"lead", "active", "inactive"}
    assert any(c["id"] == 1 for c in body["active"])


def test_duplicates_view_restricted_to_admin_and_branch_manager():
    resp = client.get("/customers/duplicates", headers=_headers(1, "sales"))
    assert resp.status_code == 403

    resp = client.get("/customers/duplicates", headers=_headers(1, "administrator"))
    assert resp.status_code == 200


def test_sales_can_update_customer():
    resp = client.put(
        "/customers/2",
        json={"tags": ["vip"]},
        headers=_headers(1, "sales"),
    )
    assert resp.status_code == 200
    assert resp.json()["tags"] == ["vip"]


def test_branch_manager_cannot_update_other_branch_customer():
    resp = client.put(
        "/customers/2",
        json={"tags": ["nope"]},
        headers=_headers(1, "branch_manager", branch_id=1),
    )
    assert resp.status_code == 403


def test_technician_cannot_update_customer():
    resp = client.put(
        "/customers/3",
        json={"tags": ["nope"]},
        headers=_headers(10, "technician"),
    )
    assert resp.status_code == 403


def test_customer_service_can_create_and_status_change_and_delete_customer():
    resp = client.post(
        "/customers",
        json=_create_customer(name="Temp Client", phone="+84907777777"),
        headers=_headers(1, "customer_service"),
    )
    assert resp.status_code == 200
    new_id = resp.json()["customer"]["id"]

    resp = client.post(
        f"/customers/{new_id}/status",
        json={"status": "active"},
        headers=_headers(1, "customer_service"),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"

    # customer_service is not an Administrator, so delete archives rather
    # than hard-deletes.
    resp = client.delete(f"/customers/{new_id}", headers=_headers(1, "customer_service"))
    assert resp.status_code == 200
    assert resp.json()["hard_deleted"] is False

    resp = client.get(f"/customers/{new_id}", headers=_headers(1, "customer_service"))
    assert resp.status_code == 200
    assert resp.json()["customer"]["status"] == "inactive"


def test_administrator_hard_deletes_customer_with_no_linked_records():
    resp = client.post(
        "/customers",
        json=_create_customer(name="Disposable Client", phone="+84906666666"),
        headers=_headers(1, "administrator"),
    )
    new_id = resp.json()["customer"]["id"]

    resp = client.delete(f"/customers/{new_id}", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    assert resp.json()["hard_deleted"] is True

    resp = client.get(f"/customers/{new_id}", headers=_headers(1, "administrator"))
    assert resp.status_code == 404


def test_administrator_soft_deletes_customer_with_linked_service_order():
    resp = client.delete("/customers/1", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    assert resp.json()["hard_deleted"] is False

    resp = client.get("/customers/1", headers=_headers(1, "administrator"))
    assert resp.status_code == 200
    assert resp.json()["customer"]["status"] == "inactive"


def test_accounting_cannot_delete_customer():
    resp = client.delete("/customers/2", headers=_headers(1, "accounting"))
    assert resp.status_code == 403
