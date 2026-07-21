# hello-world
[![Tests](https://github.com/linhtd-Vishipel/hello-world/actions/workflows/tests.yml/badge.svg)](https://github.com/linhtd-Vishipel/hello-world/actions/workflows/tests.yml)

Kho lưu trữ Dữ liệu MSI

## Role-based permissions

Role definitions and the permission matrix are documented in [docs/RBAC.md](docs/RBAC.md).
The matrix is implemented in `app/permissions.py` and enforced via FastAPI
dependencies in `app/deps.py`, with a small demo API in `app/main.py`.

## Customer module

The Customers module is designed in [docs/CUSTOMER_MODULE.md](docs/CUSTOMER_MODULE.md)
and implemented in `app/customers.py` (schema, validation, business rules,
search/views), wired to HTTP routes in `app/main.py`.

```bash
pip install -r requirements.txt
pytest                        # run permission + API tests
uvicorn app.main:app --reload # run the demo API
```

## Vessel module (Odoo addon)

The Vessel module is a separate Odoo 17.0 addon, designed in
[docs/VESSEL_MODULE.md](docs/VESSEL_MODULE.md) and implemented in
[`addons/vessel_management/`](addons/vessel_management/). It tracks vessels
owned by customers (`res.partner`), their maritime communication equipment,
and maintenance work orders, with its own security groups and multi-company
scoping. It is independent of the FastAPI app above — install it into an
Odoo 17.0 instance with `addons/` on the addons path.
