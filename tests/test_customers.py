import pytest
from pydantic import ValidationError

from app.customers import (
    CUSTOMERS,
    CustomerCreate,
    CustomerStatus,
    CustomerType,
    change_status,
    create_customer,
    delete_customer,
    find_duplicates,
    get_or_404,
    pipeline,
    reassign,
    search_customers,
    transfer_branch,
    update_customer,
)
from app.customers import CustomerUpdate
from app.permissions import CurrentUser
from app.roles import Role, Scope
from fastapi import HTTPException


def _individual(**overrides) -> CustomerCreate:
    payload = dict(customer_type=CustomerType.INDIVIDUAL, name="Jane Doe", phone="+84911111111", branch_id=1)
    payload.update(overrides)
    return CustomerCreate(**payload)


def _company(**overrides) -> CustomerCreate:
    payload = dict(
        customer_type=CustomerType.COMPANY,
        name="New Co",
        phone="+84922222222",
        branch_id=1,
        tax_code="0101112223",
        contact_person="Nam Le",
        contact_title="CEO",
    )
    payload.update(overrides)
    return CustomerCreate(**payload)


def _user(role: Role, user_id: int = 1, branch_id: int | None = None) -> CurrentUser:
    return CurrentUser(id=user_id, role=role, branch_id=branch_id)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_company_requires_tax_code_and_contact():
    with pytest.raises(ValidationError):
        CustomerCreate(customer_type=CustomerType.COMPANY, name="No Tax Co", phone="+84933333333", branch_id=1)


def test_individual_rejects_company_only_fields():
    with pytest.raises(ValidationError):
        _individual(tax_code="0101112223")


def test_phone_format_is_validated():
    with pytest.raises(ValidationError):
        _individual(phone="not-a-phone")


def test_tax_code_format_is_validated():
    with pytest.raises(ValidationError):
        _company(tax_code="123")


def test_email_format_is_validated():
    with pytest.raises(ValidationError):
        _individual(email="not-an-email")


def test_name_length_is_validated():
    with pytest.raises(ValidationError):
        _individual(name="A")


def test_tags_are_deduplicated_and_capped():
    payload = _individual(tags=["VIP", "vip", "gold"])
    assert payload.tags == ["VIP", "gold"]

    with pytest.raises(ValidationError):
        _individual(tags=[f"tag{i}" for i in range(11)])


# ---------------------------------------------------------------------------
# Business rules: uniqueness
# ---------------------------------------------------------------------------


def test_phone_must_be_unique_within_branch_but_not_across_branches():
    user = _user(Role.ADMINISTRATOR)
    with pytest.raises(HTTPException) as exc:
        create_customer(_individual(phone="+84901111111"), user)  # matches seeded customer 1
    assert exc.value.status_code == 409

    # Same phone, different branch is fine.
    create_customer(_individual(phone="+84901111111", branch_id=9), user)


def test_tax_code_must_be_unique_system_wide():
    user = _user(Role.ADMINISTRATOR)
    with pytest.raises(HTTPException) as exc:
        create_customer(_company(tax_code="0101234567", branch_id=9), user)  # matches seeded customer 1
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# Business rules: status lifecycle
# ---------------------------------------------------------------------------


def test_status_lifecycle_allows_lead_to_active_and_active_to_inactive():
    customer = get_or_404(1)
    customer.status = CustomerStatus.LEAD
    user = _user(Role.SALES)

    change_status(customer, CustomerStatus.ACTIVE, user)
    assert customer.status == CustomerStatus.ACTIVE

    change_status(customer, CustomerStatus.INACTIVE, user)
    assert customer.status == CustomerStatus.INACTIVE

    change_status(customer, CustomerStatus.ACTIVE, user)
    assert customer.status == CustomerStatus.ACTIVE


def test_status_lifecycle_rejects_lead_to_inactive():
    customer = get_or_404(1)
    customer.status = CustomerStatus.LEAD
    with pytest.raises(HTTPException) as exc:
        change_status(customer, CustomerStatus.INACTIVE, _user(Role.SALES))
    assert exc.value.status_code == 422


def test_only_permitted_roles_can_change_status():
    customer = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        change_status(customer, CustomerStatus.INACTIVE, _user(Role.TECHNICIAN))
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Business rules: transfer
# ---------------------------------------------------------------------------


def test_transfer_restricted_to_branch_manager_and_administrator():
    customer = get_or_404(1)
    # Sales has full CRUD (update) on customers, but not the transfer action.
    with pytest.raises(HTTPException) as exc:
        transfer_branch(customer, 2, _user(Role.SALES))
    assert exc.value.status_code == 403


def test_branch_manager_can_only_transfer_within_their_own_branch():
    customer = get_or_404(1)  # branch 1
    with pytest.raises(HTTPException) as exc:
        transfer_branch(customer, 3, _user(Role.BRANCH_MANAGER, branch_id=2))
    assert exc.value.status_code == 403

    transfer_branch(customer, 2, _user(Role.BRANCH_MANAGER, branch_id=1))
    assert customer.branch_id == 2


def test_transfer_clears_assignment():
    customer = get_or_404(3)  # assigned to 10
    transfer_branch(customer, 2, _user(Role.ADMINISTRATOR))
    assert customer.assigned_to_id is None


# ---------------------------------------------------------------------------
# Business rules: reassignment
# ---------------------------------------------------------------------------


def test_sales_cannot_reassign_customers():
    customer = get_or_404(1)
    with pytest.raises(HTTPException) as exc:
        reassign(customer, 30, _user(Role.SALES))
    assert exc.value.status_code == 403


def test_reassign_requires_assignable_role_in_same_branch():
    customer = get_or_404(1)  # branch 1
    # user 20 is a technician in branch 2 -> wrong branch
    with pytest.raises(HTTPException) as exc:
        reassign(customer, 20, _user(Role.CUSTOMER_SERVICE))
    assert exc.value.status_code == 422

    # user 10 is a technician in branch 1 -> allowed
    reassign(customer, 10, _user(Role.CUSTOMER_SERVICE))
    assert customer.assigned_to_id == 10


# ---------------------------------------------------------------------------
# Business rules: delete / archive
# ---------------------------------------------------------------------------


def test_delete_archives_when_linked_records_exist_even_for_administrator():
    customer = get_or_404(1)
    result = delete_customer(customer, _user(Role.ADMINISTRATOR), has_linked_records=True)
    assert result["hard_deleted"] is False
    assert customer.status == CustomerStatus.INACTIVE
    assert 1 in CUSTOMERS  # still present, just archived


def test_delete_archives_for_non_administrator_even_without_linked_records():
    customer = get_or_404(1)
    result = delete_customer(customer, _user(Role.SALES), has_linked_records=False)
    assert result["hard_deleted"] is False
    assert 1 in CUSTOMERS


def test_delete_hard_deletes_for_administrator_with_no_linked_records():
    customer = get_or_404(1)
    result = delete_customer(customer, _user(Role.ADMINISTRATOR), has_linked_records=False)
    assert result["hard_deleted"] is True
    assert 1 not in CUSTOMERS


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


def test_update_cannot_blank_required_company_fields():
    customer = get_or_404(1)  # a company
    with pytest.raises(HTTPException) as exc:
        update_customer(customer, CustomerUpdate(contact_person=""), _user(Role.SALES))
    assert exc.value.status_code in (409, 422)


def test_update_rejects_phone_collision_within_branch():
    # Customer 1 and 3 are both in branch 1; updating 1's phone to 3's
    # phone should collide. Updating to its own existing phone must not.
    customer1 = get_or_404(1)
    update_customer(customer1, CustomerUpdate(phone=customer1.phone), _user(Role.SALES))

    with pytest.raises(HTTPException) as exc:
        update_customer(customer1, CustomerUpdate(phone="+84903333333"), _user(Role.SALES))  # matches customer 3
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# Search / views
# ---------------------------------------------------------------------------


def test_search_filters_by_type_and_source_and_tags():
    user = _user(Role.ADMINISTRATOR)
    create_customer(_individual(name="Tagged Lead", phone="+84944444444", tags=["gold"]), user)

    results = search_customers(user, Scope.ALL, customer_type=CustomerType.INDIVIDUAL, tags=["gold"])
    assert {c.name for c in results} == {"Tagged Lead"}


def test_search_excludes_archived_unless_requested():
    user = _user(Role.ADMINISTRATOR)
    customer = get_or_404(1)
    delete_customer(customer, user, has_linked_records=True)  # archives it

    visible = search_customers(user, Scope.ALL)
    assert 1 not in {c.id for c in visible}

    with_archived = search_customers(user, Scope.ALL, include_archived=True)
    assert 1 in {c.id for c in with_archived}


def test_search_assigned_me_and_unassigned():
    user = _user(Role.TECHNICIAN, user_id=10)
    mine = search_customers(user, Scope.ALL, assigned="me")
    assert {c.id for c in mine} == {3}

    unassigned = search_customers(user, Scope.ALL, assigned="unassigned")
    assert {c.id for c in unassigned} == {1, 2}


def test_pipeline_groups_customers_by_status():
    user = _user(Role.ADMINISTRATOR)
    grouped = pipeline(search_customers(user, Scope.ALL))
    assert set(grouped.keys()) == {"lead", "active", "inactive"}
    assert {c.id for c in grouped["active"]} == {1, 2, 3}


def test_find_duplicates_flags_same_name_same_branch():
    user = _user(Role.ADMINISTRATOR)
    create_customer(_individual(name="Acme Co", phone="+84955555555", branch_id=1), user)

    dup_groups = find_duplicates(search_customers(user, Scope.ALL))
    flagged_names = {c.name for group in dup_groups for c in group}
    assert "Acme Co" in flagged_names
