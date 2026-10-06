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
`excel_dashboard/static/vendor/`.

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `EXCEL_DASHBOARD_DATA_DIR` | `data/excel_dashboard` | Thư mục lưu file và dữ liệu đã xử lý |
| `EXCEL_DASHBOARD_MAX_MB` | `20` | Dung lượng file tối đa |

File mẫu để thử: `excel_dashboard/samples/mau_doanh_thu.xlsx`.

## Quy trình sử dụng

1. Kéo thả file `.xlsx / .xlsm / .xls / .csv`, nhập tên báo cáo và người tải lên.
2. Bấm **Tải lên & tạo dashboard**. Dashboard hiện ngay. Mỗi sheet có một tab riêng.
3. Lọc theo cột phân loại hoặc khoảng ngày. KPI, biểu đồ và bảng cập nhật theo bộ lọc.
4. **Thêm biểu đồ**: chọn loại (cột, thanh ngang, đường, tròn), nhóm theo, chỉ số,
   phép tính (tổng, trung bình, đếm, nhỏ nhất, lớn nhất). Biểu đồ được lưu trên
   máy chủ, mọi nhân viên mở bộ dữ liệu đều thấy.
5. **In / PDF** để xuất báo cáo. **Tải file gốc** để lấy lại file đã tải lên.

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
