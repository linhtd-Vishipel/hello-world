"""Short-lived, in-memory store of generated report files.

The browser downloads a report with a plain GET request to /api/exports/<token>
so that Microsoft Edge (and other browsers) treat it as a normal file download:
it follows the user's download folder and "ask where to save" settings and is
listed in the downloads panel (Ctrl+J). Nothing is written to disk; entries
expire after TTL_SECONDS and the store never holds more than MAX_BYTES.
"""
import secrets
import threading
import time

TTL_SECONDS = 60 * 60
MAX_BYTES = 512 * 1024 * 1024
MAX_ITEMS = 100

_lock = threading.Lock()
_items = {}  # token -> {"content", "fmt", "filename", "rows", "created"}


def _prune(now):
    for t in [t for t, v in _items.items() if now - v["created"] > TTL_SECONDS]:
        del _items[t]
    order = sorted(_items, key=lambda t: _items[t]["created"])
    while len(order) > 1 and (len(_items) > MAX_ITEMS or sum(len(v["content"]) for v in _items.values()) > MAX_BYTES):
        del _items[order.pop(0)]


def put(content: bytes, fmt: str, filename: str, rows: int) -> str:
    token = secrets.token_urlsafe(24)
    now = time.time()
    with _lock:
        _items[token] = {"content": content, "fmt": fmt, "filename": filename, "rows": rows, "created": now}
        _prune(now)
    return token


def get(token: str):
    with _lock:
        _prune(time.time())
        return _items.get(token)
