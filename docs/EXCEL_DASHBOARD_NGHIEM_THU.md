# Nghiệm thu chức năng xuất báo cáo — Excel Dashboard

Tài liệu này mô tả bộ kiểm thử nghiệm thu, kết quả đã chạy, và **quy trình kiểm thử
Microsoft Edge trên Windows** (phần chưa thể chạy trong môi trường Linux của nhóm phát triển).

## 1. Môi trường đã kiểm thử (17/11/2026)

| Thành phần | Phiên bản |
|---|---|
| Hệ điều hành máy chủ / máy kiểm thử | Linux (container) |
| Trình duyệt 1 | Google Chrome for Testing 153.0.8010.12 |
| Trình duyệt 2 | Chromium 153.0.8010.12 (Playwright) |
| Microsoft Edge | **Chưa kiểm thử được** (không được phép cài Edge vào container). Xem mục 4 |
| Python / FastAPI | 3.13 / 0.163 |
| openpyxl / reportlab / python-docx | 3.1.5 / 5.0.1 / 1.2.0 |
| Node.js / Playwright | 22 / 1.63.0 |
| Kiểm tra file | poppler 24.02 (pdftotext, pdffonts…), LibreOffice 24.2 |

## 2. Bộ công cụ kiểm thử (`tools/acceptance/`)

| File | Việc làm |
|---|---|
| `make_samples.py` | Sinh 6 file Excel mẫu thực tế: 1.200 dòng có dòng tiêu đề, ô gộp và dòng "Tổng cộng" (+ sheet 18 cột); 3 dòng; cột chứa "Giá"/"gia"; 40 cột chữ dài; 25.000 dòng; 200.000 dòng |
| `accept.js` | Điều khiển giao diện thật trong trình duyệt (Chrome / Edge / Chromium): upload, lọc, xuất, xem trước, tải lại, giới hạn dữ liệu, chức năng cũ. Lưu mọi file tải xuống và số liệu Dashboard |
| `verify.py` | Đối chiếu 6 tầng: file gốc (đọc độc lập) → dữ liệu sau xử lý (API) → Dashboard → Excel → PDF → Word. Kiểm tra trình bày PDF/Word: trang trắng, tiêu đề bị tách, font nhúng, chữ tràn lề, đánh số trang, độ rộng cột. Ghi `acceptance_report.md` |
| `large_data.py` | Kiểm tra giới hạn dữ liệu qua API: 20.000/20.001 dòng PDF, 5.000/5.001 dòng Word, Excel 200.000 dòng, bộ nhớ máy chủ |

## 3. Kết quả đã chạy

| Lượt chạy | Kết quả |
|---|---|
| Chrome for Testing 153, có dữ liệu 200.000 dòng (`--large`) | **140/140 PASS** (giao diện 42 + đối chiếu/kiểm tra file 98) |
| Chromium 153 | **136/136 PASS** (giao diện 38 + 98) |
| Chạy lại trên máy chủ đã có dữ liệu cũ, Playwright cài bằng `npm install` | **136/136 PASS** |
| `large_data.py` (API, dữ liệu lớn) | **16/16 PASS**, bộ nhớ đỉnh máy chủ 557 MB |
| `pytest` (95 test đơn vị/API) | **95/95 PASS** |
| PDF 20.000 dòng (647 trang): font nhúng, không trang trắng, không tiêu đề bị tách, không tràn lề, đủ 20.000 dòng | **PASS** |

## 4. Quy trình kiểm thử Microsoft Edge trên Windows

> **Cách nhanh (khuyến nghị):** dùng bộ 6 file BAT trong `tools/acceptance/windows/`
> (01 kiểm tra môi trường → 06 tổng hợp báo cáo). Hướng dẫn từng bước cho người không chuyên:
> [HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md](HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md). Bộ BAT thực hiện
> đúng các lệnh ở 4.2–4.3 (Web App kiểm thử tự động chạy ở cổng 8765), hướng dẫn và ghi nhận
> M01–M12 của mục 4.4 (Web App ở cổng 8000), áp dụng tiêu chí 4.5, và lưu mọi kết quả trong
> `C:\nghiemthu\edge`. Các mục 4.1–4.3 dưới đây là cách chạy thủ công bằng câu lệnh.

### 4.1 Chuẩn bị (một lần)

1. Cài **Python 3.11+** (python.org, chọn "Add python.exe to PATH") và **Node.js 20+ LTS** (nodejs.org).
2. Microsoft Edge có sẵn trên Windows 10/11. Kiểm tra phiên bản tại `edge://settings/help`.
3. (Tuỳ chọn, để chạy `verify.py` ngay trên Windows) cài **Poppler for Windows**: tải bản
   phát hành mới nhất của `poppler-windows`, giải nén, thêm thư mục `Library\bin` vào PATH.
   Nếu không cài, chép thư mục kết quả sang máy Linux có `poppler-utils` để chạy `verify.py`.
4. (Tuỳ chọn) Cài LibreOffice để `verify.py` mở thử file Word/Excel; hoặc mở bằng Microsoft Office ở bước 4.4.

### 4.2 Khởi động ứng dụng (cửa sổ PowerShell 1)

```powershell
cd C:\duan\hello-world
git checkout claude/excel-upload-dashboard-app-xfssug
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:EXCEL_DASHBOARD_DATA_DIR = "C:\nghiemthu\data"
uvicorn excel_dashboard.main:app --host 127.0.0.1 --port 8000
```

### 4.3 Chạy kiểm thử tự động trên Edge (cửa sổ PowerShell 2)

```powershell
cd C:\duan\hello-world
.\.venv\Scripts\Activate.ps1
python tools\acceptance\make_samples.py C:\nghiemthu\samples
cd tools\acceptance
npm install                      # cài Playwright; dùng Edge đã cài sẵn, không tải trình duyệt khác
node accept.js --browser msedge --samples C:\nghiemthu\samples --out C:\nghiemthu\edge --base http://127.0.0.1:8000 --large
cd ..\..
python tools\acceptance\verify.py --samples C:\nghiemthu\samples --out C:\nghiemthu\edge --base http://127.0.0.1:8000
python tools\acceptance\large_data.py C:\nghiemthu\samples C:\nghiemthu\large --base http://127.0.0.1:8000
```

- Thêm `--headed` vào lệnh `accept.js` để xem Edge thao tác trực tiếp.
- Kết quả: `C:\nghiemthu\edge\acceptance_report.md` (bảng PASS/FAIL), các file đã tải
  (`*__BaoCao_*.xlsx|pdf|docx`), ảnh màn hình `ui_*.png`.
- Đạt khi: `UI: 42/42 PASS` và `VERIFY: …/… PASS` không có dòng FAIL.

### 4.4 Kiểm thử thủ công trên Edge (tự động hoá không kiểm được)

Mở `http://127.0.0.1:8000` bằng Edge, upload `SoTheoDoi_DoanhThu_2026.xlsx`, lọc
Chi nhánh = Cà Mau, ngày 01/03/2026–30/06/2026.

| Mã | Thao tác | Kết quả mong đợi | PASS/FAIL |
|---|---|---|---|
| M01 | Bấm 📊 Xuất Excel | File `BaoCao_…_YYYYMMDD_HHMM.xlsx` vào thư mục Downloads; Edge hiện thông báo tải xong | |
| M02 | Mở file Excel bằng Microsoft Excel | Không báo lỗi/sửa chữa file; tiếng Việt đúng; sheet "Dữ liệu chi tiết" 70 dòng có nút lọc, hàng tiêu đề cố định khi cuộn; sheet TK có biểu đồ sửa được; ngày dạng dd/mm/yyyy | |
| M03 | Bấm 📄 Xuất PDF, mở bằng trình xem PDF của Edge và Adobe Reader | Tiếng Việt đúng, có biểu đồ, không trang trắng, tiêu đề mục không bị tách, "Trang x/y" | |
| M04 | Bấm 📝 Xuất Word, mở bằng Microsoft Word | Không báo lỗi; bảng chi tiết in ngang, lặp tiêu đề mỗi trang; ảnh biểu đồ rõ | |
| M05 | Bấm 👁 Xem trước báo cáo | PDF hiện trong cửa sổ xem trước của Edge; "Tải PDF này" tải đúng file | |
| M06 | Xuất 3 lần liên tiếp (Excel → PDF → Word) | Cả 3 file được tải. Nếu Edge hỏi "Trang web muốn tải xuống nhiều tệp", chọn **Cho phép** | |
| M07 | Vào `edge://settings/content/automaticDownloads`, thêm `http://127.0.0.1:8000` vào **Chặn**; upload `RatLon_200000.xlsx`; xuất Excel 2 lần | Lần bị chặn: không có file mới, nhưng thông báo ✅ và nút **⬇ Tải lại …** vẫn hiện; bấm nút đó → file được tải. Sau đó gỡ thiết lập chặn | |
| M08 | Bật `edge://settings/downloads` → "Hỏi nơi lưu mỗi tệp" | Hộp thoại lưu hiện đúng tên `BaoCao_…`; huỷ rồi bấm ⬇ Tải lại → tải được | |
| M09 | Truy cập từ máy khác trong LAN qua `http://<IP-máy-chủ>:8000` và xuất PDF | Nếu Edge hiện "không thể tải xuống an toàn": chọn Giữ lại (Keep) → file mở được. Ghi nhận để quyết định triển khai HTTPS nội bộ | |
| M10 | Upload `DaiTrungBinh_25000.xlsx`, bấm Xuất PDF và Xuất Word | Không tạo file; thông báo nêu số dòng, giới hạn 20.000/5.000 và cách xử lý | |
| M11 | Windows Display scaling 125% và 150%, zoom Edge 100% | Khu vực Xuất báo cáo, các nút và thông báo hiển thị đủ, không chồng lấn | |
| M12 | Mở Task Manager của Edge (Shift+Esc) khi xem dữ liệu 200.000 dòng và xuất Excel | Trang không bị treo; bộ nhớ tab ổn định sau khi xuất | |

### 4.5 Tiêu chí nghiệm thu Edge

- `accept.js` + `verify.py` trên Edge: không có FAIL.
- M01–M12: tất cả PASS (M09 có thể ghi "PASS kèm cảnh báo HTTP" nếu chưa có HTTPS).

<a id="de-xuat-quy-tac-gia"></a>

## 5. Đề xuất điều chỉnh quy tắc "Giá" (chưa áp dụng)

Quy tắc hiện hành được **giữ nguyên**. Báo cáo xuất ra thống nhất với Dashboard (đã
kiểm chứng: Dashboard = Excel = PDF = Word cho 5 chỉ số của `QuyTac_Gia.xlsx`).

Kết quả của quy tắc hiện hành trên các tên cột thường gặp:

| Tên cột | Hiện hành | Đánh giá |
|---|---|---|
| Đơn giá, Giá bán, Giá nhập, Giá vốn | Trung bình | Hợp lý (giá đơn vị) |
| Tỷ lệ chiết khấu, Chiết khấu (%), Nhiệt độ | Trung bình | Hợp lý |
| Thành tiền, Doanh thu, Số tiền, Lợi nhuận, Chi phí | Tổng | Hợp lý |
| **Giá trị tài sản, Giá trị hợp đồng, Tổng giá trị** | Trung bình | **Nên là Tổng** (giá trị cộng dồn) |
| **Số lượng giao, Doanh thu giao dịch, Số giao dịch** | Trung bình | **Sai**: khớp nhầm "gia" trong "giao" |
| **Số người tham gia, Phí gia hạn, Gia công (giờ)** | Trung bình | **Sai**: khớp nhầm "gia" |
| **Separate count** | Trung bình | **Sai**: khớp nhầm "rate" |

Đề xuất (cần anh/chị duyệt trước khi sửa):

1. So khớp theo **từ trọn vẹn** thay vì một phần chữ ("gia" không khớp "giao", "rate" không khớp "separate").
2. Bỏ "gia" không dấu đứng riêng; giữ "don gia", "gia ban"…
3. Tên bắt đầu bằng "giá trị" / "tổng" → luôn tính Tổng.
4. Cho phép người dùng chọn Tổng/Trung bình cho từng cột trên Dashboard và lưu lại.

Ảnh hưởng: chỉ thay đổi cách Dashboard chọn phép tính mặc định; phần xuất báo cáo không
cần sửa vì luôn dùng đúng phép tính Dashboard gửi kèm.

## 6. Giới hạn đã biết

- Edge chưa được chạy thực tế (mục 4 là quy trình để chạy trên Windows).
- Trong kiểm thử tự động, Playwright điều khiển việc tải file nên không tái hiện được hộp
  thoại "chặn tải nhiều file" của trình duyệt; đã kiểm chứng nút ⬇ Tải lại hoạt động.
  Trường hợp chặn thật được kiểm tra thủ công ở M07.
- File Word dùng font Arial (không nhúng); Windows có sẵn Arial hỗ trợ tiếng Việt. PDF nhúng font nên hiển thị giống nhau trên mọi máy.
- File Excel ghi theo luồng không có thẻ `dimension`; Excel và LibreOffice mở bình thường.
  Thư viện đọc dùng chế độ read-only (ví dụ openpyxl `read_only=True`) sẽ báo `max_row = None`.
