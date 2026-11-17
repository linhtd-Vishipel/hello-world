# Excel Dashboard

Web app nội bộ: nhân viên tải file Excel/CSV bất kỳ lên, hệ thống tự nhận diện
cấu trúc dữ liệu và dựng dashboard. Mã nguồn: [`excel_dashboard/`](../excel_dashboard/).

## Chạy ứng dụng

```bash
pip install -r requirements.txt
uvicorn excel_dashboard.main:app --host 0.0.0.0 --port 8000
# Mở http://<địa-chỉ-máy-chủ>:8000
```

Không cần Internet: thư viện biểu đồ (Chart.js 4.4.1, MIT) được đóng gói trong
`excel_dashboard/static/vendor/`. Font Unicode tiếng Việt cho PDF (DejaVu Sans,
giấy phép Bitstream Vera) nằm trong `excel_dashboard/fonts/`.

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `EXCEL_DASHBOARD_DATA_DIR` | `data/excel_dashboard` | Thư mục lưu file và dữ liệu đã xử lý |
| `EXCEL_DASHBOARD_MAX_MB` | `20` | Dung lượng file tối đa |
| `EXCEL_DASHBOARD_TZ` | `Asia/Ho_Chi_Minh` | Múi giờ ghi trên báo cáo và tên file |
| `EXCEL_DASHBOARD_PDF_MAX_ROWS` | `20000` | Số dòng chi tiết tối đa trong file PDF |
| `EXCEL_DASHBOARD_DOCX_MAX_ROWS` | `5000` | Số dòng chi tiết tối đa trong file Word |

File mẫu để thử: `excel_dashboard/samples/mau_doanh_thu.xlsx`.

## Quy trình sử dụng

1. Kéo thả file `.xlsx / .xlsm / .xls / .csv`, nhập tên báo cáo và người tải lên.
2. Bấm **Tải lên & tạo dashboard**. Dashboard hiện ngay. Mỗi sheet có một tab riêng.
3. Lọc theo cột phân loại, khoảng ngày hoặc từ khoá tìm kiếm. KPI, biểu đồ và bảng
   cập nhật theo bộ lọc.
4. **Thêm biểu đồ**: chọn loại (cột, thanh ngang, đường, tròn), nhóm theo, chỉ số,
   phép tính (tổng, trung bình, đếm, nhỏ nhất, lớn nhất). Biểu đồ được lưu trên
   máy chủ, mọi nhân viên mở bộ dữ liệu đều thấy.
5. Dùng khu vực **Xuất báo cáo** (mục bên dưới) để tải báo cáo về máy.
   **Tải file gốc** để lấy lại file đã tải lên.

## Xuất báo cáo

Khu vực **Xuất báo cáo** nằm ngay dưới tên bộ dữ liệu.

| Nút | Kết quả |
|---|---|
| 📊 Xuất Excel | File `.xlsx` |
| 📄 Xuất PDF | File `.pdf` khổ A4 |
| 📝 Xuất Word | File `.docx` |
| 👁 Xem trước báo cáo | Mở bản PDF ngay trên trang. Bấm "Tải PDF này" để lưu chính file đó |
| 🔄 Làm mới dữ liệu | Tải lại dữ liệu từ máy chủ, giữ nguyên sheet, bộ lọc, tìm kiếm, sắp xếp |
| 📊 Excel (trên từng biểu đồ) | Xuất riêng bảng thống kê của biểu đồ đó |

Tuỳ chọn:

- **Nội dung**: Chỉ số tổng hợp / Biểu đồ & bảng thống kê / Dữ liệu chi tiết.
- **Phạm vi Excel**: sheet hiện tại theo bộ lọc (mặc định), hoặc toàn bộ dữ liệu mọi sheet (không lọc).
- **Người lập**: in trên báo cáo.

Trình duyệt tự tải file về thư mục Tải xuống (Downloads). Tên file có dạng
`BaoCao_TenBaoCao_YYYYMMDD_HHMM.xlsx|pdf|docx`. Trong khi tạo file, nút hiện
"⏳ Đang tạo…". Kết quả thành công hoặc lỗi hiện ngay dưới các nút.

### Nguyên tắc dữ liệu

- Báo cáo chứa **đúng các dòng đang hiển thị**: theo bộ lọc, khoảng ngày, từ khoá
  tìm kiếm và thứ tự sắp xếp của bảng chi tiết. Các điều kiện này được in trên báo cáo.
- Chỉ số và bảng thống kê lấy đúng giá trị đang hiển thị trên Dashboard. Máy chủ tự
  tính lại từ dữ liệu gốc. Nếu lệch (ví dụ dữ liệu đã thay đổi), máy chủ từ chối xuất
  và yêu cầu bấm **Làm mới dữ liệu**.
- Không có dòng nào khớp bộ lọc thì không tạo file và có thông báo rõ.
- Số liệu không bị làm tròn trong Excel. Ngày tháng là kiểu ngày thật của Excel
  (`dd/mm/yyyy`, có giờ nếu dữ liệu có giờ).

### Nội dung từng định dạng

| | Excel | PDF | Word |
|---|---|---|---|
| Tiêu đề, thời gian lập, người lập, điều kiện lọc | ✔ (sheet Tổng quan) | ✔ | ✔ |
| Chỉ số tổng hợp | ✔ | ✔ | ✔ |
| Bảng thống kê (kèm tỷ trọng, tổng cộng) | ✔ mỗi bảng một sheet | ✔ | ✔ |
| Biểu đồ | Biểu đồ Excel gốc, sửa được | Ảnh biểu đồ | Ảnh biểu đồ |
| Dữ liệu chi tiết | ✔ không giới hạn dòng | ✔ tối đa 20.000 dòng | ✔ tối đa 5.000 dòng |
| AutoFilter, cố định hàng tiêu đề, tự giãn cột | ✔ | Lặp tiêu đề bảng mỗi trang | Lặp tiêu đề bảng mỗi trang |

- **PDF**: A4. Phần tổng quan in dọc. Bảng chi tiết trên 6 cột in ngang. Bảng quá rộng
  được chia thành nhiều phần, mỗi phần lặp lại cột đầu tiên, nên không mất chữ.
  Có đánh số "Trang x/y".
- Dữ liệu vượt giới hạn dòng của PDF/Word: máy chủ báo lỗi và gợi ý xuất Excel hoặc
  lọc bớt, không âm thầm cắt dòng.

Thời gian tạo file đo trên máy chủ thử nghiệm:

| Trường hợp | Thời gian |
|---|---|
| 1.200 dòng, cả 3 định dạng | dưới 1,5 giây |
| Excel 200.000 dòng | khoảng 25 giây |
| PDF 20.000 dòng | khoảng 25 giây |
| Word 5.000 dòng | khoảng 15 giây |

## Hệ thống tự nhận diện gì

| Nhận diện | Quy tắc |
|---|---|
| Dòng tiêu đề | Bỏ qua các dòng tiêu đề báo cáo phía trên. Lấy dòng đầu tiên có phần lớn ô là chữ làm tên cột |
| Dòng "Tổng cộng" | Tự loại bỏ để không cộng trùng (có thông báo trên dashboard) |
| Cột số | ≥ 80% giá trị là số. Hiểu định dạng Việt Nam: `1.234.567`, `1.234,5`, `15%`, `500.000 đ` |
| Cột ngày | Kiểu ngày của Excel, hoặc chuỗi `dd/mm/yyyy`, `yyyy-mm-dd` |
| Cột phân loại | Chữ, có ít giá trị khác nhau (ví dụ chi nhánh, loại thiết bị, trạng thái) |
| Cột mã / STT | Tên như `STT`, `Mã…`, `ID`, hoặc dãy số liên tiếp. Không đưa vào KPI |
| Năm / Tháng / Quý | Cột số có tên này được coi là phân loại, không cộng dồn |

Dashboard tự sinh gồm:

- **KPI**: số dòng và tổng của các cột chỉ số. Cột kiểu đơn giá hoặc tỷ lệ hiển thị trung bình.
- **Xu hướng** theo ngày, tháng, quý hoặc năm, tự chọn theo độ dài khoảng thời gian.
- **Cơ cấu** theo từng cột phân loại: 12 nhóm lớn nhất, phần còn lại gộp vào "Khác".
- **Phân bố** của chỉ số chính.

Mỗi biểu đồ có nút **Bảng** để xem số liệu chi tiết.

## API

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/datasets` | Tải file lên (multipart: `file`, `uploader`, `title`) |
| GET | `/api/datasets` | Danh sách bộ dữ liệu |
| GET | `/api/datasets/{id}` | Dữ liệu đã xử lý và cấu hình dashboard |
| PUT | `/api/datasets/{id}/dashboard` | Lưu các biểu đồ tự thêm |
| POST | `/api/datasets/{id}/export/{xlsx\|pdf\|docx}` | Tạo file báo cáo (JSON: sheet, `row_indices`, bộ lọc, KPI, biểu đồ). Thêm `?inline=true` để xem trước PDF |
| GET | `/api/datasets/{id}/file` | Tải file gốc |
| DELETE | `/api/datasets/{id}` | Xoá bộ dữ liệu |

## Giới hạn và lưu ý bảo mật

- **Chưa có đăng nhập.** Ai truy cập được địa chỉ máy chủ cũng có thể xem, tải lên
  và xoá dữ liệu. Chỉ chạy trong mạng nội bộ, hoặc đặt sau reverse proxy có xác thực
  (ví dụ Nginx basic auth hoặc SSO). Có thể tích hợp RBAC sẵn có ở `app/permissions.py`.
- Mỗi sheet xử lý tối đa 200.000 dòng.
- Ô gộp (merged cells) chỉ giữ giá trị ở ô đầu tiên.
- Công thức Excel được đọc theo giá trị đã tính lưu trong file. File tạo bằng công cụ
  không lưu giá trị tính toán có thể ra ô trống.
- Dữ liệu lưu dạng file JSON. Hãy sao lưu thư mục `EXCEL_DASHBOARD_DATA_DIR` định kỳ.
