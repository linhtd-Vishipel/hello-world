from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.devices import (
    DEVICES,
    DeviceCategory,
    DeviceCreate,
    DeviceStatus,
    DeviceUpdate,
    change_status,
    create_device,
    delete_device,
    get_or_404,
    reassign,
    search_devices,
    transfer_branch,
    update_device,
)
from app.permissions import CurrentUser
from app.roles import Role, Scope


def _device(**overrides) -> DeviceCreate:
    payload = dict(
        customer_id=1,
        branch_id=1,
        category=DeviceCategory.ELECTRONICS,
        brand="Sony",
        model="X900",
        serial_number="SNY-X900-999",
    )
    payload.update(overrides)
    return DeviceCreate(**payload)


def _user(role: Role, user_id: int = 1, branch_id: int | None = None) -> CurrentUser:
    return CurrentUser(id=user_id, role=role, branch_id=branch_id)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_brand_and_model_length_are_validated():
    with pytest.raises(ValidationError):
        _device(brand="")
    with pytest.raises(ValidationError):
        _device(model="")


def test_serial_number_format_is_validated():
    with pytest.raises(ValidationError):
        _device(serial_number="a b")


def test_purchase_date_cannot_be_in_the_future():
    with pytest.raises(ValidationError):
        _device(purchase_date=date(2999, 1, 1))


def test_warranty_expiry_cannot_precede_purchase_date():
    with pytest.raises(ValidationError):
        _device(purchase_date=date(2024, 6, 1), warranty_expiry=date(2024, 1, 1))

    # Equal to purchase_date is fine.
    _device(purchase_date=date(2024, 6, 1), warranty_expiry=date(2024, 6, 1))


def test_tags_are_deduplicated_and_capped():
    payload = _device(tags=["VIP", "vip", "gold"])
    assert payload.tags == ["VIP", "gold"]

    with pytest.raises(ValidationError):
        _device(tags=[f"tag{i}" for i in range(11)])


# ---------------------------------------------------------------------------
# Business rules: creation
# ---------------------------------------------------------------------------


def test_create_rejects_unknown_customer():
    with pytest.raises(HTTPException) as exc:
        create_device(_device(customer_id=999), _user(Role.ADMINISTRATOR))
    assert exc.value.status_code == 422


def test_serial_number_must_be_unique_system_wide():
    user = _user(Role.ADMINISTRATOR)
    with pytest.raises(HTTPException) as exc:
        create_device(_device(serial_number="CN-2530-001"), user)  # matches seeded device 1
    assert exc.value.status_code == 409


def test_create_validates_assignee_role_and_branch():
    user = _user(Role.ADMINISTRATOR)
    # user 30 is Sales, not a Technician.
    with pytest.raises(HTTPException) as exc:
        create_device(_device(assigned_to_id=30), user)
    assert exc.value.status_code == 422

    # user 20 is a Technician but in branch 2, device is branch 1.
    with pytest.raises(HTTPException) as exc:
        create_device(_device(assigned_to_id=20), user)
    assert exc.value.status_code == 422

    # user 10 is a Technician in branch 1 -> allowed.
    device = create_device(_device(assigned_to_id=10), user)
    assert device.assigned_to_id == 10


# ---------------------------------------------------------------------------
# Business rules: status lifecycle
# ---------------------------------------------------------------------------


def test_status_lifecycle_allows_active_to_under_repair_and_back():
    device = get_or_404(1)
    user = _user(Role.TECHNICIAN)

    change_status(device, DeviceStatus.UNDER_REPAIR, user)
    assert device.status == DeviceStatus.UNDER_REPAIR

    change_status(device, DeviceStatus.ACTIVE, user)
    assert device.status == DeviceStatus.ACTIVE


def test_status_lifecycle_rejects_transitions_out_of_retired():
    device = get_or_404(1)
    change_status(device, DeviceStatus.RETIRED, _user(Role.ADMINISTRATOR))
    with pytest.raises(HTTPException) as exc:
        change_status(device, DeviceStatus.ACTIVE, _user(Role.ADMINISTRATOR))
    assert exc.value.status_code == 422


def test_only_permitted_roles_can_change_status():
    device = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        change_status(device, DeviceStatus.RETIRED, _user(Role.SALES))
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Business rules: transfer
# ---------------------------------------------------------------------------


def test_transfer_restricted_to_branch_manager_and_administrator():
    device = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        transfer_branch(device, 2, _user(Role.CUSTOMER_SERVICE))
    assert exc.value.status_code == 403


def test_branch_manager_can_only_transfer_within_their_own_branch():
    device = get_or_404(1)  # branch 1
    with pytest.raises(HTTPException) as exc:
        transfer_branch(device, 3, _user(Role.BRANCH_MANAGER, branch_id=2))
    assert exc.value.status_code == 403

    transfer_branch(device, 2, _user(Role.BRANCH_MANAGER, branch_id=1))
    assert device.branch_id == 2


def test_transfer_clears_assignment():
    device = get_or_404(3)  # assigned to 10
    transfer_branch(device, 2, _user(Role.ADMINISTRATOR))
    assert device.assigned_to_id is None


# ---------------------------------------------------------------------------
# Business rules: reassignment
# ---------------------------------------------------------------------------


def test_technician_cannot_reassign_devices():
    device = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        reassign(device, 10, _user(Role.TECHNICIAN))
    assert exc.value.status_code == 403


def test_reassign_requires_technician_in_same_branch():
    device = get_or_404(1)  # branch 1
    # user 20 is a technician in branch 2 -> wrong branch
    with pytest.raises(HTTPException) as exc:
        reassign(device, 20, _user(Role.CUSTOMER_SERVICE))
    assert exc.value.status_code == 422

    # user 10 is a technician in branch 1 -> allowed
    reassign(device, 10, _user(Role.CUSTOMER_SERVICE))
    assert device.assigned_to_id == 10


# ---------------------------------------------------------------------------
# Business rules: delete / archive
# ---------------------------------------------------------------------------


def test_delete_archives_when_linked_records_exist_even_for_administrator():
    device = get_or_404(1)
    result = delete_device(device, _user(Role.ADMINISTRATOR), has_linked_records=True)
    assert result["hard_deleted"] is False
    assert device.status == DeviceStatus.RETIRED
    assert 1 in DEVICES


def test_delete_hard_deletes_for_administrator_with_no_linked_records():
    device = get_or_404(1)
    result = delete_device(device, _user(Role.ADMINISTRATOR), has_linked_records=False)
    assert result["hard_deleted"] is True
    assert 1 not in DEVICES


def test_delete_archives_for_non_administrator_even_without_linked_records():
    device = get_or_404(1)
    result = delete_device(device, _user(Role.CUSTOMER_SERVICE), has_linked_records=False)
    assert result["hard_deleted"] is False
    assert 1 in DEVICES


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


def test_update_rejects_serial_number_collision():
    device1 = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        update_device(device1, DeviceUpdate(serial_number="TPL-AX55-002"), _user(Role.CUSTOMER_SERVICE))  # matches device 2
    assert exc.value.status_code == 409


def test_update_rejects_warranty_before_purchase_date():
    device1 = get_or_404(1)  # purchase_date=2024-01-15
    with pytest.raises(HTTPException) as exc:
        update_device(device1, DeviceUpdate(warranty_expiry=date(2023, 1, 1)), _user(Role.CUSTOMER_SERVICE))
    assert exc.value.status_code == 422


# ---------------------------------------------------------------------------
# Search / views
# ---------------------------------------------------------------------------


def test_search_filters_by_category_and_customer():
    user = _user(Role.ADMINISTRATOR)
    results = search_devices(user, Scope.ALL, category=DeviceCategory.APPLIANCE)
    assert {d.id for d in results} == {3}

    results = search_devices(user, Scope.ALL, customer_id=2)
    assert {d.id for d in results} == {2}


def test_search_excludes_archived_unless_requested():
    user = _user(Role.ADMINISTRATOR)
    device = get_or_404(1)
    delete_device(device, user, has_linked_records=True)  # archives it

    visible = search_devices(user, Scope.ALL)
    assert 1 not in {d.id for d in visible}

    with_archived = search_devices(user, Scope.ALL, include_archived=True)
    assert 1 in {d.id for d in with_archived}


def test_search_assigned_me_and_unassigned():
    user = _user(Role.TECHNICIAN, user_id=10)
    mine = search_devices(user, Scope.ALL, assigned="me")
    assert {d.id for d in mine} == {3}

    unassigned = search_devices(user, Scope.ALL, assigned="unassigned")
    assert {d.id for d in unassigned} == {1, 2}


def test_search_under_warranty_filter():
    user = _user(Role.ADMINISTRATOR)
    # Device 1 has a warranty_expiry far in the future; device 2 and 3 have none.
    under = search_devices(user, Scope.ALL, under_warranty=True)
    assert {d.id for d in under} == {1}

    not_under = search_devices(user, Scope.ALL, under_warranty=False)
    assert {d.id for d in not_under} == {2, 3}


def test_search_keyword_matches_serial_brand_or_model():
    user = _user(Role.ADMINISTRATOR)
    results = search_devices(user, Scope.ALL, keyword="daikin")
    assert {d.id for d in results} == {3}
