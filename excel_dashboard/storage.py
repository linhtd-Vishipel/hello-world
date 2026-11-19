"""File-based storage for uploaded datasets.

Layout under DATA_DIR (env EXCEL_DASHBOARD_DATA_DIR, default ./data/excel_dashboard):
    index.json              list of dataset metadata, newest first
    <id>/data.json          parsed sheets (columns + rows)
    <id>/dashboard.json     saved custom charts per sheet
    <id>/original.<ext>     the uploaded file, kept for audit/re-download
"""
import json
import os
import re
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_lock = threading.Lock()


def data_dir() -> Path:
    path = Path(os.environ.get("EXCEL_DASHBOARD_DATA_DIR", "data/excel_dashboard"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _dataset_dir(dataset_id: str) -> Path:
    if not _ID_RE.match(dataset_id or ""):
        raise KeyError(dataset_id)
    return data_dir() / dataset_id


def _write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def _read_index() -> list:
    path = data_dir() / "index.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def list_datasets() -> list:
    return _read_index()


def save_dataset(filename: str, content: bytes, sheets: list, uploader: str, title: str) -> dict:
    dataset_id = uuid.uuid4().hex
    ddir = _dataset_dir(dataset_id)
    ddir.mkdir(parents=True)
    ext = filename.rsplit(".", 1)[-1].lower()
    (ddir / f"original.{ext}").write_bytes(content)
    _write_json(ddir / "data.json", sheets)
    _write_json(ddir / "dashboard.json", {})
    meta = {
        "id": dataset_id,
        "title": title or filename.rsplit(".", 1)[0],
        "filename": filename,
        "uploader": uploader,
        "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "size_bytes": len(content),
        "sheets": [
            {"name": s["name"], "row_count": s["row_count"], "column_count": len(s["columns"])}
            for s in sheets
        ],
    }
    with _lock:
        index = _read_index()
        index.insert(0, meta)
        _write_json(data_dir() / "index.json", index)
    return meta


def get_meta(dataset_id: str) -> dict:
    for meta in _read_index():
        if meta["id"] == dataset_id:
            return meta
    raise KeyError(dataset_id)


def get_sheets(dataset_id: str) -> list:
    path = _dataset_dir(dataset_id) / "data.json"
    if not path.exists():
        raise KeyError(dataset_id)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def original_path(dataset_id: str) -> Path:
    ddir = _dataset_dir(dataset_id)
    for p in ddir.glob("original.*"):
        return p
    raise KeyError(dataset_id)


def get_dashboard(dataset_id: str) -> dict:
    path = _dataset_dir(dataset_id) / "dashboard.json"
    if not path.exists():
        raise KeyError(dataset_id)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_dashboard(dataset_id: str, config: dict) -> dict:
    path = _dataset_dir(dataset_id) / "dashboard.json"
    if not path.exists():
        raise KeyError(dataset_id)
    _write_json(path, config)
    return config


def delete_dataset(dataset_id: str) -> None:
    ddir = _dataset_dir(dataset_id)
    with _lock:
        index = _read_index()
        new_index = [m for m in index if m["id"] != dataset_id]
        if len(new_index) == len(index):
            raise KeyError(dataset_id)
        _write_json(data_dir() / "index.json", new_index)
    shutil.rmtree(ddir, ignore_errors=True)
