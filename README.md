# hello-world
Kho lưu trữ Dữ liệu MSI

## Role-based permissions

Role definitions and the permission matrix are documented in [docs/RBAC.md](docs/RBAC.md).
The matrix is implemented in `app/permissions.py` and enforced via FastAPI
dependencies in `app/deps.py`, with a small demo API in `app/main.py`.

## Customer module

The Customers module is designed in [docs/CUSTOMER_MODULE.md](docs/CUSTOMER_MODULE.md)
and implemented in `app/customers.py` (schema, validation, business rules,
search/views), wired to HTTP routes in `app/main.py`.

## Device module

The Devices module is designed in [docs/DEVICE_MODULE.md](docs/DEVICE_MODULE.md)
and implemented in `app/devices.py` (schema, validation, business rules,
search/views), wired to HTTP routes in `app/main.py`. Devices track
customer-owned equipment for service history and warranty.

```bash
pip install -r requirements.txt
pytest                        # run permission + API tests
uvicorn app.main:app --reload # run the demo API
```
