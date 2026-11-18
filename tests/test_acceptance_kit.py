"""Tests for the Windows/Edge acceptance kit (tools/acceptance/nghiemthu.py + windows/*.bat).

The .bat files cannot run on Linux CI, so they are checked statically: CRLF,
ASCII only, labels that exist, the right orchestrator command, no characters
that cmd.exe would interpret inside echo text, and a pause so the window
stays open. All logic lives in nghiemthu.py, which is tested directly.
"""
import importlib
import json
import os
import re
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "tools" / "acceptance"
WIN = KIT / "windows"
DOC = ROOT / "docs" / "EXCEL_DASHBOARD_NGHIEM_THU.md"
BATS = {
    "01_KIEM_TRA_MOI_TRUONG.bat": "kiem-tra",
    "02_TAO_DU_LIEU_MAU.bat": "tao-du-lieu",
    "03_CAI_DAT_THU_VIEN.bat": "cai-dat",
    "04_KIEM_THU_EDGE.bat": "kiem-thu-edge",
    "05_DOI_CHIEU_KET_QUA.bat": "doi-chieu",
    "06_TONG_HOP_BAO_CAO.bat": "tong-hop",
}


@pytest.fixture
def kit(tmp_path, monkeypatch):
    monkeypatch.setenv("NGHIEMTHU_DIR", str(tmp_path / "edge"))
    monkeypatch.setenv("NGHIEMTHU_CONG_CU", str(tmp_path / "cong_cu"))
    monkeypatch.delenv("NGHIEMTHU_BROWSER", raising=False)
    monkeypatch.delenv("NGHIEMTHU_EXE", raising=False)
    sys.path.insert(0, str(KIT))
    try:
        mod = importlib.reload(importlib.import_module("nghiemthu"))
        yield mod
    finally:
        sys.path.remove(str(KIT))


# ---------------------------------------------------------------------------
# .bat files
# ---------------------------------------------------------------------------


def test_bat_files_exist_with_required_names():
    names = sorted(p.name for p in WIN.glob("*.bat"))
    assert names == sorted(list(BATS) + ["_chung.bat", "MO_THU_MUC_KET_QUA.bat"])


@pytest.mark.parametrize("name", sorted(list(BATS) + ["_chung.bat", "MO_THU_MUC_KET_QUA.bat", "../../../BAT_DAU_NGHIEM_THU_EDGE.bat"]))
def test_bat_file_is_safe_for_cmd(name):
    raw = (WIN / name).read_bytes()
    assert raw.isascii(), "BAT must be ASCII (no code page problems in cmd.exe)"
    assert b"\r\n" in raw and raw.count(b"\n") == raw.count(b"\r\n"), "BAT must use CRLF line endings"
    text = raw.decode("ascii")
    labels = set(re.findall(r"(?mi)^:(\w+)\s*$", text))
    for target in re.findall(r"(?i)\bgoto\s+:?(\w+)", text):
        assert target.lower() == "eof" or target in labels, f"goto {target} has no label"
    for line in text.splitlines():
        if re.match(r"\s*echo\b", line, re.I) and not line.strip().lower() in ("echo.", "@echo off"):
            body = line.split(None, 1)[1] if " " in line.strip() else ""
            assert not re.search(r"[()&|<>^]", body), f"cmd-special character in echo: {line!r}"


@pytest.mark.parametrize("name,command", BATS.items())
def test_step_bat_calls_orchestrator(name, command):
    text = (WIN / name).read_text(encoding="ascii")
    assert 'call "%~dp0_chung.bat"' in text
    assert f'%PY% "%TOOL%" {command}' in text
    assert re.search(r"(?mi)^pause\s*$", text), "window must stay open"
    assert text.index("call ") < text.index("%PY%")
    # the real exit code of _chung.bat and of the Python step is kept and returned
    assert text.count('set "MA=%ERRORLEVEL%"') == 2
    assert text.index("%PY%") < text.rindex('set "MA=%ERRORLEVEL%"')
    assert text.rstrip().endswith("endlocal & exit /b %MA%")


def test_common_bat_finds_python_and_tool():
    text = (WIN / "_chung.bat").read_text(encoding="ascii")
    assert r'set "TOOL=%~dp0..\nghiemthu.py"' in text
    assert (WIN / ".." / "nghiemthu.py").resolve().is_file()
    # Tested versions first, then newest Python 3, then python.exe; each candidate is test-run,
    # which rejects the Microsoft Store "python" alias stub.
    order = [text.index(f'{c} -c "import sys"') for c in ("py -3.13", "py -3.12", "py -3.11", "py -3", "python")]
    assert order == sorted(order)
    assert r'set "NGHIEMTHU_DIR=C:\nghiemthu\edge"' in text
    assert "if not defined NGHIEMTHU_DIR" in text  # a user-set folder is respected
    assert 'set "PYTHONDONTWRITEBYTECODE=1"' in text


def test_gitattributes_keeps_bat_crlf():
    assert "*.bat -text" in (ROOT / ".gitattributes").read_text()


def test_orchestrator_commands_match_bats(kit):
    assert set(kit.COMMANDS) == set(BATS.values())
    assert str(kit.EDGE_DIR).endswith("edge")


# ---------------------------------------------------------------------------
# M01–M12 come verbatim from the acceptance document
# ---------------------------------------------------------------------------


def test_manual_items_are_verbatim_from_doc(kit):
    items = kit.manual_items()
    assert [i["ma"] for i in items] == [f"M{n:02d}" for n in range(1, 13)]
    doc = DOC.read_text(encoding="utf-8")
    for it in items:
        assert f"| {it['ma']} | {it['thao_tac']} | {it['mong_doi']} | |" in doc


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _complete_run(kit, *, channel="msedge", manual="P", ui_fail=None, ui_count=42, verify_first=False):
    d = kit.DIRS
    _write(kit.EDGE_DIR / "moi_truong.json", {"muc": [], "dat": True})
    ui = [{"id": f"T{i:02d}", "name": f"bài {i}", "pass": f"T{i:02d}" != ui_fail, "detail": "<script>x</script>"}
          for i in range(1, ui_count + 1)]
    browser = {"name": "msedge", "version": "142", "userAgent": "Edg/142", "launch": {"channel": channel, "executablePath": None}}
    if verify_first:
        _write(d["tu_dong"] / "verify_results.json", {"total": 1, "passed": 1, "failed": 0, "checks": [{"group": "G", "name": "n", "pass": True, "detail": ""}]})
        time.sleep(0.05)
    _write(d["tu_dong"] / "ui_results.json", ui)
    _write(d["tu_dong"] / "ui_summary.json", {"browser": browser, "sections": [{"id": "S01", "name": "x", "tests": ["T01"], "seconds": 3}]})
    if not verify_first:
        time.sleep(0.05)
        _write(d["tu_dong"] / "verify_results.json", {"total": 1, "passed": 1, "failed": 0, "checks": [{"group": "G", "name": "n", "pass": True, "detail": ""}]})
    _write(d["lon"] / "large_results.json", [["Upload", True, "ok"]])
    res = {f"M{n:02d}": {"ket_qua": manual if isinstance(manual, str) else manual.get(f"M{n:02d}", "P"), "ghi_chu": ""} for n in range(1, 13)}
    _write(kit.MANUAL_FILE, {"nguoi_kiem_thu": "Trần Thị Mai", "ket_qua": res})


def test_verdict_nothing_run(kit):
    r = kit.build_report()
    assert r["ket_luan"] == "KHÔNG ĐẠT" and r["phan_loai"].startswith("CHƯA ĐỦ ĐIỀU KIỆN")
    assert (r["tong"], r["pass"], r["fail"], r["chua"]) == (42 + 1 + 1 + 12, 0, 0, 56)
    assert [x["ma"] for x in r["nhom"][0]["rows"]] == [f"T{i:02d}" for i in range(1, 43)]
    assert all(x["kq"] == "CHƯA KIỂM THỬ" for g in r["nhom"] for x in g["rows"])
    assert [(s["ma"], s["trang_thai"]) for s in r["cac_buoc"]] == [(f"0{i}", "CHƯA CHẠY") for i in range(1, 7)]


def test_verdict_all_pass_on_edge(kit):
    _complete_run(kit, manual={"M09": "C"})
    r = kit.build_report()
    assert r["ket_luan"] == "ĐẠT", r["ly_do_chua_du"] + r["ly_do_fail"]
    assert (r["tong"], r["pass"], r["fail"], r["chua"]) == (42 + 1 + 1 + 12, 56, 0, 0)


def test_verdict_manual_fail(kit):
    _complete_run(kit, manual={"M07": "F"})
    assert kit.build_report()["ket_luan"] == "KHÔNG ĐẠT"


def test_verdict_ui_fail_links_screenshot(kit):
    _complete_run(kit, ui_fail="T05")
    (kit.DIRS["tu_dong"] / "loi_T05.png").write_bytes(b"png")
    r = kit.build_report()
    assert r["ket_luan"] == "KHÔNG ĐẠT"
    row = next(x for g in r["nhom"] for x in g["rows"] if x["ma"] == "T05")
    assert row["anh"] == ["ket_qua_tu_dong/loi_T05.png"]


def test_verdict_not_edge_is_not_valid(kit):
    _complete_run(kit, channel=None)
    r = kit.build_report()
    assert r["ket_luan"] == "KHÔNG ĐẠT"
    assert any("KHÔNG phải Microsoft Edge" in x for x in r["ly_do_chua_du"])


def test_verdict_missing_ui_tests_or_stale_verify(kit):
    _complete_run(kit, ui_count=38)
    assert kit.build_report()["ket_luan"] == "KHÔNG ĐẠT"
    _complete_run(kit, verify_first=True)
    assert any("cũ hơn" in x for x in kit.build_report()["ly_do_chua_du"])


def test_verdict_manual_not_checked(kit):
    _complete_run(kit, manual={"M03": "B"})
    r = kit.build_report()
    assert r["ket_luan"] == "KHÔNG ĐẠT" and r["chua"] == 1
    assert next(x for x in r["nhom"][3]["rows"] if x["ma"] == "M03")["kq"] == "CHƯA KIỂM THỬ"


def test_verdict_environment_error(kit):
    _complete_run(kit)
    _write(kit.EDGE_DIR / "moi_truong.json", {"dat": False, "muc": [
        {"ten": "Poppler", "trang_thai": "FAIL", "chi_tiet": "không tìm thấy", "huong_dan": ""}]})
    r = kit.build_report()
    assert r["ket_luan"] == "KHÔNG ĐẠT" and r["loi_moi_truong"][0]["ten"] == "Poppler"
    assert any("Poppler" in x for x in r["ly_do_fail"])


def test_report_files_escape_content(kit):
    _complete_run(kit)
    assert kit.cmd_tong_hop(kit.Log("06"), ask=False, open_report=False) == 0
    page = (kit.EDGE_DIR / "BAO_CAO_NGHIEM_THU.html").read_text(encoding="utf-8")
    assert "<script>x</script>" not in page and "&lt;script&gt;" in page
    assert "KẾT LUẬN: ĐẠT" in page and "Tổng số bài kiểm thử:</b> 56" in page
    for section in ("6 bước thực hiện", "Lỗi môi trường (bước 01)", "Chi tiết lỗi", "Vị trí lưu log và ảnh", "M12"):
        assert section in page
    assert str(kit.DIRS["logs"]) in page and str(kit.DIRS["anh"]) in page
    assert "KẾT LUẬN: ĐẠT" in (kit.EDGE_DIR / "BAO_CAO_NGHIEM_THU.md").read_text(encoding="utf-8")
    assert json.loads((kit.EDGE_DIR / "ket_qua_tong_hop.json").read_text(encoding="utf-8"))["ket_luan"] == "ĐẠT"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_log_run_timeout_and_exit_code(kit):
    log = kit.Log("04")
    assert log.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=1) == 124
    assert log.run([sys.executable, "-c", "print('Tiếng Việt'); raise SystemExit(3)"]) == 3
    assert log.run(["khong-co-lenh-nay-xyz"]) == 127
    log.close()
    assert "Tiếng Việt" in log.path.read_text(encoding="utf-8")


def test_find_poppler_via_env(kit, tmp_path, monkeypatch):
    bindir = tmp_path / "poppler" / "Library" / "bin"
    bindir.mkdir(parents=True)
    ext = ".exe" if os.name == "nt" else ""
    for t in kit.POPPLER_TOOLS[:-1]:
        (bindir / f"{t}{ext}").write_text("x")
    monkeypatch.setenv("POPPLER_BIN", str(bindir))
    monkeypatch.setenv("PATH", str(tmp_path))
    assert kit.find_poppler() is None  # pdfimages missing -> not accepted
    (bindir / f"pdfimages{ext}").write_text("x")
    assert kit.find_poppler() == str(bindir)


def test_venv_modules_all_present_regression(kit, monkeypatch):
    """An empty 'missing' line means everything imported (bug found in the dry run)."""
    kit.VPY.parent.mkdir(parents=True)
    kit.VPY.write_text("")
    monkeypatch.setattr(kit, "capture", lambda cmd, timeout=60: (0, ""))
    assert kit.venv_modules()[0] is True
    monkeypatch.setattr(kit, "capture", lambda cmd, timeout=60: (0, "psutil,httpx"))
    assert kit.venv_modules() == (False, "thiếu: psutil, httpx")


def test_log_run_error_does_not_hang(kit, monkeypatch):
    """Regression: an exception while streaming output (e.g. BrokenPipe, Ctrl+C) left the
    timeout timer as a non-daemon thread, so the window hung for up to an hour on exit."""
    import threading

    log = kit.Log("05")

    def boom(self, msg=""):
        if "tick" in msg:
            raise BrokenPipeError("console closed")

    monkeypatch.setattr(kit.Log, "line", boom)
    t0 = time.time()
    with pytest.raises(BrokenPipeError):
        log.run([sys.executable, "-c", "import time\nprint('tick', flush=True)\ntime.sleep(30)"], timeout=3600)
    assert time.time() - t0 < 10, "child must be killed, not awaited"
    assert not [t for t in threading.enumerate() if t is not threading.main_thread() and not t.daemon]


def test_port_free_detects_listener_but_not_time_wait(kit):
    import socket

    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    srv.listen()
    assert kit.port_free(port) is False  # a real listener is busy
    cli = socket.create_connection(("127.0.0.1", port))
    conn, _ = srv.accept()
    conn.close()  # server side closes first -> its end lingers in TIME_WAIT
    cli.close()
    srv.close()
    assert kit.port_free(port) is True  # TIME_WAIT only: free for the next step


def test_open_results_helpers_point_to_real_places():
    opener = (WIN / "MO_THU_MUC_KET_QUA.bat").read_text(encoding="ascii")
    assert r'set "NGHIEMTHU_DIR=C:\nghiemthu\edge"' in opener
    assert r'"%NGHIEMTHU_DIR%\BAO_CAO_NGHIEM_THU.html"' in opener
    launcher = (ROOT / "BAT_DAU_NGHIEM_THU_EDGE.bat").read_text(encoding="ascii")
    target = re.search(r'explorer "%~dp0([^"]+)"', launcher).group(1)
    assert (ROOT / target.replace("\\", "/")).is_dir()
    assert (ROOT / target.replace("\\", "/") / "01_KIEM_TRA_MOI_TRUONG.bat").is_file()


def test_report_files_are_backed_up_not_overwritten(kit):
    _complete_run(kit)
    kit.cmd_tong_hop(kit.Log("06"), ask=False, open_report=False)
    first = (kit.EDGE_DIR / "BAO_CAO_NGHIEM_THU.html").read_bytes()
    time.sleep(1.1)  # backups are grouped per second
    kit.cmd_tong_hop(kit.Log("06"), ask=False, open_report=False)
    backups = list(kit.DIRS["luu"].glob("*/bao_cao/BAO_CAO_NGHIEM_THU.html"))
    assert len(backups) == 1 and backups[0].read_bytes() == first


def test_step_04_refuses_without_successful_install(kit, monkeypatch):
    monkeypatch.setattr(kit, "venv_modules", lambda: (True, "đủ"))
    monkeypatch.setattr(kit, "playwright_version", lambda: "1.63.0")
    monkeypatch.setattr(kit, "find_test_browser", lambda: ("msedge.exe", "142"))
    for f in kit.SAMPLE_FILES:
        (kit.DIRS["mau"] / f).parent.mkdir(parents=True, exist_ok=True)
        (kit.DIRS["mau"] / f).write_bytes(b"x")
    log = kit.Log("04")
    assert kit.preconditions(log) is False  # no marker: step 03 (npm ci, browser launch) never succeeded
    kit.save_json(kit.INSTALL_MARKER, {"luc": "now"})
    assert kit.preconditions(log) is True
    log.close()
    assert "Bước 03 chưa hoàn tất thành công" in log.path.read_text(encoding="utf-8")


def test_kit_never_writes_to_git_or_web_app_sources():
    for f in list(KIT.glob("*.py")) + list(KIT.glob("*.js")) + list(WIN.glob("*.bat")) + [ROOT / "BAT_DAU_NGHIEM_THU_EDGE.bat"]:
        text = f.read_text(encoding="utf-8", errors="replace")
        assert not re.search(r"\bgit\b[^\n]*\b(commit|push|checkout|reset|merge|rebase|add|clean|stash)\b", text), f
    src = (KIT / "nghiemthu.py").read_text(encoding="utf-8")
    assert '"rev-parse", "--short", "HEAD"' in src  # read-only git use
    assert "EXCEL_DASHBOARD_DATA_DIR" in src and "PYTHONDONTWRITEBYTECODE" in src


def test_environment_variable_names_are_consistent():
    src = (KIT / "nghiemthu.py").read_text(encoding="utf-8")
    used = set(re.findall(r'os\.environ\.get\("((?:NGHIEMTHU|POPPLER)_[A-Z_]+)"', src))
    assert used == {"NGHIEMTHU_DIR", "NGHIEMTHU_CONG_CU", "NGHIEMTHU_PORT", "NGHIEMTHU_BROWSER", "NGHIEMTHU_EXE",
                    "POPPLER_BIN", "NGHIEMTHU_SOFFICE"}
    assert 'os.environ.get("NGHIEMTHU_SOFFICE")' in (KIT / "verify.py").read_text(encoding="utf-8")
    guide = (ROOT / "docs" / "HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md").read_text(encoding="utf-8")
    for name in ("POPPLER_BIN", "NGHIEMTHU_SOFFICE", "NGHIEMTHU_DIR", "NGHIEMTHU_PORT"):
        assert name in guide, name
    bat_vars = set(re.findall(r"%([A-Z_]+)%", "".join(p.read_text(encoding="ascii") for p in WIN.glob("*.bat"))))
    assert bat_vars <= {"NGHIEMTHU_DIR", "PY", "TOOL", "ERRORLEVEL", "MA"}, bat_vars


def test_runs_from_any_working_directory_and_paths_with_spaces(tmp_path):
    import subprocess

    out = tmp_path / "thu muc co dau cach" / "edge"
    env = {**os.environ, "NGHIEMTHU_DIR": str(out), "NGHIEMTHU_CONG_CU": str(tmp_path / "cong cu"), "PYTHONUTF8": "1"}
    r = subprocess.run([sys.executable, str(KIT / "nghiemthu.py"), "kiem-tra"], cwd="/", env=env,
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert "Thư mục kết quả không có dấu tiếng Việt: " in r.stdout and str(ROOT) in r.stdout
    assert (out / "logs" / "01_kiem_tra_moi_truong.log").is_file()
    for sub in ("mau", "ket_qua_tu_dong", "ket_qua_du_lieu_lon", "thu_cong/anh", "logs"):
        assert (out / sub).is_dir(), sub


def test_vietnamese_results_folder_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("NGHIEMTHU_DIR", str(tmp_path / "kết quả" / "edge"))
    sys.path.insert(0, str(KIT))
    try:
        mod = importlib.reload(importlib.import_module("nghiemthu"))
        item = next(i for i in mod.env_items() if i["ten"].startswith("Thư mục kết quả"))
        assert item["trang_thai"] == "FAIL" and "Poppler" in item["huong_dan"]
    finally:
        sys.path.remove(str(KIT))
