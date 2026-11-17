"""Large-data checks against a running server (same API the browser uses).

    python tools/acceptance/large_data.py <samples_dir> <out_dir> [--base http://127.0.0.1:8000] [--pid <server pid>]

Uploads the 25,000-row and 200,000-row samples, then exports at and beyond
the PDF/Word limits and the full 200,000 rows to Excel. Reports time, file
size, HTTP status, the server's error message, and (Linux, with --pid) the
server's peak memory. Exit code 1 if any check fails.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import httpx

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS" if ok else "FAIL"), name, f"[{detail}]" if detail else "")


def peak_rss_mb(pid):
    if not pid:
        return None
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]) // 1024
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("samples")
    ap.add_argument("out")
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--pid", type=int)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    c = httpx.Client(base_url=a.base, timeout=600, trust_env=False)

    def upload(name):
        t = time.time()
        with open(Path(a.samples) / name, "rb") as f:
            r = c.post("/api/datasets", files={"file": (name, f)}, data={"uploader": "Kiểm thử tải lớn"})
        check(f"Upload {name}", r.status_code == 201, f"HTTP {r.status_code}, {time.time() - t:.1f}s")
        return r.json()

    def export(ds, fmt, label, body, expect=200, save=True):
        t = time.time()
        r = c.post(f"/api/datasets/{ds['id']}/export/{fmt}", json=body)
        secs = time.time() - t
        if expect == 200:
            ok = r.status_code == 200 and len(r.content) > 0
            if ok and save:
                (out / f"{label}.{fmt}").write_bytes(r.content)
            check(f"{label}: {fmt.upper()} {r.headers.get('x-report-rows', '?')} dòng", ok,
                  f"HTTP {r.status_code}, {len(r.content) // 1024} KB, {secs:.1f}s, RSS đỉnh {peak_rss_mb(a.pid)} MB")
        else:
            msg = r.json().get("detail") if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
            check(f"{label}: {fmt.upper()} bị từ chối có thông báo", r.status_code == expect and msg, f"HTTP {r.status_code}: {msg}")
        return r

    mid = upload("DaiTrungBinh_25000.xlsx")
    sheet = mid["sheets"][0]["name"]
    check("25.000 dòng sau xử lý", mid["sheets"][0]["row_count"] == 25000, mid["sheets"][0]["row_count"])
    all_rows = {"sheet": sheet}
    export(mid, "pdf", "pdf_25000_vuot_gioi_han", all_rows, expect=422)
    export(mid, "pdf", "pdf_20000_dung_gioi_han", {"sheet": sheet, "row_indices": list(range(20000))})
    export(mid, "pdf", "pdf_20001", {"sheet": sheet, "row_indices": list(range(20001))}, expect=422)
    export(mid, "docx", "docx_5000_dung_gioi_han", {"sheet": sheet, "row_indices": list(range(5000))})
    export(mid, "docx", "docx_5001", {"sheet": sheet, "row_indices": list(range(5001))}, expect=422)
    export(mid, "pdf", "pdf_25000_khong_chi_tiet", {**all_rows, "sections": {"detail": False}})
    export(mid, "xlsx", "xlsx_25000", all_rows)

    big_name = next(p.name for p in Path(a.samples).glob("RatLon_*.xlsx"))
    big = upload(big_name)
    n = big["sheets"][0]["row_count"]
    check("Dữ liệu rất lớn sau xử lý", n == int(big_name.split("_")[1].split(".")[0]), n)
    bsheet = big["sheets"][0]["name"]
    r = export(big, "xlsx", f"xlsx_{n}_toan_bo", {"sheet": bsheet})
    if r.status_code == 200:
        import openpyxl
        wb = openpyxl.load_workbook(out / f"xlsx_{n}_toan_bo.xlsx", read_only=True)
        ws = wb["Dữ liệu chi tiết"]
        rows = sum(1 for r in ws.iter_rows(min_row=5, values_only=True) if any(v is not None for v in r))
        check("Excel rất lớn mở được, đủ dòng", rows == n, f"{rows} dòng")
    # Filtered + sorted subset: the browser sends a large row_indices list.
    idx = list(range(n - 1, -1, -2))
    export(big, "xlsx", "xlsx_loc_mot_nua_dao_thu_tu", {"sheet": bsheet, "row_indices": idx})
    export(big, "pdf", "pdf_rat_lon_vuot_gioi_han", {"sheet": bsheet}, expect=422)
    # The server must keep serving other requests while a big export runs.
    t = time.time()
    r = c.get("/api/datasets")
    check("API vẫn phản hồi sau các lần xuất lớn", r.status_code == 200, f"{(time.time() - t) * 1000:.0f} ms")
    print(f"\nRSS đỉnh của máy chủ: {peak_rss_mb(a.pid)} MB")
    (out / "large_results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    sys.exit(0 if all(ok for _, ok, _ in results) else 1)


if __name__ == "__main__":
    main()
