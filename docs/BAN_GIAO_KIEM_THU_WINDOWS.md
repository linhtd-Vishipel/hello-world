# Bàn giao kiểm thử Windows 10/11 + Microsoft Edge — Excel Dashboard

Tài liệu này là **hồ sơ bàn giao** cho đợt nghiệm thu thực tế trên Windows. Hướng dẫn thao tác từng bước:
[HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md](HUONG_DAN_NGHIEM_THU_EDGE_WINDOWS.md). Danh mục và tiêu chí M01–M12:
[EXCEL_DASHBOARD_NGHIEM_THU.md](EXCEL_DASHBOARD_NGHIEM_THU.md) mục 4.4–4.5.

## 1. Phiên bản bàn giao

| Mục | Giá trị |
|---|---|
| Kho mã | `https://github.com/linhtd-Vishipel/hello-world` |
| Nhánh | `claude/excel-upload-dashboard-app-xfssug` (chưa merge vào `main`) |
| Dấu vân tay mã nguồn cần kiểm thử | **`1ba8d84b6871` (37 file)** — báo cáo nghiệm thu in giá trị này ở mục "Dấu vân tay mã nguồn" |
| `main` tại thời điểm bàn giao | `d8a0b8b` (chưa có thay đổi nào của nhánh này) |

Dấu vân tay là mã băm của toàn bộ mã Web App và bộ nghiệm thu (đã chuẩn hoá xuống dòng), nên tải ZIP hay
`git clone` đều cho cùng giá trị. **Nếu báo cáo in giá trị khác `1ba8d84b6871`, bản đã kiểm thử không phải bản bàn giao**
— cần tải lại đúng nhánh và chạy lại.

## 2. Phạm vi sẽ phát hành (Pull Request `claude/excel-upload-dashboard-app-xfssug` → `main`)

| Phần | Nội dung |
|---|---|
| Web App Excel Dashboard | `excel_dashboard/`: upload Excel/CSV, tự nhận diện cột, dashboard, bộ lọc, biểu đồ |
| Xuất báo cáo | Xuất Excel (.xlsx), PDF (A4, font tiếng Việt nhúng), Word (.docx) theo đúng bộ lọc; xem trước; nút Tải lại |
| Bộ nghiệm thu | `tools/acceptance/` (6 file BAT + `M02_DOI_CHIEU_EXCEL.bat`, `nghiemthu.py`, kiểm thử tự động), `BAT_DAU_NGHIEM_THU_EDGE.bat` |
| Tài liệu, kiểm thử | `docs/`, `tests/` |

Không thay đổi: `app/` (API khách hàng, phân quyền), `addons/` (Odoo), quy trình CI `.github/workflows/tests.yml`.
Tại thời điểm bàn giao: không xung đột với `main`, không xoá dòng nào của `main`. File đã có trên `main` chỉ được
bổ sung thêm dòng: `README.md` (giới thiệu Excel Dashboard), `requirements.txt` (thư viện openpyxl, xlrd,
python-multipart, reportlab, python-docx), `.gitignore`. Mọi file khác là file mới.

## 3. Đã kiểm chứng và chưa kiểm chứng

| Nội dung | Trạng thái |
|---|---|
| 184 kiểm thử tự động (pytest), mô phỏng đúng CI: Python 3.11 + `requirements.txt` | Đạt trên **Linux** |
| Bộ nghiệm thu đủ 6 bước, kể cả các tình huống lỗi | Đạt trên **Linux, Chrome 153 thay cho Edge** |
| 10 file BAT | **Chỉ kiểm tra tĩnh** (cú pháp, nhãn, ký tự đặc biệt, CRLF) — **chưa chạy bằng Windows CMD** |
| Bộ nghiệm thu trên máy **không có Poppler và LibreOffice** (bước 01 ĐẠT, các mục phụ ghi SKIP) | Đạt trên **Linux, Chrome 153 thay cho Edge** |
| Microsoft Edge, Microsoft Excel/Word, M01–M12 | **Chưa kiểm thử** — là nội dung của đợt nghiệm thu này |

Máy nghiệm thu **không cần cài Poppler hay LibreOffice**. PDF được kiểm tra bằng `tools/acceptance/pdfcheck.py`
(thư viện chuẩn Python, cho kết quả trùng khớp Poppler trên toàn bộ PDF của Web App), Excel bằng openpyxl,
Word bằng python-docx. Báo cáo có 4 trạng thái: PASS, FAIL, SKIP (công cụ tùy chọn không có — **không tính là
PASS**), CHƯA KIỂM THỬ (NOT TESTED).

Kết quả trên Linux **không** được dùng làm căn cứ nghiệm thu Windows. Báo cáo của bộ công cụ cũng không thể kết luận
ĐẠT nếu kiểm thử tự động không chạy trên Microsoft Edge.

## 4. Xác nhận chức năng xuất Excel / PDF / Word trên Windows

| Chức năng | Bài kiểm thử tự động (bước 04–05) | Bài kiểm thử thủ công (bước 06) |
|---|---|---|
| Xuất Excel | T02, T04, T11, T14, T17, T21, T24, T31, T36 + đối chiếu 4a–4d | **M01** (tải file), **M02** (đối chiếu động file xuất ↔ file Excel thực tế + mở bằng Microsoft Excel) |
| Xuất PDF | T05, T10, T15, T18, T22, T25, T32 + đối chiếu 5a–5c, trình bày PDF | **M03** (mở bằng Edge và Adobe Reader), **M05** (xem trước) |
| Xuất Word | T07, T16, T19, T23, T26 + đối chiếu 6a–6d, trình bày Word | **M04** (mở bằng Microsoft Word) |
| Tải file trên Edge | T09, T41 | **M06, M07, M08, M09** |
| Giới hạn dữ liệu | T28, T29, T33 + 16 bài dữ liệu lớn | **M10, M12** |

## 5. Hồ sơ gửi lại sau khi chạy

1. Nén cả thư mục **`C:\nghiemthu\edge`** (chuột phải → Send to → Compressed (zipped) folder) và gửi file ZIP.
   Tối thiểu phải có: `BAO_CAO_NGHIEM_THU.html`, `BAO_CAO_NGHIEM_THU.md`, `ket_qua_tong_hop.json`, thư mục `logs\`,
   `ket_qua_tu_dong\` (ảnh `loi_*.png` nếu có) và `thu_cong\` (kết quả + ảnh M01–M12).
2. Phiếu xác nhận ở mục 8 (điền trực tiếp trong tin nhắn).

## 6. Điều kiện bắt buộc trước khi tạo Pull Request và hợp nhất

Tất cả điều kiện phải đạt; chỉ cần một điều kiện không đạt thì **không tạo PR / không merge**.

| Mã | Điều kiện | Cách kiểm |
|---|---|---|
| G1 | Báo cáo kết luận **ĐẠT** | `ket_qua_tong_hop.json`: `ket_luan = "ĐẠT"` |
| G2 | **0 FAIL, 0 CHƯA KIỂM THỬ** ở cả 4 nhóm (A 42 bài, B đối chiếu, C 16 bài, D 12 bài M01–M12). Mục SKIP được ghi nhận riêng, không tính là PASS | `fail = 0`, `chua = 0` (số SKIP ở `skip`) |
| G3 | Chạy trên **Microsoft Edge** qua kênh `msedge` | `trinh_duyet.launch.channel = "msedge"` |
| G4 | Chạy trên **Windows 10 hoặc 11**, bước 01 không có lỗi môi trường | `he_dieu_hanh`, `loi_moi_truong = []` |
| G5 | Đúng phiên bản bàn giao | `dau_van_tay` bắt đầu bằng `1ba8d84b6871` |
| G6 | Xuất Excel/PDF/Word được xác nhận: M01, M02, M03, M04, M05 đều PASS | nhóm D |
| G7 | Pull Request: CI (`Tests`) đạt, không xung đột, chỉ gồm các thay đổi ở mục 2 | trang PR trên GitHub |
| G8 | Người có thẩm quyền đồng ý hợp nhất (trả lời trong cuộc trao đổi) | tin nhắn xác nhận |

Nếu có bài FAIL: sửa trên nhánh `claude/excel-upload-dashboard-app-xfssug`, cập nhật dấu vân tay trong tài liệu này,
rồi **chạy lại nghiệm thu Windows** (tối thiểu 04, 05, 06 và các bài M liên quan) trước khi xét lại G1–G8.

## 7. Quy trình phát hành (thực hiện sau khi G1–G6 đạt)

1. Đối chiếu file `ket_qua_tong_hop.json` nhận được với G1–G6; đối chiếu dấu vân tay với nhánh.
2. Kiểm tra Git diff lần cuối (`main...claude/excel-upload-dashboard-app-xfssug`).
3. Tạo Pull Request vào `main`, kèm tóm tắt kết quả nghiệm thu Windows.
4. Chờ CI `Tests` chạy xong; kiểm tra xung đột và danh sách file thay đổi (G7).
5. Hợp nhất **chỉ khi** G1–G8 đạt.
6. Xác nhận commit mới nhất của `main` và CI trên `main` sau khi hợp nhất.

Về triển khai: kho mã hiện **không có quy trình tự động triển khai** (chỉ có CI chạy kiểm thử). Sau khi hợp nhất,
Web App cần được cài/khởi động trên máy chủ theo `docs/EXCEL_DASHBOARD.md` (mục "Chạy ứng dụng") bởi người phụ trách.

## 8. Phiếu xác nhận nghiệm thu (điền và gửi lại)

| Mục | Nội dung |
|---|---|
| Người kiểm thử | |
| Ngày kiểm thử | |
| Máy tính / Windows (10 hoặc 11, bản build) | |
| Phiên bản Microsoft Edge | |
| Phiên bản Python (dòng `Python: ...` đầu mỗi bước) | |
| Dấu vân tay trong báo cáo | |
| Kết luận trong báo cáo (ĐẠT / KHÔNG ĐẠT) | |
| Tổng số bài / PASS / FAIL / CHƯA KIỂM THỬ / SKIP | |
| M01–M12: các bài FAIL hoặc ghi chú (nếu có) | |
| Microsoft Excel mở file xuất được (M02) | Có / Không |
| Microsoft Word mở file xuất được (M04) | Có / Không |
| PDF mở bằng Edge và Adobe Reader được (M03) | Có / Không |
| Các file BAT có lỗi CMD nào không (ghi lại thông báo) | |
| Đồng ý tạo Pull Request và hợp nhất vào `main` | Có / Không |
