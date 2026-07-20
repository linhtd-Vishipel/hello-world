# hello-world
Kho lưu trữ Dữ liệu MSI

## Role-based permissions

Role definitions and the permission matrix are documented in [docs/RBAC.md](docs/RBAC.md).
The matrix is implemented in `app/permissions.py` and enforced via FastAPI
dependencies in `app/deps.py`, with a small demo API in `app/main.py`.

```bash
pip install -r requirements.txt
pytest                        # run permission + API tests
uvicorn app.main:app --reload # run the demo API
```
