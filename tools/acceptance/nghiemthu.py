"""Bộ nghiệm thu Microsoft Edge cho Excel Dashboard (Windows 10/11).

Các file 01_..06_*.bat trong thư mục windows/ gọi chương trình này:

    python nghiemthu.py kiem-tra        # 01 kiểm tra môi trường
    python nghiemthu.py tao-du-lieu     # 02 tạo dữ liệu mẫu
    python nghiemthu.py cai-dat         # 03 cài thư viện
    python nghiemthu.py kiem-thu-edge   # 04 kiểm thử tự động trên Edge
    python nghiemthu.py doi-chieu       # 05 đối chiếu kết quả + dữ liệu lớn
    python nghiemthu.py tong-hop        # 06 nhập M01–M12 + lập báo cáo

Chỉ dùng thư viện chuẩn của Python: chạy được ngay sau khi cài Python.
Các bước cần thư viện (openpyxl, httpx, ...) chạy bằng môi trường ảo riêng
tạo ở bước 03 (02 tự tạo phần tối thiểu nếu chưa có).

Cấu hình qua biến môi trường (không bắt buộc):
    NGHIEMTHU_DIR      thư mục kết quả        (mặc định C:\\nghiemthu\\edge)
    NGHIEMTHU_CONG_CU  thư mục công cụ (venv) (mặc định C:\\nghiemthu\\cong_cu)
    NGHIEMTHU_PORT     cổng máy chủ thử       (mặc định 8765)
    POPPLER_BIN        thư mục bin của Poppler
    NGHIEMTHU_SOFFICE  đường dẫn soffice.exe của LibreOffice
    NGHIEMTHU_BROWSER  msedge (mặc định). Giá trị khác chỉ dùng để thử bộ công cụ,
    NGHIEMTHU_EXE      báo cáo khi đó luôn ghi "không hợp lệ cho nghiệm thu Edge".
"""
import argparse
import html
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

IS_WIN = os.name == "nt"
ACC = Path(__file__).resolve().parent
ROOT = ACC.parents[1]
DOC = ROOT / "docs" / "EXCEL_DASHBOARD_NGHIEM_THU.md"
EDGE_DIR = Path(os.environ.get("NGHIEMTHU_DIR") or (r"C:\nghiemthu\edge" if IS_WIN else Path.home() / "nghiemthu" / "edge"))
TOOLS = Path(os.environ.get("NGHIEMTHU_CONG_CU") or EDGE_DIR.parent / "cong_cu")
VENV = TOOLS / "venv"
VPY = VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")
PORT = int(os.environ.get("NGHIEMTHU_PORT") or 8765)
BASE = f"http://127.0.0.1:{PORT}"
BROWSER = os.environ.get("NGHIEMTHU_BROWSER") or "msedge"
BROWSER_EXE = os.environ.get("NGHIEMTHU_EXE") or ""
DIRS = {
    "mau": EDGE_DIR / "mau",                          # dữ liệu mẫu (đầu vào)
    "may_chu": EDGE_DIR / "du_lieu_may_chu",          # dữ liệu của Web App khi kiểm thử
    "tu_dong": EDGE_DIR / "ket_qua_tu_dong",          # file tải về, ảnh, kết quả 04 + 05
    "lon": EDGE_DIR / "ket_qua_du_lieu_lon",          # kết quả kiểm tra dữ liệu lớn
    "thu_cong": EDGE_DIR / "thu_cong",                # kết quả M01–M12
    "anh": EDGE_DIR / "thu_cong" / "anh",             # ảnh chụp lỗi kiểm thử thủ công
    "logs": EDGE_DIR / "logs",
    "luu": EDGE_DIR / "lan_chay_truoc",               # kết quả các lần chạy trước (không xoá)
}
SAMPLE_FILES = ["SoTheoDoi_DoanhThu_2026.xlsx", "NganGon_3Dong.xlsx", "QuyTac_Gia.xlsx",
                "RatRong_40Cot.xlsx", "DaiTrungBinh_25000.xlsx", "RatLon_200000.xlsx"]
PY_MODULES = ["fastapi", "uvicorn", "multipart", "openpyxl", "xlrd", "reportlab", "docx", "httpx", "psutil"]
POPPLER_TOOLS = ["pdftotext", "pdfinfo", "pdffonts", "pdfimages"]
STEP_NAMES = {
    "01": "Kiểm tra môi trường", "02": "Tạo dữ liệu mẫu", "03": "Cài đặt thư viện",
    "04": "Kiểm thử tự động trên Edge", "05": "Đối chiếu kết quả", "06": "Tổng hợp báo cáo",
}

LOG_NAMES = {"01": "kiem_tra_moi_truong", "02": "tao_du_lieu_mau", "03": "cai_dat_thu_vien",
             "04": "kiem_thu_edge", "05": "doi_chieu_ket_qua", "06": "tong_hop_bao_cao"}

HUONG_DAN = {
    "python": "Cài Python 3.11 trở lên từ https://www.python.org/downloads/windows/ — khi cài, tích "
              "\"Add python.exe to PATH\". Cài xong đóng cửa sổ này và mở lại file BAT.",
    "node": "Cài Node.js bản LTS (20 trở lên) từ https://nodejs.org/ (file .msi, chọn mặc định). "
            "Cài xong đóng cửa sổ này và mở lại file BAT.",
    "edge": "Cài/cập nhật Microsoft Edge từ https://www.microsoft.com/edge, rồi mở edge://settings/help để cập nhật.",
    "poppler": "Poppler dùng để đọc và kiểm tra file PDF. Cách cài:\n"
               "  1. Mở https://github.com/oschwartz10612/poppler-windows/releases\n"
               "  2. Ở bản phát hành mới nhất, tải file Release-<phiên bản>.zip\n"
               "  3. Giải nén vào thư mục C:\\nghiemthu\\cong_cu\\poppler\n"
               "     (sau khi giải nén phải có file ...\\poppler\\poppler-<phiên bản>\\Library\\bin\\pdftotext.exe)\n"
               "  4. Chạy lại 01_KIEM_TRA_MOI_TRUONG.bat — bộ công cụ tự tìm Poppler trong thư mục này.\n"
               "  (Hoặc đặt biến môi trường POPPLER_BIN trỏ tới thư mục chứa pdftotext.exe.)",
    "libreoffice": "LibreOffice dùng để mở thử file Word/Excel và kiểm tra trình bày. Cài từ "
                   "https://www.libreoffice.org/download/ (bản Windows x86-64, chọn mặc định). "
                   "Nếu cài vào thư mục khác C:\\Program Files\\LibreOffice, đặt biến NGHIEMTHU_SOFFICE "
                   "trỏ tới soffice.exe.",
    "thu_vien": "Chạy 03_CAI_DAT_THU_VIEN.bat.",
    "mau": "Chạy 02_TAO_DU_LIEU_MAU.bat.",
}


# ---------------------------------------------------------------------------
# Log: ghi đồng thời ra màn hình và file log (UTF-8)
# ---------------------------------------------------------------------------


class Log:
    def __init__(self, step):
        DIRS["logs"].mkdir(parents=True, exist_ok=True)
        self.path = DIRS["logs"] / f"{step}_{LOG_NAMES[step]}.log"
        self.f = open(self.path, "a", encoding="utf-8")
        self.line("")
        self.line("=" * 78)
        self.line(f"BƯỚC {step}: {STEP_NAMES[step].upper()} — bắt đầu {datetime.now():%d/%m/%Y %H:%M:%S}")
        self.line("=" * 78)

    def line(self, msg=""):
        # Lỗi hiển thị trên màn hình (ký tự không hiển thị được, cửa sổ/ống dẫn bị đóng)
        # không được làm dừng kiểm thử: log file luôn được ghi đủ.
        try:
            print(msg, flush=True)
        except UnicodeEncodeError:
            try:
                print(msg.encode("ascii", "replace").decode(), flush=True)
            except (OSError, ValueError):
                pass
        except (OSError, ValueError):
            pass
        self.f.write(msg + "\n")
        self.f.flush()

    def run(self, cmd, cwd=None, env=None, timeout=None, prefix="    "):
        """Chạy lệnh, hiện và ghi log từng dòng. Trả về mã thoát (124 nếu quá giờ)."""
        self.line(f"$ {' '.join(str(c) for c in cmd)}")
        try:
            proc = subprocess.Popen([str(c) for c in cmd], cwd=cwd, env=env or child_env(), stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        except OSError as exc:
            self.line(f"{prefix}[LỖI] Không chạy được lệnh: {exc}")
            return 127
        fired = threading.Event()

        def kill():
            fired.set()
            proc.kill()

        timer = threading.Timer(timeout, kill) if timeout else None
        if timer:
            timer.daemon = True  # never keep the window open after an error
            timer.start()
        try:
            for out in proc.stdout:
                self.line(prefix + out.rstrip("\n"))
            code = proc.wait()
        finally:
            if timer:
                timer.cancel()
            if proc.poll() is None:  # stopped by an error or Ctrl+C: do not leave the child running
                proc.kill()
        if fired.is_set():
            self.line(f"{prefix}[LỖI] Quá thời gian {timeout} giây, đã dừng lệnh.")
            return 124
        return code

    def close(self):
        self.f.close()


def child_env(extra=None):
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    no_proxy = "127.0.0.1,localhost"
    for k in ("NO_PROXY", "no_proxy"):
        env[k] = f"{env[k]},{no_proxy}" if env.get(k) else no_proxy
    if extra:
        env.update(extra)
    return env


def capture(cmd, timeout=60):
    """Chạy lệnh ngắn, trả về (mã thoát, stdout+stderr)."""
    try:
        r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=timeout, env=child_env())
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 127, str(exc)


# ---------------------------------------------------------------------------
# Trạng thái các bước (thời gian, mã thoát)
# ---------------------------------------------------------------------------


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path, data):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def record_step(step, started, code, note=""):
    path = EDGE_DIR / "trang_thai_cac_buoc.json"
    data = load_json(path, {})
    data[step] = {
        "ten": STEP_NAMES[step], "bat_dau": started.isoformat(timespec="seconds"),
        "ket_thuc": datetime.now().isoformat(timespec="seconds"),
        "so_giay": round((datetime.now() - started).total_seconds(), 1), "ma_thoat": code, "ghi_chu": note,
    }
    save_json(path, data)


def archive(path, log):
    """Chuyển kết quả cũ vào lan_chay_truoc\\<thời điểm>\\ (không xoá)."""
    if path.exists() and any(path.iterdir()):
        dest = DIRS["luu"] / datetime.now().strftime("%Y%m%d_%H%M%S") / path.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(dest))
        log.line(f"    Kết quả lần trước đã được lưu sang: {dest}")
    path.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Tìm công cụ
# ---------------------------------------------------------------------------


def find_node():
    node = shutil.which("node")
    if not node:
        return None, None
    code, out = capture([node, "--version"])
    return node, (out if code == 0 else None)


def find_npm():
    return shutil.which("npm")


def find_edge():
    """(đường dẫn msedge, phiên bản) hoặc (None, None)."""
    if IS_WIN:
        bases = [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA"),
                 r"C:\Program Files (x86)", r"C:\Program Files"]
        for b in filter(None, bases):
            app = Path(b) / "Microsoft" / "Edge" / "Application"
            exe = app / "msedge.exe"
            if exe.is_file():
                versions = sorted((d.name for d in app.iterdir() if d.is_dir() and re.fullmatch(r"\d+\.\d+\.\d+\.\d+", d.name)),
                                  key=lambda v: [int(x) for x in v.split(".")])
                return str(exe), (versions[-1] if versions else "không xác định")
        return None, None
    for name in ("microsoft-edge", "microsoft-edge-stable", "msedge"):
        exe = shutil.which(name)
        if exe:
            code, out = capture([exe, "--version"])
            return exe, out if code == 0 else "không xác định"
    return None, None


def find_test_browser():
    """Trình duyệt dùng cho kiểm thử: Edge, hoặc trình duyệt thay thế khi thử bộ công cụ."""
    if BROWSER == "msedge" and not BROWSER_EXE:
        return find_edge()
    exe = BROWSER_EXE or shutil.which(BROWSER)
    if exe and Path(exe).exists():
        code, out = capture([exe, "--version"])
        return exe, out if code == 0 else "không xác định"
    return None, None


def find_poppler():
    """Thư mục chứa đủ pdftotext/pdfinfo/pdffonts/pdfimages, hoặc None."""
    ext = ".exe" if IS_WIN else ""

    def ok(d):
        return d and all((Path(d) / f"{t}{ext}").is_file() for t in POPPLER_TOOLS)

    cands = [os.environ.get("POPPLER_BIN")]
    w = shutil.which("pdftotext")
    if w:
        cands.append(str(Path(w).parent))
    roots = [TOOLS / "poppler", EDGE_DIR.parent / "poppler", Path(r"C:\poppler")]
    for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        if os.environ.get(env):
            roots += sorted(Path(os.environ[env]).glob("poppler*"))
    roots += sorted(Path("C:/").glob("poppler*")) if IS_WIN else []
    for r in roots:
        if r.exists():
            cands += [str(p.parent) for p in sorted(r.glob(f"**/pdftotext{ext}"))]
    return next((c for c in cands if ok(c)), None)


def poppler_version(bindir):
    ext = ".exe" if IS_WIN else ""
    code, out = capture([Path(bindir) / f"pdftotext{ext}", "-v"])
    m = re.search(r"pdftotext version ([\d.]+)", out)
    return m.group(1) if m else None


def find_soffice():
    cands = [os.environ.get("NGHIEMTHU_SOFFICE"), shutil.which("soffice"), shutil.which("libreoffice")]
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), r"C:\Program Files", r"C:\Program Files (x86)"):
        if base:
            cands.append(os.path.join(base, "LibreOffice", "program", "soffice.exe"))
    return next((c for c in cands if c and os.path.isfile(c)), None)


def venv_modules():
    """(đủ?, chi tiết) cho các thư viện Python trong môi trường ảo."""
    if not VPY.is_file():
        return False, "chưa có môi trường ảo"
    code, out = capture([VPY, "-c", "import importlib,sys\nmiss=[]\nfor m in sys.argv[1:]:\n"
                         "    try: importlib.import_module(m)\n    except Exception: miss.append(m)\nprint(','.join(miss))"]
                        + PY_MODULES)
    if code != 0:
        return False, f"không chạy được Python của môi trường ảo: {out[-200:]}"
    last = out.splitlines()[-1] if out else ""  # empty line = nothing missing
    missing = [m for m in last.split(",") if m]
    return not missing, ("đủ " + ", ".join(PY_MODULES)) if not missing else "thiếu: " + ", ".join(missing)


def playwright_version():
    pkg = load_json(ACC / "node_modules" / "playwright" / "package.json")
    return pkg.get("version") if pkg else None


def port_free(port):
    """True if a server could listen on the port now. Linux: SO_REUSEADDR so that
    sockets lingering in TIME_WAIT after a previous step are not reported as busy
    (uvicorn sets it too). Windows: never SO_REUSEADDR — there it would let the
    bind succeed even while another program is listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if not IS_WIN:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


# ---------------------------------------------------------------------------
# Máy chủ Web App dùng cho kiểm thử
# ---------------------------------------------------------------------------


class Server:
    def __init__(self, log, tag, port=None, host="127.0.0.1", data=None):
        self.log, self.tag, self.proc = log, tag, None
        self.port, self.host, self.data = port or PORT, host, data or DIRS["may_chu"]
        self.base = f"http://127.0.0.1:{self.port}"

    def __enter__(self):
        if not port_free(self.port):
            raise RuntimeError(f"Cổng {self.port} đang bị chương trình khác dùng. Đóng chương trình đó (hoặc cửa sổ "
                               f"kiểm thử cũ) rồi chạy lại" + ("; hoặc đặt biến NGHIEMTHU_PORT sang cổng khác." if self.port == PORT else "."))
        self.data.mkdir(parents=True, exist_ok=True)
        logf = DIRS["logs"] / f"may_chu_{self.tag}.log"
        self.logf = open(logf, "a", encoding="utf-8")
        self.log.line(f"    Khởi động Web App tại {self.base} (log: {logf})")
        self.proc = subprocess.Popen(
            [str(VPY), "-m", "uvicorn", "excel_dashboard.main:app", "--host", self.host, "--port", str(self.port)],
            cwd=ROOT, stdout=self.logf, stderr=subprocess.STDOUT,
            env=child_env({"EXCEL_DASHBOARD_DATA_DIR": str(self.data)}))
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(120):
            if self.proc.poll() is not None:
                raise RuntimeError(f"Web App dừng ngay khi khởi động (mã {self.proc.returncode}). Xem {logf}")
            try:
                with opener.open(self.base + "/api/datasets", timeout=2) as r:
                    if r.status == 200:
                        self.log.line("    Web App đã sẵn sàng.")
                        return self
            except OSError:
                time.sleep(0.5)
        raise RuntimeError(f"Web App không phản hồi sau 60 giây. Xem {logf}")

    def __exit__(self, *exc):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(15)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if self.proc:
            self.log.line("    Đã tắt Web App.")
            self.logf.close()
        return False


# ---------------------------------------------------------------------------
# 01 — Kiểm tra môi trường
# ---------------------------------------------------------------------------


def env_items():
    """Danh sách mục kiểm tra: (tên, trạng thái PASS/FAIL/CẦN CÀI/CẢNH BÁO, chi tiết, hướng dẫn)."""
    items = []

    def add(name, status, detail, guide=""):
        items.append({"ten": name, "trang_thai": status, "chi_tiet": detail, "huong_dan": guide})

    win = f"{platform.system()} {platform.release()} (build {platform.version()})"
    add("Hệ điều hành", "PASS" if IS_WIN else "CẢNH BÁO", win, "" if IS_WIN else "Không phải Windows: chỉ dùng để thử bộ công cụ.")
    v = sys.version_info
    add("Python ≥ 3.11", "PASS" if v >= (3, 11) else "FAIL",
        f"{platform.python_version()} {platform.architecture()[0]} — {sys.executable}", "" if v >= (3, 11) else HUONG_DAN["python"])
    node, nver = find_node()
    if not node or not nver:
        add("Node.js ≥ 20", "FAIL", "không tìm thấy node", HUONG_DAN["node"])
    else:
        major = int(re.match(r"v?(\d+)", nver).group(1))
        add("Node.js ≥ 20", "PASS" if major >= 20 else ("CẢNH BÁO" if major >= 18 else "FAIL"), f"{nver} — {node}",
            "" if major >= 20 else HUONG_DAN["node"])
    npm = find_npm()
    add("npm", "PASS" if npm else "FAIL", npm or "không tìm thấy npm", "" if npm else HUONG_DAN["node"])
    exe, ver = find_test_browser()
    label = "Microsoft Edge" if BROWSER == "msedge" and not BROWSER_EXE else f"Trình duyệt thử '{BROWSER}' (KHÔNG phải Edge)"
    if exe:
        add(label, "PASS" if label == "Microsoft Edge" else "CẢNH BÁO", f"{ver} — {exe}",
            "" if label == "Microsoft Edge" else "Chế độ thử bộ công cụ: kết quả không dùng để nghiệm thu Edge.")
    else:
        add(label, "FAIL", "không tìm thấy", HUONG_DAN["edge"])
    pb = find_poppler()
    pv = poppler_version(pb) if pb else None
    add("Poppler (pdftotext, pdfinfo, pdffonts, pdfimages)", "PASS" if pb and pv else "FAIL",
        f"phiên bản {pv} — {pb}" if pb and pv else (f"có thư mục {pb} nhưng không chạy được pdftotext" if pb else "không tìm thấy"),
        "" if pb and pv else HUONG_DAN["poppler"])
    so = find_soffice()
    add("LibreOffice (soffice)", "PASS" if so else "FAIL", so or "không tìm thấy", "" if so else HUONG_DAN["libreoffice"])
    must = ["requirements.txt", "excel_dashboard/main.py", "excel_dashboard/export.py", "tools/acceptance/accept.js",
            "tools/acceptance/verify.py", "tools/acceptance/make_samples.py", "tools/acceptance/large_data.py",
            "tools/acceptance/package.json", "tools/acceptance/package-lock.json", "tools/acceptance/requirements-nghiemthu.txt",
            "docs/EXCEL_DASHBOARD_NGHIEM_THU.md"]
    missing = [m for m in must if not (ROOT / m).is_file()]
    add("Mã nguồn Web App + bộ kiểm thử", "PASS" if not missing else "FAIL", str(ROOT) + (f"; thiếu {missing}" if missing else ""),
        "" if not missing else "Tải lại mã nguồn đúng nhánh claude/excel-upload-dashboard-app-xfssug.")
    try:
        manual = manual_items()
        add("Danh mục M01–M12 trong tài liệu nghiệm thu", "PASS" if len(manual) == 12 else "FAIL", f"đọc được {len(manual)} mục từ {DOC.name}")
    except Exception as exc:  # noqa: BLE001
        add("Danh mục M01–M12 trong tài liệu nghiệm thu", "FAIL", str(exc))
    ok, detail = venv_modules()
    add("Thư viện Python (môi trường ảo)", "PASS" if ok else "CẦN CÀI", f"{VENV} — {detail}", "" if ok else HUONG_DAN["thu_vien"])
    pw = playwright_version()
    add("Thư viện Playwright (Node)", "PASS" if pw else "CẦN CÀI", f"playwright {pw}" if pw else "chưa cài", "" if pw else HUONG_DAN["thu_vien"])
    missing_samples = [f for f in SAMPLE_FILES if not (DIRS["mau"] / f).is_file()]
    add("Dữ liệu mẫu", "PASS" if not missing_samples else "CẦN CÀI",
        f"{DIRS['mau']}" + (f" — thiếu {len(missing_samples)} file" if missing_samples else " — đủ 6 file"),
        "" if not missing_samples else HUONG_DAN["mau"])
    free = port_free(PORT)
    add(f"Cổng {PORT} còn trống (kiểm thử tự động 04, 05)", "PASS" if free else "FAIL", "trống" if free else "đang bị dùng",
        "" if free else f"Đóng chương trình đang dùng cổng {PORT} hoặc đặt biến NGHIEMTHU_PORT.")
    free8 = port_free(MANUAL_PORT)
    add(f"Cổng {MANUAL_PORT} còn trống (kiểm thử thủ công M01–M12 ở bước 06)", "PASS" if free8 else "CẢNH BÁO",
        "trống" if free8 else "đang bị dùng",
        "" if free8 else f"Bước 06 cần bật Web App ở cổng {MANUAL_PORT}. Đóng chương trình đang dùng cổng này trước khi chạy 06.")
    try:
        EDGE_DIR.mkdir(parents=True, exist_ok=True)
        probe = EDGE_DIR / ".kiem_tra_ghi"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        gb = shutil.disk_usage(EDGE_DIR).free / 1024 ** 3
        add("Quyền ghi + dung lượng trống ≥ 3 GB", "PASS" if gb >= 3 else "FAIL", f"{EDGE_DIR} — trống {gb:.1f} GB",
            "" if gb >= 3 else "Giải phóng ổ đĩa hoặc đặt NGHIEMTHU_DIR sang ổ khác.")
    except OSError as exc:
        add("Quyền ghi + dung lượng trống ≥ 3 GB", "FAIL", f"không ghi được vào {EDGE_DIR}: {exc}",
            "Chạy lại bằng tài khoản có quyền tạo thư mục C:\\nghiemthu, hoặc đặt NGHIEMTHU_DIR.")
    return items


def cmd_kiem_tra(log):
    items = env_items()
    for it in items:
        mark = {"PASS": "[ OK ]", "FAIL": "[LỖI]", "CẦN CÀI": "[CẦN]", "CẢNH BÁO": "[ ! ]"}[it["trang_thai"]]
        log.line(f"{mark} {it['ten']}: {it['chi_tiet']}")
        if it["huong_dan"]:
            for g in it["huong_dan"].splitlines():
                log.line(f"        → {g}")
    fails = [i for i in items if i["trang_thai"] == "FAIL"]
    need = [i for i in items if i["trang_thai"] == "CẦN CÀI"]
    save_json(EDGE_DIR / "moi_truong.json", {"thoi_diem": datetime.now().isoformat(timespec="seconds"),
                                              "may": platform.node(), "muc": items, "dat": not fails})
    log.line("")
    if fails:
        log.line(f"KẾT LUẬN: CHƯA ĐẠT — {len(fails)} mục LỖI. Làm theo hướng dẫn (→) rồi chạy lại 01.")
        return 1
    if need:
        log.line("KẾT LUẬN: Công cụ hệ thống đã đủ. Các mục [CẦN] sẽ được xử lý ở bước 02 và 03.")
    else:
        log.line("KẾT LUẬN: ĐẠT — môi trường sẵn sàng.")
    return 0


# ---------------------------------------------------------------------------
# 02 — Dữ liệu mẫu / 03 — Cài đặt
# ---------------------------------------------------------------------------


def ensure_venv(log):
    if VPY.is_file():
        return True
    log.line(f"    Tạo môi trường Python riêng tại {VENV} ...")
    TOOLS.mkdir(parents=True, exist_ok=True)
    return log.run([sys.executable, "-m", "venv", VENV]) == 0 and VPY.is_file()


def cmd_tao_du_lieu(log):
    if not ensure_venv(log):
        log.line("[LỖI] Không tạo được môi trường Python. " + HUONG_DAN["python"])
        return 1
    if capture([VPY, "-c", "import openpyxl"])[0] != 0:
        log.line("    Cài thư viện openpyxl (cần để tạo file Excel mẫu) ...")
        if log.run([VPY, "-m", "pip", "install", "--disable-pip-version-check", "openpyxl>=3.1"]) != 0:
            log.line("[LỖI] Không cài được openpyxl. Kiểm tra kết nối Internet/proxy rồi chạy lại.")
            return 1
    DIRS["mau"].mkdir(parents=True, exist_ok=True)
    log.line(f"    Tạo 6 file Excel mẫu vào {DIRS['mau']} (khoảng 20–60 giây) ...")
    code = log.run([VPY, ACC / "make_samples.py", DIRS["mau"], "--big-rows", "200000"], timeout=1800)
    missing = [f for f in SAMPLE_FILES if not (DIRS["mau"] / f).is_file() or (DIRS["mau"] / f).stat().st_size == 0]
    if code or missing:
        log.line(f"[LỖI] Tạo dữ liệu mẫu chưa xong (mã {code}); thiếu: {missing}")
        return 1
    log.line("KẾT LUẬN: ĐẠT — đã tạo đủ 6 file mẫu.")
    return 0


def cmd_cai_dat(log):
    if not ensure_venv(log):
        log.line("[LỖI] Không tạo được môi trường Python. " + HUONG_DAN["python"])
        return 1
    log.line("1) Cài thư viện Python cho Web App và bộ kiểm thử ...")
    code = log.run([VPY, "-m", "pip", "install", "--disable-pip-version-check", "-r", ROOT / "requirements.txt",
                    "-r", ACC / "requirements-nghiemthu.txt"], timeout=1800)
    if code:
        log.line("[LỖI] pip install thất bại. Kiểm tra Internet/proxy công ty (biến HTTPS_PROXY) rồi chạy lại 03.")
        return 1
    ok, detail = venv_modules()
    log.line(f"    Kiểm tra import: {detail}")
    if not ok:
        return 1
    npm = find_npm()
    if not npm:
        log.line("[LỖI] Không tìm thấy npm. " + HUONG_DAN["node"])
        return 1
    log.line("2) Cài Playwright (điều khiển trình duyệt) theo package-lock.json ...")
    code = log.run([npm, "ci", "--no-audit", "--no-fund"], cwd=ACC, timeout=1800,
                   env=child_env({"PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"}))
    if code or not playwright_version():
        log.line("[LỖI] npm ci thất bại. Kiểm tra Internet/proxy (npm config set proxy ...) rồi chạy lại 03.")
        return 1
    log.line(f"    Playwright {playwright_version()} đã cài.")
    log.line("3) Thử mở trình duyệt kiểm thử bằng Playwright ...")
    launch = json.dumps({"executablePath": BROWSER_EXE} if BROWSER_EXE else ({"channel": BROWSER} if BROWSER in ("msedge", "chrome") else {}))
    js = ("const {chromium}=require('playwright');chromium.launch(" + launch + ").then(async b=>{"
          "const p=await b.newPage();console.log('OK '+b.version()+' | '+await p.evaluate(()=>navigator.userAgent));"
          "await b.close();}).catch(e=>{console.error('LOI '+e.message.split('\\n')[0]);process.exit(1);});")
    code = log.run([shutil.which("node") or "node", "-e", js], cwd=ACC, timeout=180)
    if code:
        log.line("[LỖI] Playwright không mở được trình duyệt. " + HUONG_DAN["edge"])
        return 1
    rc = 0
    if not find_poppler():
        log.line("[LỖI] Chưa có Poppler — bước 05 sẽ không chạy được.\n" + HUONG_DAN["poppler"])
        rc = 1
    if not find_soffice():
        log.line("[LỖI] Chưa có LibreOffice — bước 05 sẽ không chạy được. " + HUONG_DAN["libreoffice"])
        rc = 1
    log.line("KẾT LUẬN: " + ("ĐẠT — đã cài đủ thư viện." if rc == 0 else
                            "Thư viện Python/Node đã cài xong, nhưng còn thiếu công cụ ở trên. Cài xong chạy lại 01."))
    return rc


# ---------------------------------------------------------------------------
# 04 — Kiểm thử tự động / 05 — Đối chiếu
# ---------------------------------------------------------------------------


def preconditions(log, need_results=False):
    problems = []
    ok, detail = venv_modules()
    if not ok:
        problems.append(f"Thư viện Python {detail} → {HUONG_DAN['thu_vien']}")
    if not playwright_version():
        problems.append(f"Chưa cài Playwright → {HUONG_DAN['thu_vien']}")
    if [f for f in SAMPLE_FILES if not (DIRS["mau"] / f).is_file()]:
        problems.append(f"Thiếu dữ liệu mẫu trong {DIRS['mau']} → {HUONG_DAN['mau']}")
    if not find_test_browser()[0]:
        problems.append("Không tìm thấy Microsoft Edge → " + HUONG_DAN["edge"])
    if need_results and not (DIRS["tu_dong"] / "dashboard_record.json").is_file():
        problems.append("Chưa có kết quả bước 04 → chạy 04_KIEM_THU_EDGE.bat trước.")
    for p in problems:
        log.line("[LỖI] " + p)
    return not problems


def summarize_ui(log):
    res = load_json(DIRS["tu_dong"] / "ui_results.json", [])
    fails = [s for s in res if not s["pass"]]
    log.line("")
    log.line(f"KẾT QUẢ GIAO DIỆN: {len(res) - len(fails)}/{len(res)} PASS")
    for s in fails:
        log.line(f"   FAIL [{s['id']}] {s['name']} — {s['detail'][:200]}")
    return res, fails


def cmd_kiem_thu_edge(log):
    if not preconditions(log):
        return 1
    archive(DIRS["tu_dong"], log)
    archive(DIRS["may_chu"], log)
    node = shutil.which("node") or "node"
    args = [node, ACC / "accept.js", "--browser", BROWSER, "--large", "--samples", DIRS["mau"],
            "--out", DIRS["tu_dong"], "--base", BASE]
    if BROWSER_EXE:
        args += ["--exe", BROWSER_EXE]
    log.line("Chạy 42 bài kiểm thử T01–T42 trên trình duyệt (khoảng 5–10 phút, không thao tác chuột/bàn phím "
             "vào cửa sổ trình duyệt nếu nó hiện ra) ...")
    try:
        with Server(log, "04"):
            code = log.run(args, cwd=ACC, timeout=3600)
    except RuntimeError as exc:
        log.line(f"[LỖI] {exc}")
        return 1
    res, fails = summarize_ui(log)
    if not res:
        log.line("[LỖI] Không có file kết quả ui_results.json.")
        return 1
    log.line("KẾT LUẬN: " + ("ĐẠT — tiếp tục 05_DOI_CHIEU_KET_QUA.bat." if code == 0 and not fails else
                            f"CÓ LỖI (mã {code}). Ảnh chụp lỗi: {DIRS['tu_dong'] / 'loi_*.png'}. Vẫn chạy 05 và 06 để có báo cáo đầy đủ."))
    return 0 if code == 0 and not fails else 1


def cmd_doi_chieu(log):
    if not preconditions(log, need_results=True):
        return 1
    pb, so = find_poppler(), find_soffice()
    if not pb:
        log.line("[LỖI] Không tìm thấy Poppler — KHÔNG thể đối chiếu file PDF. Bước này dừng lại (không bỏ qua).")
        log.line(HUONG_DAN["poppler"])
        return 1
    if not so:
        log.line("[LỖI] Không tìm thấy LibreOffice — KHÔNG thể kiểm tra file Word. Bước này dừng lại (không bỏ qua).")
        log.line(HUONG_DAN["libreoffice"])
        return 1
    log.line(f"    Poppler {poppler_version(pb)}: {pb}")
    log.line(f"    LibreOffice: {so}")
    env = child_env({"PATH": pb + os.pathsep + os.environ.get("PATH", ""), "NGHIEMTHU_SOFFICE": so})
    archive(DIRS["lon"], log)
    try:
        with Server(log, "05") as srv:
            log.line("1) Đối chiếu 6 tầng dữ liệu + kiểm tra trình bày PDF/Word/Excel (2–5 phút) ...")
            c1 = log.run([VPY, ACC / "verify.py", "--samples", DIRS["mau"], "--out", DIRS["tu_dong"], "--base", BASE],
                         cwd=ACC, env=env, timeout=3600)
            log.line("2) Kiểm tra giới hạn dữ liệu lớn qua API (3–5 phút) ...")
            c2 = log.run([VPY, ACC / "large_data.py", DIRS["mau"], DIRS["lon"], "--base", BASE, "--pid", srv.proc.pid],
                         cwd=ACC, env=env, timeout=3600)
    except RuntimeError as exc:
        log.line(f"[LỖI] {exc}")
        return 1
    vr = load_json(DIRS["tu_dong"] / "verify_results.json", {})
    lr = load_json(DIRS["lon"] / "large_results.json", [])
    log.line("")
    log.line(f"KẾT QUẢ ĐỐI CHIẾU: {vr.get('passed', 0)}/{vr.get('total', 0)} PASS")
    for c in vr.get("checks", []):
        if not c["pass"]:
            log.line(f"   FAIL [{c['group']}] {c['name']} — {str(c['detail'])[:200]}")
    log.line(f"KẾT QUẢ DỮ LIỆU LỚN: {sum(1 for r in lr if r[1])}/{len(lr)} PASS")
    for name, ok, detail in lr:
        if not ok:
            log.line(f"   FAIL {name} — {detail}")
    good = c1 == 0 and c2 == 0 and vr.get("total") and not vr.get("failed") and lr and all(r[1] for r in lr)
    log.line("KẾT LUẬN: " + ("ĐẠT — tiếp tục 06_TONG_HOP_BAO_CAO.bat." if good else "CÓ LỖI — xem chi tiết ở trên; chạy 06 để lập báo cáo."))
    return 0 if good else 1


# ---------------------------------------------------------------------------
# 06 — Kiểm thử thủ công M01–M12 + báo cáo
# ---------------------------------------------------------------------------


def manual_items():
    """Đọc nguyên văn bảng M01–M12 từ docs/EXCEL_DASHBOARD_NGHIEM_THU.md (mục 4.4)."""
    text = DOC.read_text(encoding="utf-8")
    sec = text.split("### 4.4", 1)[1].split("\n### ", 1)[0]
    items = []
    for line in sec.splitlines():
        m = re.match(r"^\|\s*(M\d{2})\s*\|(.*)\|(.*)\|(.*)\|\s*$", line)
        if m:
            items.append({"ma": m.group(1), "thao_tac": m.group(2).strip(), "mong_doi": m.group(3).strip()})
    if [i["ma"] for i in items] != [f"M{n:02d}" for n in range(1, 13)]:
        raise ValueError(f"Bảng M01–M12 trong {DOC} không đúng định dạng (đọc được {[i['ma'] for i in items]})")
    return items


MANUAL_FILE = DIRS["thu_cong"] / "ket_qua_thu_cong.json"
MANUAL_LABEL = {"P": "PASS", "C": "PASS kèm cảnh báo HTTP", "F": "FAIL", "B": "CHƯA KIỂM"}


def manual_entry(log):
    items = manual_items()
    data = load_json(MANUAL_FILE, {"ket_qua": {}})
    DIRS["anh"].mkdir(parents=True, exist_ok=True)
    log.line("KIỂM THỬ THỦ CÔNG M01–M12 (nội dung lấy nguyên văn từ tài liệu nghiệm thu, mục 4.4)")
    log.line(f"Ảnh chụp lỗi: lưu vào {DIRS['anh']} với tên bắt đầu bằng mã bài, ví dụ M07_1.png")
    log.line("(Chụp màn hình: Windows + Shift + S, rồi dán vào Paint và lưu.)")
    tester = input(f"\nHọ tên người kiểm thử [{data.get('nguoi_kiem_thu', '')}]: ").strip() or data.get("nguoi_kiem_thu", "")
    data["nguoi_kiem_thu"] = tester
    for it in items:
        old = data["ket_qua"].get(it["ma"], {})
        log.line("")
        log.line(f"[{it['ma']}] Thao tác : {it['thao_tac']}")
        log.line(f"      Mong đợi: {it['mong_doi']}")
        log.line(f"      Kết quả đã nhập: {MANUAL_LABEL.get(old.get('ket_qua'), 'chưa có')}" + (f" — {old.get('ghi_chu')}" if old.get("ghi_chu") else ""))
        opts = "P = PASS, F = FAIL, B = chưa kiểm" + (", C = PASS kèm cảnh báo HTTP" if it["ma"] == "M09" else "") + ", Enter = giữ nguyên"
        while True:
            ans = input(f"      Nhập ({opts}): ").strip().upper()
            if ans == "" or ans in ("P", "F", "B") or (ans == "C" and it["ma"] == "M09"):
                break
            print("      Không hợp lệ, nhập lại.")
        if ans == "":
            continue
        note = input("      Mô tả lỗi (bắt buộc): " if ans == "F" else "      Ghi chú (có thể bỏ trống): ").strip()
        while ans == "F" and not note:
            note = input("      Mô tả lỗi (bắt buộc): ").strip()
        data["ket_qua"][it["ma"]] = {"ket_qua": ans, "ghi_chu": note, "luc": datetime.now().isoformat(timespec="seconds")}
        log.line(f"      → Đã ghi: {MANUAL_LABEL[ans]}" + (f" — {note}" if note else ""))
        save_json(MANUAL_FILE, data)
    save_json(MANUAL_FILE, data)


def git_commit():
    git = shutil.which("git")
    if git:
        code, out = capture([git, "-C", ROOT, "rev-parse", "--short", "HEAD"])
        if code == 0:
            return out
    return "không xác định"


def build_report():
    """Gom kết quả mọi bước → dict tổng hợp + kết luận."""
    env = load_json(EDGE_DIR / "moi_truong.json")
    steps = load_json(EDGE_DIR / "trang_thai_cac_buoc.json", {})
    ui = load_json(DIRS["tu_dong"] / "ui_results.json")
    ui_sum = load_json(DIRS["tu_dong"] / "ui_summary.json", {})
    vr = load_json(DIRS["tu_dong"] / "verify_results.json")
    lr = load_json(DIRS["lon"] / "large_results.json")
    man = load_json(MANUAL_FILE, {"ket_qua": {}})
    items = manual_items()

    def shot_ui(test_id):
        out = []
        for n in (f"loi_{test_id}.png",):
            if (DIRS["tu_dong"] / n).is_file():
                out.append(f"ket_qua_tu_dong/{n}")
        sec = next((s["id"] for s in ui_sum.get("sections", []) if test_id in s.get("tests", [])), None)
        if sec and (DIRS["tu_dong"] / f"loi_{sec}.png").is_file():
            out.append(f"ket_qua_tu_dong/loi_{sec}.png")
        return out

    groups = []
    rows = [{"ma": s["id"], "ten": s["name"], "kq": "PASS" if s["pass"] else "FAIL", "chi_tiet": s["detail"],
             "anh": [] if s["pass"] else shot_ui(s["id"])} for s in (ui or [])]
    groups.append({"ma": "A", "ten": "Kiểm thử tự động giao diện T01–T42 (accept.js, bước 04)", "rows": rows,
                   "co_ket_qua": ui is not None, "can_co": 42})
    rows = [{"ma": f"V{i + 1:02d}", "ten": f"[{c['group']}] {c['name']}", "kq": "PASS" if c["pass"] else "FAIL",
             "chi_tiet": str(c["detail"]), "anh": []} for i, c in enumerate((vr or {}).get("checks", []))]
    groups.append({"ma": "B", "ten": "Đối chiếu 6 tầng dữ liệu + trình bày file (verify.py, bước 05)", "rows": rows,
                   "co_ket_qua": vr is not None, "can_co": None})
    rows = [{"ma": f"L{i + 1:02d}", "ten": r[0], "kq": "PASS" if r[1] else "FAIL", "chi_tiet": r[2], "anh": []}
            for i, r in enumerate(lr or [])]
    groups.append({"ma": "C", "ten": "Giới hạn dữ liệu lớn qua API (large_data.py, bước 05)", "rows": rows,
                   "co_ket_qua": lr is not None, "can_co": None})
    rows = []
    for it in items:
        r = man["ket_qua"].get(it["ma"], {})
        k = r.get("ket_qua", "B")
        anh = sorted(f"thu_cong/anh/{p.name}" for p in DIRS["anh"].glob(f"{it['ma']}*")) if DIRS["anh"].exists() else []
        rows.append({"ma": it["ma"], "ten": it["thao_tac"], "mong_doi": it["mong_doi"],
                     "kq": {"P": "PASS", "C": "PASS", "F": "FAIL"}.get(k, "CHƯA KIỂM"),
                     "chi_tiet": (MANUAL_LABEL[k] if k == "C" else "") + (" — " if k == "C" and r.get("ghi_chu") else "") + r.get("ghi_chu", ""),
                     "anh": anh})
    groups.append({"ma": "D", "ten": "Kiểm thử thủ công M01–M12 trên Edge (mục 4.4, nhập ở bước 06)", "rows": rows,
                   "co_ket_qua": True, "can_co": 12})

    for g in groups:
        g["tong"] = len(g["rows"])
        g["pass"] = sum(r["kq"] == "PASS" for r in g["rows"])
        g["fail"] = sum(r["kq"] == "FAIL" for r in g["rows"])
        g["chua"] = sum(r["kq"] == "CHƯA KIỂM" for r in g["rows"])

    fails, incomplete = [], []
    if not env:
        incomplete.append("Chưa chạy bước 01 (kiểm tra môi trường).")
    elif not env.get("dat"):
        incomplete.append("Bước 01 gần nhất còn mục LỖI — xử lý rồi chạy lại 01.")
    browser = (ui_sum or {}).get("browser") or {}
    launch = browser.get("launch") or {}
    if ui is not None and (launch.get("channel") != "msedge" or launch.get("executablePath")):
        incomplete.append(f"Kiểm thử tự động chạy trên '{browser.get('name')}' {launch}, KHÔNG phải Microsoft Edge "
                          "(kênh msedge) — không hợp lệ cho nghiệm thu Edge.")
    for g in groups:
        if not g["co_ket_qua"]:
            incomplete.append(f"Nhóm {g['ma']} chưa có kết quả (chưa chạy bước tương ứng).")
        if g["can_co"] and g["co_ket_qua"] and g["tong"] < g["can_co"]:
            incomplete.append(f"Nhóm {g['ma']} chỉ có {g['tong']}/{g['can_co']} bài.")
        if g["fail"]:
            fails.append(f"Nhóm {g['ma']}: {g['fail']} bài FAIL.")
        if g["chua"]:
            incomplete.append(f"Nhóm {g['ma']}: {g['chua']} bài CHƯA KIỂM.")
    ui_f, vr_f = DIRS["tu_dong"] / "ui_results.json", DIRS["tu_dong"] / "verify_results.json"
    if ui_f.is_file() and vr_f.is_file() and vr_f.stat().st_mtime < ui_f.stat().st_mtime:
        incomplete.append("Kết quả đối chiếu (05) cũ hơn lần kiểm thử 04 gần nhất — chạy lại 05.")
    verdict = "KHÔNG ĐẠT" if fails else ("CHƯA ĐỦ ĐIỀU KIỆN KẾT LUẬN" if incomplete else "ĐẠT")
    total = sum(g["tong"] for g in groups)
    return {
        "lap_luc": datetime.now().isoformat(timespec="seconds"), "nguoi_kiem_thu": man.get("nguoi_kiem_thu", ""),
        "may": platform.node(), "he_dieu_hanh": f"{platform.system()} {platform.release()} ({platform.version()})",
        "trinh_duyet": browser, "commit": git_commit(), "thu_muc": str(EDGE_DIR), "moi_truong": env, "cac_buoc": steps,
        "nhom_ui": ui_sum.get("sections", []), "nhom": groups, "tong": total,
        "pass": sum(g["pass"] for g in groups), "fail": sum(g["fail"] for g in groups), "chua": sum(g["chua"] for g in groups),
        "ket_luan": verdict, "ly_do_fail": fails, "ly_do_chua_du": incomplete,
    }


def render_md(r):
    L = ["# BÁO CÁO NGHIỆM THU — XUẤT BÁO CÁO TRÊN MICROSOFT EDGE", "",
         f"**KẾT LUẬN: {r['ket_luan']}**", ""]
    L += [f"- {x}" for x in r["ly_do_fail"] + r["ly_do_chua_du"]] or ["- Mọi bài kiểm thử đều PASS."]
    b = r["trinh_duyet"] or {}
    L += ["", "## Thông tin", "", f"- Lập lúc: {r['lap_luc']}", f"- Người kiểm thử: {r['nguoi_kiem_thu'] or '—'}",
          f"- Máy tính: {r['may']} — {r['he_dieu_hanh']}", f"- Trình duyệt: {b.get('name')} {b.get('version')}",
          f"- User agent: `{b.get('userAgent')}`", f"- Mã nguồn (commit): {r['commit']}", f"- Thư mục kết quả: {r['thu_muc']}", "",
          "## Tổng hợp", "", "| Nhóm | Nội dung | Tổng | PASS | FAIL | Chưa kiểm |", "|---|---|---|---|---|---|"]
    L += [f"| {g['ma']} | {g['ten']} | {g['tong']} | {g['pass']} | {g['fail']} | {g['chua']} |" for g in r["nhom"]]
    L += [f"| | **Tổng cộng** | **{r['tong']}** | **{r['pass']}** | **{r['fail']}** | **{r['chua']}** |", "",
          "## Thời gian thực hiện", "", "| Bước | Bắt đầu | Kết thúc | Thời gian | Mã thoát |", "|---|---|---|---|---|"]
    for k in sorted(r["cac_buoc"]):
        s = r["cac_buoc"][k]
        L.append(f"| {k} {s['ten']} | {s['bat_dau']} | {s['ket_thuc']} | {fmt_secs(s['so_giay'])} | {s['ma_thoat']} |")
    L += ["", "## Chi tiết lỗi", ""]
    errs = [(g, x) for g in r["nhom"] for x in g["rows"] if x["kq"] == "FAIL"]
    L += [f"- **{g['ma']}/{x['ma']}** {x['ten']} — {x['chi_tiet']}" + (f" — ảnh: {', '.join(x['anh'])}" if x["anh"] else "")
          for g, x in errs] or ["Không có lỗi."]
    for g in r["nhom"]:
        L += ["", f"## {g['ma']}. {g['ten']}", "", "| Mã | Bài kiểm thử | Kết quả | Chi tiết |", "|---|---|---|---|"]
        L += [f"| {x['ma']} | {x['ten'].replace('|', '/')} | {x['kq']} | {str(x['chi_tiet']).replace('|', '/')[:200]} |" for x in g["rows"]]
    L += ["", "## Log", "", f"Thư mục: {DIRS['logs']}"]
    return "\n".join(L)


def fmt_secs(s):
    s = int(round(s or 0))
    return f"{s // 60} phút {s % 60:02d} giây" if s >= 60 else f"{s} giây"


def render_html(r):
    e = html.escape
    color = {"ĐẠT": "#1b7f3b", "KHÔNG ĐẠT": "#c62f2e"}.get(r["ket_luan"], "#b26a00")

    def badge(k):
        c = {"PASS": "#1b7f3b", "FAIL": "#c62f2e"}.get(k, "#b26a00")
        return f'<span class="b" style="background:{c}">{e(k)}</span>'

    def imgs(lst):
        return "".join(f'<a href="{e(a)}"><img src="{e(a)}" alt="{e(a)}"></a>' for a in lst)

    b = r["trinh_duyet"] or {}
    reasons = "".join(f"<li>{e(x)}</li>" for x in r["ly_do_fail"] + r["ly_do_chua_du"]) or "<li>Mọi bài kiểm thử đều PASS.</li>"
    summary = "".join(f"<tr><td>{g['ma']}</td><td>{e(g['ten'])}</td><td>{g['tong']}</td><td>{g['pass']}</td><td>{g['fail']}</td><td>{g['chua']}</td></tr>"
                      for g in r["nhom"])
    steps = "".join(f"<tr><td>{k} {e(s['ten'])}</td><td>{e(s['bat_dau'])}</td><td>{e(s['ket_thuc'])}</td><td>{fmt_secs(s['so_giay'])}</td>"
                    f"<td>{s['ma_thoat']}</td></tr>" for k, s in sorted(r["cac_buoc"].items()))
    secs = "".join(f"<tr><td>{e(s['id'])}</td><td>{e(s['name'])}</td><td>{e(', '.join(s['tests']))}</td><td>{fmt_secs(s['seconds'])}</td></tr>"
                   for s in r["nhom_ui"])
    errs = [(g, x) for g in r["nhom"] for x in g["rows"] if x["kq"] == "FAIL"]
    err_html = "".join(f"<tr><td>{g['ma']}/{e(x['ma'])}</td><td>{e(x['ten'])}</td><td>{e(str(x['chi_tiet']))}</td><td>{imgs(x['anh']) or '—'}</td></tr>"
                       for g, x in errs) or '<tr><td colspan="4">Không có lỗi.</td></tr>'
    env_rows = "".join(f"<tr><td>{e(i['ten'])}</td><td>{badge(i['trang_thai'])}</td><td>{e(i['chi_tiet'])}</td></tr>"
                       for i in (r["moi_truong"] or {}).get("muc", []))
    detail = ""
    for g in r["nhom"]:
        extra = "<th>Mong đợi</th>" if g["ma"] == "D" else ""
        body = "".join(f"<tr><td>{e(x['ma'])}</td><td>{e(x['ten'])}</td>" + (f"<td>{e(x.get('mong_doi', ''))}</td>" if g["ma"] == "D" else "")
                       + f"<td>{badge(x['kq'])}</td><td>{e(str(x['chi_tiet']))}</td><td>{imgs(x['anh'])}</td></tr>" for x in g["rows"])
        detail += (f"<details{' open' if g['fail'] or g['chua'] else ''}><summary>{g['ma']}. {e(g['ten'])} — {g['pass']}/{g['tong']} PASS</summary>"
                   f"<table><tr><th>Mã</th><th>Bài kiểm thử</th>{extra}<th>Kết quả</th><th>Chi tiết</th><th>Ảnh</th></tr>{body}</table></details>")
    logs = "".join(f'<li><a href="logs/{e(p.name)}">{e(p.name)}</a></li>' for p in sorted(DIRS["logs"].glob("*.log"))) if DIRS["logs"].exists() else ""
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo nghiệm thu Edge</title>
<style>body{{font:14px/1.5 "Segoe UI",Arial,sans-serif;margin:24px;color:#111;background:#fff}}h1{{font-size:22px}}
h2{{font-size:17px;margin-top:28px;border-bottom:2px solid #1f5fad;padding-bottom:4px;color:#1f5fad}}
table{{border-collapse:collapse;width:100%;margin:8px 0}}td,th{{border:1px solid #c8d1dc;padding:5px 8px;text-align:left;vertical-align:top}}
th{{background:#1f5fad;color:#fff}}.v{{font-size:24px;font-weight:700;color:#fff;background:{color};padding:12px 16px;border-radius:8px}}
.b{{color:#fff;border-radius:4px;padding:1px 6px;font-size:12px;white-space:nowrap}}img{{max-width:220px;border:1px solid #ccc;margin:2px}}
details{{margin:8px 0}}summary{{cursor:pointer;font-weight:600}}</style></head><body>
<h1>BÁO CÁO NGHIỆM THU — XUẤT BÁO CÁO TRÊN MICROSOFT EDGE</h1>
<div class="v">KẾT LUẬN: {e(r['ket_luan'])}</div><ul>{reasons}</ul>
<p><b>Tổng số bài kiểm thử:</b> {r['tong']} — <b>PASS:</b> {r['pass']} — <b>FAIL:</b> {r['fail']} — <b>Chưa kiểm:</b> {r['chua']}</p>
<h2>Thông tin</h2><table>
<tr><th>Lập lúc</th><td>{e(r['lap_luc'])}</td></tr><tr><th>Người kiểm thử</th><td>{e(r['nguoi_kiem_thu'] or '—')}</td></tr>
<tr><th>Máy tính</th><td>{e(r['may'])} — {e(r['he_dieu_hanh'])}</td></tr>
<tr><th>Trình duyệt</th><td>{e(str(b.get('name')))} {e(str(b.get('version')))}<br><small>{e(str(b.get('userAgent')))}</small></td></tr>
<tr><th>Mã nguồn (commit)</th><td>{e(r['commit'])}</td></tr><tr><th>Thư mục kết quả</th><td>{e(r['thu_muc'])}</td></tr></table>
<h2>Tổng hợp</h2><table><tr><th>Nhóm</th><th>Nội dung</th><th>Tổng</th><th>PASS</th><th>FAIL</th><th>Chưa kiểm</th></tr>{summary}
<tr><td></td><td><b>Tổng cộng</b></td><td><b>{r['tong']}</b></td><td><b>{r['pass']}</b></td><td><b>{r['fail']}</b></td><td><b>{r['chua']}</b></td></tr></table>
<p>Tiêu chí (tài liệu nghiệm thu, mục 4.5): kiểm thử tự động trên Edge không có FAIL; M01–M12 tất cả PASS
(M09 có thể "PASS kèm cảnh báo HTTP"). Ngoài ra bộ công cụ yêu cầu chạy đủ các bước và đúng trình duyệt Edge.</p>
<h2>Chi tiết lỗi</h2><table><tr><th>Mã</th><th>Bài kiểm thử</th><th>Chi tiết</th><th>Ảnh chụp màn hình</th></tr>{err_html}</table>
<h2>Thời gian thực hiện</h2><table><tr><th>Bước</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời gian</th><th>Mã thoát</th></tr>{steps}</table>
<table><tr><th>Nhóm kiểm thử tự động</th><th>Nội dung</th><th>Bài</th><th>Thời gian</th></tr>{secs}</table>
<h2>Môi trường (bước 01)</h2><table><tr><th>Mục</th><th>Trạng thái</th><th>Chi tiết</th></tr>{env_rows}</table>
<h2>Kết quả từng bài</h2>{detail}
<h2>Log kiểm thử</h2><ul>{logs}</ul>
<p>File tải về khi kiểm thử: <code>ket_qua_tu_dong\\</code> — kết quả dữ liệu lớn: <code>ket_qua_du_lieu_lon\\</code> —
các lần chạy trước: <code>lan_chay_truoc\\</code>.</p></body></html>"""


MANUAL_PORT = 8000  # M07/M09 trong tài liệu nghiệm thu dùng cổng 8000 — giữ nguyên


def lan_ips():
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # không gửi gói tin; chỉ để biết card mạng chính
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


def manual_session(log, start_server=True):
    """Bật Web App ở cổng 8000 (mở trong mạng LAN cho M09), mở Edge, rồi hướng dẫn nhập M01–M12."""
    if not start_server:
        manual_entry(log)
        return
    if not VPY.is_file() or not venv_modules()[0]:
        log.line("[LỖI] Chưa cài thư viện nên không bật được Web App cho kiểm thử thủ công → " + HUONG_DAN["thu_vien"])
        log.line("      Vẫn có thể nhập kết quả M01–M12 nếu anh/chị đã kiểm thử bằng Web App chạy riêng.")
        manual_entry(log)
        return
    try:
        with Server(log, "06_thu_cong", port=MANUAL_PORT, host="0.0.0.0", data=EDGE_DIR / "du_lieu_thu_cong"):
            url = f"http://127.0.0.1:{MANUAL_PORT}"
            log.line("")
            log.line(f"Web App cho kiểm thử thủ công đang chạy: {url}")
            for ip in lan_ips():
                log.line(f"  Từ máy khác trong mạng LAN (M09): http://{ip}:{MANUAL_PORT}")
            log.line("  (Nếu Windows hỏi cho phép Python qua tường lửa: chọn Allow/Cho phép để làm M09.)")
            log.line(f"  File mẫu để upload: {DIRS['mau']}")
            exe = find_edge()[0]
            if exe and IS_WIN:
                subprocess.Popen([exe, url])
                log.line("  Đã mở Microsoft Edge tại địa chỉ trên.")
            log.line("Làm từng bài theo hướng dẫn hiện ra bên dưới, làm xong bài nào nhập kết quả bài đó.")
            log.line("Web App sẽ tự tắt khi nhập xong M12. KHÔNG đóng cửa sổ này khi đang kiểm thử.")
            manual_entry(log)
    except RuntimeError as exc:
        log.line(f"[LỖI] {exc}")
        log.line(f"      Kiểm thử M01–M12 cần Web App ở cổng {MANUAL_PORT} (theo tài liệu). Đóng chương trình đang dùng "
                 f"cổng {MANUAL_PORT}, hoặc nếu đó chính là Web App Excel Dashboard thì dùng nó để kiểm thử.")
        if input("      Vẫn nhập kết quả M01–M12 bây giờ? (C = có, Enter = không): ").strip().upper() == "C":
            manual_entry(log)


def cmd_tong_hop(log, ask=True, open_report=True, start_server=True):
    if ask and sys.stdin and sys.stdin.isatty():
        manual_session(log, start_server)
    elif ask:
        log.line("(Không có bàn phím nhập liệu: bỏ qua phần nhập M01–M12, dùng kết quả đã lưu.)")
    r = build_report()
    save_json(EDGE_DIR / "ket_qua_tong_hop.json", r)
    (EDGE_DIR / "BAO_CAO_NGHIEM_THU.md").write_text(render_md(r), encoding="utf-8")
    out = EDGE_DIR / "BAO_CAO_NGHIEM_THU.html"
    out.write_text(render_html(r), encoding="utf-8")
    log.line("")
    log.line(f"Tổng số bài kiểm thử: {r['tong']} | PASS: {r['pass']} | FAIL: {r['fail']} | Chưa kiểm: {r['chua']}")
    for g in r["nhom"]:
        log.line(f"  {g['ma']}. {g['ten']}: {g['pass']}/{g['tong']} PASS, {g['fail']} FAIL, {g['chua']} chưa kiểm")
    log.line(f"KẾT LUẬN: {r['ket_luan']}")
    for x in r["ly_do_fail"] + r["ly_do_chua_du"]:
        log.line(f"  - {x}")
    log.line(f"Báo cáo: {out}")
    log.line(f"         {EDGE_DIR / 'BAO_CAO_NGHIEM_THU.md'}")
    if open_report and IS_WIN:
        try:
            os.startfile(str(out))  # noqa: S606 — mở báo cáo bằng trình duyệt mặc định
        except OSError:
            pass
    return 0 if r["ket_luan"] == "ĐẠT" else 1


# ---------------------------------------------------------------------------


COMMANDS = {"kiem-tra": ("01", cmd_kiem_tra), "tao-du-lieu": ("02", cmd_tao_du_lieu), "cai-dat": ("03", cmd_cai_dat),
            "kiem-thu-edge": ("04", cmd_kiem_thu_edge), "doi-chieu": ("05", cmd_doi_chieu), "tong-hop": ("06", cmd_tong_hop)}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Bộ nghiệm thu Microsoft Edge cho Excel Dashboard")
    ap.add_argument("lenh", choices=COMMANDS)
    ap.add_argument("--khong-hoi", action="store_true", help="06: không hỏi nhập M01–M12")
    ap.add_argument("--khong-mo", action="store_true", help="06: không tự mở báo cáo")
    ap.add_argument("--khong-may-chu", action="store_true", help="06: không bật Web App cổng 8000 khi nhập M01–M12")
    a = ap.parse_args(argv)
    step, fn = COMMANDS[a.lenh]
    try:
        EDGE_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"[LỖI] Không tạo được thư mục kết quả {EDGE_DIR}: {exc}")
        return 1
    log = Log(step)
    started = datetime.now()
    log.line(f"Thư mục kết quả: {EDGE_DIR}   |   Mã nguồn: {ROOT}")
    try:
        code = (fn(log, ask=not a.khong_hoi, open_report=not a.khong_mo, start_server=not a.khong_may_chu)
                if a.lenh == "tong-hop" else fn(log))
    except KeyboardInterrupt:
        log.line("[DỪNG] Người dùng đã dừng bước này.")
        code = 130
    except Exception as exc:  # noqa: BLE001 — luôn ghi lỗi vào log thay vì thoát im lặng
        import traceback
        log.line(f"[LỖI KHÔNG MONG ĐỢI] {type(exc).__name__}: {exc}")
        log.line(traceback.format_exc())
        code = 1
    record_step(step, started, code)
    log.line(f"Thời gian: {fmt_secs((datetime.now() - started).total_seconds())} — mã thoát {code} — log: {log.path}")
    log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
