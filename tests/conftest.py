import pytest

from app import customers as customers_module
from app import devices as devices_module


@pytest.fixture(autouse=True)
def reset_customers_store():
    """Each test starts from the same seeded customer data, since the
    module keeps its store as module-level state shared across tests.
    """
    customers_module.CUSTOMERS.clear()
    customers_module.AUDIT_LOG.clear()
    customers_module._seed_demo_data()


@pytest.fixture(autouse=True)
def reset_devices_store():
    """Each test starts from the same seeded device data, since the module
    keeps its store as module-level state shared across tests.
    """
    devices_module.DEVICES.clear()
    devices_module.AUDIT_LOG.clear()
    devices_module._seed_demo_data()
