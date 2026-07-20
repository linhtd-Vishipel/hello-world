import pytest

from app import customers as customers_module


@pytest.fixture(autouse=True)
def reset_customers_store():
    """Each test starts from the same seeded customer data, since the
    module keeps its store as module-level state shared across tests.
    """
    customers_module.CUSTOMERS.clear()
    customers_module.AUDIT_LOG.clear()
    customers_module._seed_demo_data()
