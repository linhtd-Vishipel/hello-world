# Biên bản làm việc — Excel Dashboard, nghiệm thu Windows/Edge

Ngày: **18/11/2026**. Nhánh: `claude/excel-upload-dashboard-app-xfssug`. Pull Request: **#10** (mở, **chưa merge**).

Quy ước trạng thái: **PASS** (đạt) · **FAIL** (lỗi thật) · **SKIP** (không áp dụng / công cụ tùy chọn không có —
không tính là PASS) · **CHƯA KIỂM THỬ** (NOT TESTED). Mọi kết quả "Linux" dưới đây chạy trong môi trường phát triển
(Chrome 153 thay cho Edge) và **không** dùng làm căn cứ nghiệm thu Windows.

## 1. Công việc đã hoàn thành hôm nay

| # | Nội dung | Commit |
|---|---|---|
| 1 | Bộ nghiệm thu **không bắt buộc Poppler và LibreOffice**: PDF kiểm bằng `pdfcheck.py` (thư viện chuẩn Python), Excel bằng openpyxl, Word bằng python-docx; Poppler/LibreOffice chỉ dùng đối chiếu chéo khi có, nếu không ghi SKIP. Trạng thái PASS/FAIL/SKIP/CHƯA KIỂM THỬ; kiểm tra dung lượng ổ đĩa; `pip --no-cache-dir` | `8de1f39` |
| 2 | Hồ sơ bàn giao: dấu vân tay, dung lượng đo thực tế (venv ~123 MB, node_modules ~19 MB, kết quả ~102 MB) | `fc93499` |
| 3 | Tạo **Pull Request #10** (`claude/excel-upload-dashboard-app-xfssug` → `main`), theo dõi CI | — |
| 4 | **M02 đối chiếu động**: bỏ điều kiện cố định 70 dòng; công cụ `m02_excel.py` + `M02_DOI_CHIEU_EXCEL.bat`; bước 06 không cho ghi PASS M02 khi đối chiếu tự động chưa chạy hoặc còn FAIL | `9764e2b` |

## 2. Kết quả kiểm thử

### 2.1 Môi trường phát triển (Linux — không phải căn cứ nghiệm thu)

| Kiểm thử | PASS | FAIL | SKIP | Ghi chú |
|---|---|---|---|---|
| pytest (Python 3.13 và 3.11 như CI) | 178 | 0 | 0 | |
| CI GitHub `test` trên PR #10, commit `9764e2b` | đạt | — | — | |
| Bước 01–05, máy không có Poppler/LibreOffice: giao diện T01–T42 | 42 | 0 | 0 | Chrome 153, không phải Edge |
| Bước 05 — verify.py | 130 | 0 | 36 | 36 SKIP = 4 đối chiếu chéo Poppler + 32 dựng trang Word bằng LibreOffice |
| Bước 05 — dữ liệu lớn (đến 200.000 dòng) | 16 | 0 | 0 | |
| verify.py khi CÓ Poppler/LibreOffice | 166 | 0 | 0 | đối chiếu chéo Poppler khớp số trang và toàn bộ ký tự |
| verify.py với 4 file cố ý làm hỏng | — | 8 | — | phát hiện đủ 4 lỗi (đúng mong đợi) |
| M02 tự động — file giả lập kiểu "Phụ lục 2" (4 sheet: 26/12/5 dòng + sheet ghi chú) | 51 | 0 | 2 | SKIP: file không có biểu đồ |
| M02 tự động — 6 kiểu làm hỏng file xuất + biểu đồ không gắn ô | — | 7/7 phát hiện | — | đúng mong đợi |
| M02 tự động — 5 file mẫu khác cấu trúc (3 → 25.000 dòng, 40 cột), 8 file xuất | 214 | 1 | 3 | FAIL đúng mong đợi: file xuất của bài T đã sắp xếp lại dòng → bị phát hiện "khác thứ tự"; SKIP: không áp dụng |

### 2.2 Thực tế trên Windows (theo thông tin người dùng cung cấp)

| Nội dung | Trạng thái | Bằng chứng nhận được |
|---|---|---|
| accept.js 42/42 PASS, verify.py 130 PASS / 0 FAIL / 36 SKIP, Edge 156.0.4314.42 | Người dùng báo trong tin nhắn | **Chưa nhận file** (`acceptance_report.md` nằm trên máy Windows, phiên làm việc không truy cập được) |
| Bước 06 đã khởi động (Web App cổng 8000, Edge đã mở) | Có ảnh chụp màn hình | Đang chờ nhập họ tên — M01–M12 chưa nhập lúc chụp |
| M01 — Xuất Excel | **PASS** (người dùng xác nhận) | chưa có trong `ket_qua_tong_hop.json` |
| M02 — Mở/đối chiếu file Excel | **Đang điều chỉnh** — tiêu chí 70 dòng không phù hợp file thực tế; đã đổi sang đối chiếu động, **chưa kiểm lại trên Windows** | — |
| M03–M12 | **CHƯA KIỂM THỬ** | — |
| Dấu vân tay mã nguồn trên Windows | **Chưa xác nhận** (báo cáo chưa gửi) | — |

Dữ liệu kiểm thử thực tế: **"Phụ lục 2 Bảng tổng hợp đánh giá chất lượng 2.2024"** — nhiều sheet, sheet lớn nhất
khoảng 26 dòng, các sheet có số dòng khác nhau → phải đối chiếu động theo chính file nguồn.

## 3. Lỗi và vấn đề còn tồn tại

1. Chưa có `ket_qua_tong_hop.json` từ Windows → **G1–G6 chưa có bằng chứng**.
2. Mã nguồn trên Windows phải **tải lại** để có M02 mới; dấu vân tay cần khớp **`8f20a1d16f9d` (37 file)**
   (bản cũ `d128bc94a9f4` không còn là bản bàn giao).
3. M02 mới chưa chạy với file "Phụ lục 2" thật. Rủi ro cần theo dõi: file có tiêu đề cột gộp nhiều hàng — Web App
   lấy một hàng làm tiêu đề theo quy tắc xử lý; nếu đối chiếu báo FAIL cần xem `m02_doi_chieu_excel.md`.
4. `M02_DOI_CHIEU_EXCEL.bat` và các BAT khác mới **kiểm tra tĩnh**, chưa có log chạy CMD thật gửi về.
5. Bài tự động T08 (`accept.js`) vẫn kiểm "70 dòng" — đúng vì chạy trên file mẫu tự sinh; không ảnh hưởng M02.
6. File ZIP `C:\nghiemthu\edge` (~30 MB) không tải lên được → chỉ gửi file báo cáo nhỏ (xem file tiếp tục công việc).

## 4. File mã nguồn đã chỉnh sửa hôm nay

| File | Thay đổi |
|---|---|
| `tools/acceptance/pdfcheck.py` (mới) | đọc/kiểm tra PDF bằng thư viện chuẩn Python |
| `tools/acceptance/m02_excel.py` (mới) | đối chiếu động file Excel xuất ↔ file nguồn (M02) |
| `tools/acceptance/verify.py` | bỏ phụ thuộc Poppler/LibreOffice; trạng thái SKIP; nhãn số dòng tính theo dữ liệu |
| `tools/acceptance/nghiemthu.py` | công cụ tùy chọn; SKIP/CHƯA KIỂM THỬ; dung lượng ổ đĩa; lệnh `doi-chieu-excel`; khoá PASS M02 |
| `tools/acceptance/windows/M02_DOI_CHIEU_EXCEL.bat` (mới), `05_DOI_CHIEU_KET_QUA.bat`, `DOC_TRUOC.txt` | |
| `tests/test_acceptance_kit.py`, `tests/test_m02_excel.py` (mới) | |
| `docs/EXCEL_DASHBOARD_NGHIEM_THU.md` (M02 mục 4.4), `docs/HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md`, `docs/BAN_GIAO_KIEM_THU_WINDOWS.md` | |

Mã Web App (`excel_dashboard/`) **không thay đổi** hôm nay.

## 5. Trạng thái Git và Pull Request

| Mục | Giá trị |
|---|---|
| Nhánh | `claude/excel-upload-dashboard-app-xfssug` (đã đẩy lên GitHub, không có thay đổi chưa lưu ngoài 2 file bàn giao này) |
| Commit mã nguồn mới nhất | `9764e2b` — Nghiệm thu M02: đối chiếu động… |
| `main` | `d8a0b8b` (chưa có thay đổi của nhánh) |
| Phạm vi so với `main` | 46 file, chỉ thêm dòng, không xung đột |
| Pull Request | **#10** https://github.com/linhtd-Vishipel/hello-world/pull/10 — mở, CI `test` đạt, **không merge** |
| Dấu vân tay bàn giao | **`8f20a1d16f9d` (37 file)** |


---

# Ngày 19/11/2026

## Xác minh phiên bản
- Windows báo `('d128bc94a9f4', 35)` = bản `8de1f39`/`fc93499` (trước M02). ZIP GitHub của nhánh tại `da87cf9`
  tính được `('8f20a1d16f9d', 37)`: máy Windows lúc đó đang dùng thư mục mã nguồn cũ. Không đổi thuật toán dấu vân tay.
- Người dùng sau đó chạy `M02_DOI_CHIEU_EXCEL.bat` trên Windows 10 với bản `8f20a1d16f9d`.

## Lỗi M02: không nhận file Excel xuất hợp lệ (Windows 10)
File nguồn `E:\1. Kỹ thuật\7. BCKT\Phu luc 2 Bang tong hop danh gia chat luong 2.2024.xls` được nhận; 2 file xuất
`E:\Downloads\BaoCao_PhuLuc2BangTongHopDanhGiaChatLuong2024_20261119_1623.xlsx` / `_1624.xlsx` bị báo "Không hợp lệ".

Nguyên nhân (đọc mã `nghiemthu.py` bản `8f20a1d16f9d`):
1. **Xác định chắc chắn** — hai đường dẫn trên một dòng: mã cũ coi cả dòng là MỘT đường dẫn → không tồn tại → "Không hợp lệ".
2. **Xác định chắc chắn** — danh sách chọn theo số chỉ tìm trong `%USERPROFILE%\Downloads`; Edge tải về `E:\Downloads`
   nên danh sách trống, gõ số luôn bị từ chối.
3. **Chưa tái hiện được** — một đường dẫn đơn bị từ chối: với chuỗi `E:\Downloads\...xlsx` thuần, mã cũ phải nhận.
   Khả năng: chuỗi có ký tự vô hình khi chép (U+202A…), ký tự thừa (dấu phẩy, ngoặc đơn, tiền tố `& ` của PowerShell)
   hoặc nhập nhầm ô. Mã cũ chỉ in "Không hợp lệ" nên không còn dấu vết để xác định.

Đã sửa (`nghiemthu.py`, không đổi `m02_excel.py` — thuật toán và tiêu chí đối chiếu giữ nguyên):
- loại ký tự vô hình, khoảng trắng, ngoặc kép/đơn, tiền tố `& `; nhận một hoặc nhiều đường dẫn một dòng;
- danh sách theo số lấy từ thư mục tải xuống cấu hình trong Edge + Downloads + thư mục file nguồn;
- kiểm tra tồn tại, thư mục, đuôi file, trùng file nguồn, quyền đọc/khoá, chữ ký nội dung .xlsx/.xls;
- từ chối luôn kèm lý do cụ thể (và chuỗi đã nhập khi không tìm thấy), ghi vào log `logs\M02_m02_doi_chieu_excel.log`;
- in rõ tên + đường dẫn + dung lượng từng file được nhận.

Kiểm thử (Linux — **chưa chạy trên Windows CMD**): pytest 183/183 (Python 3.13 và 3.11); thêm 5 bài cho phần nhập file
(1 file, 2 file, ngoặc kép, tiếng Việt + khoảng trắng, ký tự vô hình, `& '...'`, file không tồn tại, sai định dạng,
nội dung giả, thư mục, trùng file nguồn, số ngoài danh sách, thư mục tải xuống của Edge ở ổ khác). Chạy thử qua
terminal giả lập với file nguồn **.xls** dạng "Phụ lục 2" (26/12/5 dòng): nhận đủ 2 file xuất, M02 tự động
54 PASS, 0 FAIL, 1 SKIP (bản "toàn bộ sheet" không có biểu đồ — không áp dụng).

Dấu vân tay mới: **`1fe7c9540b33` (37 file)** — phải tải lại mã nguồn trên Windows.
Trạng thái: M01–M12 trên Windows **CHƯA KIỂM THỬ** với bản mới; PR #10 **chưa merge**.

## Biểu đồ Excel TK02, TK03: tiêu đề chồng nhãn trục (kiểm tra trực quan trên Windows, file Phụ lục 2)
Kết quả người dùng kiểm bằng mắt: Tổng quan, TK01, TK04–TK06 đạt; TK02, TK03 tiêu đề chồng nhãn trục;
Dữ liệu chi tiết 19 dòng, cấu trúc và bộ lọc bình thường.

Nguyên nhân (`excel_dashboard/export.py`, biểu đồ thanh ngang — Web App dùng khi nhóm có hơn 6 mục): trục danh mục
được đảo (`orientation = maxMin`) để nhóm đầu nằm trên cùng như Dashboard, nhưng không đặt vị trí trục giá trị, nên
Excel vẽ trục giá trị (và nhãn số) ở **đỉnh** vùng vẽ, ngay dưới tiêu đề. Ngoài ra trục giá trị tự bắt đầu từ giá trị
gần nhỏ nhất (ví dụ 76), làm chênh lệch giữa các thanh bị phóng đại.

Đã sửa (chỉ phần trình bày biểu đồ trong file Excel xuất; dữ liệu, bảng, công thức, thứ tự sheet, PDF/Word không đổi):
- thanh ngang: trục giá trị cắt tại danh mục cuối (`crosses = max`) → nhãn số nằm dưới đáy, tách khỏi tiêu đề;
- biểu đồ cột/thanh/phân bố có giá trị không âm: trục bắt đầu từ 0 (như Dashboard);
- mọi biểu đồ: tiêu đề đặt phía trên vùng vẽ (`overlay = 0`), không vẽ đè.
Rà soát 4 loại biểu đồ (thanh ngang, cột, tròn, đường) bằng cách dựng trang LibreOffice: không còn chồng lấn.

Kiểm thử: thêm `test_export_xlsx_chart_layout_title_never_overlaps_axis` (FAIL với mã cũ, PASS với mã mới);
pytest 184/184 PASS. **Chưa kiểm trên Microsoft Excel thật** — cần xuất lại file Phụ lục 2 và xem TK02, TK03.
Dấu vân tay mới: **`1ba8d84b6871` (37 file)**.
