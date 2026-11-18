# Hướng dẫn nghiệm thu Microsoft Edge trên Windows 10/11

Tài liệu dành cho người thực hiện nghiệm thu, **không cần biết lập trình**. Sau khi cài
các phần mềm ở mục 1 (làm một lần), anh/chị chỉ cần **bấm đúp 6 file BAT theo thứ tự**.
Mọi kết quả, file tải về, ảnh chụp lỗi, log và báo cáo được lưu trong **`C:\nghiemthu\edge`**.

## Tìm file ở đâu? (đọc trước)

| Cần tìm | Ở đâu | Có từ khi nào |
|---|---|---|
| 6 file BAT | `C:\nghiemthu\ma_nguon\tools\acceptance\windows\` — hoặc bấm đúp `C:\nghiemthu\ma_nguon\BAT_DAU_NGHIEM_THU_EDGE.bat` để mở sẵn thư mục này | Sau khi tải mã nguồn (mục 1.1) |
| Thư mục kết quả | `C:\nghiemthu\edge\` | Sau khi chạy **01** lần đầu |
| Báo cáo `BAO_CAO_NGHIEM_THU.html` | `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.html` | **Chỉ sau khi chạy xong 06** (06 tự mở báo cáo) |

Muốn mở lại kết quả bất kỳ lúc nào: bấm đúp **`MO_THU_MUC_KET_QUA.bat`** (cùng thư mục với 6 file BAT).
File này mở thư mục `C:\nghiemthu\edge` và mở báo cáo nếu đã có; nếu chưa có, nó cho biết cần chạy bước nào.

> Báo cáo **không có sẵn** trong mã nguồn tải về: nó được tạo trên chính máy của anh/chị khi chạy
> các bước 01 → 06. Nếu chưa chạy, thư mục `C:\nghiemthu\edge` cũng chưa tồn tại.

| Bước | File | Việc máy làm | Thời gian ước tính |
|---|---|---|---|
| 01 | `01_KIEM_TRA_MOI_TRUONG.bat` | Kiểm tra Python, Node.js, Edge, Poppler, LibreOffice, thư viện, cổng mạng, ổ đĩa | ~10 giây |
| 02 | `02_TAO_DU_LIEU_MAU.bat` | Tạo 6 file Excel mẫu (3 dòng → 200.000 dòng) | ~1 phút |
| 03 | `03_CAI_DAT_THU_VIEN.bat` | Cài thư viện Python + Playwright, mở thử Edge | 2–5 phút (cần Internet) |
| 04 | `04_KIEM_THU_EDGE.bat` | Chạy 42 bài kiểm thử tự động T01–T42 trên Edge | 5–10 phút |
| 05 | `05_DOI_CHIEU_KET_QUA.bat` | Đối chiếu 6 tầng dữ liệu, kiểm tra file PDF/Word/Excel, dữ liệu lớn | 5–8 phút |
| 06 | `06_TONG_HOP_BAO_CAO.bat` | Hướng dẫn làm và nhập M01–M12, lập báo cáo nghiệm thu | 30–60 phút (phần thủ công) |

---

## 1. Chuẩn bị (làm một lần)

### 1.1 Tải mã nguồn về máy

**Cách A — dùng Git** (nếu máy đã có Git). Mở **Command Prompt** (bấm phím Windows, gõ `cmd`, Enter) rồi gõ:

```bat
git clone https://github.com/linhtd-Vishipel/hello-world.git C:\nghiemthu\ma_nguon
cd /d C:\nghiemthu\ma_nguon
git checkout claude/excel-upload-dashboard-app-xfssug
```

**Cách B — tải file ZIP**:

1. Mở `https://github.com/linhtd-Vishipel/hello-world/tree/claude/excel-upload-dashboard-app-xfssug` (đăng nhập GitHub nếu kho mã ở chế độ riêng tư).
2. Bấm nút **Code** → **Download ZIP**.
3. **Chuột phải file ZIP → Properties (Thuộc tính) → đánh dấu Unblock (Bỏ chặn) → OK.**
   Làm bước này để Windows không hiện cảnh báo bảo mật mỗi lần mở file BAT.
4. Giải nén, đổi tên thư mục bên trong thành `C:\nghiemthu\ma_nguon`.

Sau bước này phải có thư mục: `C:\nghiemthu\ma_nguon\tools\acceptance\windows\` chứa 6 file BAT.

### 1.2 Cài Python 3.11 trở lên

1. Mở `https://www.python.org/downloads/windows/`, tải bản **Windows installer (64-bit)** mới nhất.
2. Chạy file cài, **đánh dấu ô "Add python.exe to PATH"** ở màn hình đầu, rồi bấm **Install Now**.
3. Kiểm tra: mở Command Prompt **mới**, gõ `py -3 --version` → hiện `Python 3.1x.x`.

### 1.3 Cài Node.js bản LTS (20 trở lên)

1. Mở `https://nodejs.org/`, tải bản **LTS** (file `.msi`).
2. Cài với các lựa chọn mặc định.
3. Kiểm tra: Command Prompt mới, gõ `node --version` → hiện `v20...` hoặc mới hơn.

### 1.4 Microsoft Edge

Edge có sẵn trên Windows 10/11. Mở Edge, vào địa chỉ `edge://settings/help` để cập nhật bản mới nhất.

### 1.5 Cài Poppler (bắt buộc — dùng để đọc và kiểm tra file PDF)

1. Mở `https://github.com/oschwartz10612/poppler-windows/releases`.
2. Ở bản phát hành mới nhất (trên cùng), mục **Assets**, tải file `Release-<phiên bản>.zip`.
3. Chuột phải file ZIP → Properties → Unblock → OK.
4. Giải nén vào **`C:\nghiemthu\cong_cu\poppler`**.
5. Kiểm tra: phải có file theo dạng
   `C:\nghiemthu\cong_cu\poppler\poppler-<phiên bản>\Library\bin\pdftotext.exe`.

Không cần sửa PATH: bước 01 tự tìm Poppler trong `C:\nghiemthu\cong_cu\poppler`.
Nếu anh/chị giải nén vào nơi khác, đặt biến môi trường trước khi chạy BAT (Command Prompt):
`setx POPPLER_BIN "D:\duong_dan\Library\bin"` rồi mở lại file BAT.

**Bộ công cụ không bỏ qua khi thiếu Poppler**: bước 01 báo LỖI và bước 05 dừng lại cho tới khi cài xong.

### 1.6 Cài LibreOffice (bắt buộc — dùng để mở thử file Word/Excel)

1. Mở `https://www.libreoffice.org/download/`, tải bản **Windows x86-64**.
2. Cài với các lựa chọn mặc định (vào `C:\Program Files\LibreOffice`).

Nếu cài vào thư mục khác: `setx NGHIEMTHU_SOFFICE "D:\LibreOffice\program\soffice.exe"`.

### 1.7 Đóng các chương trình dùng cổng 8000 và 8765

Bộ công cụ tự bật Web App ở cổng **8765** (bước 04, 05) và **8000** (bước 06, đúng như tài liệu
nghiệm thu M07/M09). Nếu đang chạy Web App Excel Dashboard ở cửa sổ khác, hãy đóng trước.

---

## 2. Thực hiện nghiệm thu

Mở **File Explorer**, vào `C:\nghiemthu\ma_nguon\tools\acceptance\windows\`. Bấm đúp lần lượt:

### Bước 01 — `01_KIEM_TRA_MOI_TRUONG.bat`

- Mỗi dòng có dấu `[ OK ]`, `[LỖI]`, `[CẦN]` hoặc `[ ! ]`.
- `[LỖI]`: làm theo các dòng `→` ngay bên dưới, xong **đóng cửa sổ và mở lại file 01**.
- `[CẦN]` thư viện / dữ liệu mẫu: bình thường ở lần đầu — bước 02 và 03 sẽ xử lý.
- Đạt khi dòng cuối là `KẾT LUẬN: ĐẠT` hoặc `Công cụ hệ thống đã đủ...`.

### Bước 02 — `02_TAO_DU_LIEU_MAU.bat`

Tạo 6 file Excel mẫu vào `C:\nghiemthu\edge\mau\`. Lần đầu máy tạo môi trường Python riêng
(`C:\nghiemthu\cong_cu\venv`) và cài thư viện `openpyxl` (cần Internet).

### Bước 03 — `03_CAI_DAT_THU_VIEN.bat`

Cài thư viện cho Web App và bộ kiểm thử, sau đó **mở thử Microsoft Edge** bằng Playwright.
Đạt khi có dòng bắt đầu bằng `OK <phiên bản Edge>` và dòng `KẾT LUẬN: ĐẠT`. Chạy lại 01 để xác nhận mọi mục `[ OK ]`.

### Bước 04 — `04_KIEM_THU_EDGE.bat`

- Máy tự bật Web App, tự điều khiển Edge (chạy ẩn) để làm 42 bài T01–T42, tự tắt Web App khi xong.
- **Không cần thao tác**; có thể để máy chạy.
- Kết thúc hiện `KẾT QUẢ GIAO DIỆN: x/42 PASS`. Bài FAIL được liệt kê kèm lý do và có ảnh chụp
  `C:\nghiemthu\edge\ket_qua_tu_dong\loi_<mã>.png`.
- Kể cả khi có FAIL, **vẫn chạy tiếp 05 và 06** để có báo cáo đầy đủ.

### Bước 05 — `05_DOI_CHIEU_KET_QUA.bat`

Đối chiếu file gốc → dữ liệu xử lý → Dashboard → Excel → PDF → Word; kiểm tra trang trắng,
tiêu đề bị tách, font nhúng, chữ tràn lề, đánh số trang; kiểm tra giới hạn dữ liệu lớn.
Kết thúc hiện `KẾT QUẢ ĐỐI CHIẾU: x/y PASS` và `KẾT QUẢ DỮ LIỆU LỚN: x/16 PASS`.

### Bước 06 — `06_TONG_HOP_BAO_CAO.bat` (kiểm thử thủ công M01–M12 + báo cáo)

1. Máy bật Web App tại **`http://127.0.0.1:8000`** và mở Edge tại địa chỉ đó.
   Cửa sổ cũng in địa chỉ mạng LAN (ví dụ `http://192.168.1.25:8000`) để làm **M09** từ máy khác.
   Nếu Windows hỏi **cho phép Python qua tường lửa**: chọn **Allow access / Cho phép** (cần cho M09).
2. Nhập họ tên người kiểm thử.
3. Máy hiện lần lượt từng bài **M01 → M12** đúng nguyên văn bảng 4.4 của tài liệu nghiệm thu
   (`docs/EXCEL_DASHBOARD_NGHIEM_THU.md`): **Thao tác** và **Mong đợi**.
   Làm bài đó trên Edge, rồi nhập kết quả:

   | Phím | Ý nghĩa |
   |---|---|
   | `P` | PASS — đúng như mong đợi |
   | `F` | FAIL — máy hỏi **mô tả lỗi (bắt buộc)** |
   | `C` | Chỉ có ở **M09**: PASS kèm cảnh báo HTTP (đúng tiêu chí 4.5) |
   | `B` | Chưa kiểm (bỏ qua lần này) |
   | Enter | Giữ kết quả đã nhập lần trước |

4. **Ảnh chụp lỗi**: bấm `Windows + Shift + S`, chọn vùng, mở **Paint**, `Ctrl + V`, lưu vào
   `C:\nghiemthu\edge\thu_cong\anh\` với tên bắt đầu bằng mã bài, ví dụ `M07_1.png`.
   Báo cáo tự gắn ảnh vào đúng bài.
5. Nhập xong M12: máy tắt Web App, lập báo cáo và **tự mở `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.html`**.

Có thể chạy lại 06 nhiều lần (ví dụ làm M01–M06 hôm nay, M07–M12 hôm sau): nhấn **Enter** để giữ
kết quả cũ, chỉ nhập bài cần cập nhật. File mẫu để upload nằm ở `C:\nghiemthu\edge\mau\`.

---

## 3. Đọc báo cáo nghiệm thu

File `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.html` (mở bằng Edge) gồm:

- **Kết luận** và lý do;
- **Tổng số bài kiểm thử, số PASS, số FAIL, số chưa kiểm** — theo 4 nhóm:
  A. 42 bài giao diện T01–T42 · B. đối chiếu dữ liệu/trình bày file · C. 16 bài dữ liệu lớn · D. 12 bài thủ công M01–M12;
- **Chi tiết từng lỗi** kèm **ảnh chụp màn hình** (bấm vào ảnh để phóng to);
- **Thời gian thực hiện** từng bước 01–06 và từng nhóm kiểm thử tự động;
- Kết quả môi trường (bước 01), kết quả từng bài, danh sách **log**.

| Kết luận | Ý nghĩa |
|---|---|
| **ĐẠT** | Mọi bài PASS (M09 có thể "PASS kèm cảnh báo HTTP"), chạy trên Microsoft Edge, đủ các bước |
| **KHÔNG ĐẠT** | Có ít nhất một bài FAIL |
| **CHƯA ĐỦ ĐIỀU KIỆN KẾT LUẬN** | Không có FAIL nhưng còn bài chưa kiểm, bước chưa chạy, kết quả 05 cũ hơn 04, hoặc không chạy trên Edge |

Bản Markdown `BAO_CAO_NGHIEM_THU.md` và dữ liệu `ket_qua_tong_hop.json` có cùng nội dung.

---

## 4. Thư mục kết quả `C:\nghiemthu\edge`

```
C:\nghiemthu\edge\
├─ BAO_CAO_NGHIEM_THU.html / .md     báo cáo nghiệm thu
├─ ket_qua_tong_hop.json             số liệu tổng hợp
├─ moi_truong.json                   kết quả bước 01
├─ trang_thai_cac_buoc.json          thời gian, mã thoát từng bước
├─ mau\                              6 file Excel mẫu
├─ ket_qua_tu_dong\                  file tải về (Excel/PDF/Word), ảnh loi_*.png, ui_*.png, kết quả 04 + 05
├─ ket_qua_du_lieu_lon\              kết quả kiểm tra dữ liệu lớn
├─ thu_cong\ket_qua_thu_cong.json    kết quả M01–M12;  thu_cong\anh\  ảnh chụp lỗi thủ công
├─ du_lieu_may_chu\, du_lieu_thu_cong\   dữ liệu Web App khi kiểm thử
├─ logs\                             01_...log → 06_...log, may_chu_*.log
└─ lan_chay_truoc\<thời điểm>\       kết quả các lần chạy trước (không bị xoá)
```

Gửi kết quả: chuột phải thư mục `C:\nghiemthu\edge` → **Send to → Compressed (zipped) folder**.

---

## 5. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `[LOI] Khong tim thay Python tren may.` | Cài Python (mục 1.2), nhớ đánh dấu "Add python.exe to PATH", mở lại file BAT |
| Mở BAT hiện "Windows protected your PC" | Bấm **More info → Run anyway**; lần sau nhớ Unblock file ZIP trước khi giải nén (mục 1.1) |
| `[LỖI] Node.js` / `npm` không tìm thấy | Cài Node.js (mục 1.3), mở lại file BAT |
| `[LỖI] Poppler ... không tìm thấy` | Làm mục 1.5, kiểm tra đúng có file `...\Library\bin\pdftotext.exe` |
| `[LỖI] LibreOffice ... không tìm thấy` | Làm mục 1.6 |
| `Cổng 8765/8000 đang bị chương trình khác dùng` | Đóng cửa sổ kiểm thử cũ hoặc Web App đang chạy; hoặc khởi động lại máy |
| `pip install thất bại` / `npm ci thất bại` ở bước 03 | Kiểm tra Internet. Mạng công ty có proxy: hỏi bộ phận IT địa chỉ proxy, chạy trong Command Prompt: `setx HTTPS_PROXY http://proxy.congty:8080` và `npm config set proxy http://proxy.congty:8080` và `npm config set https-proxy http://proxy.congty:8080`, rồi mở lại file 03 |
| `Playwright không mở được trình duyệt` | Cập nhật Edge (`edge://settings/help`), khởi động lại máy, chạy lại 03 |
| Phần mềm diệt virus chặn | Cho phép thư mục `C:\nghiemthu` |
| Muốn làm lại từ đầu | Chạy lại từ bước 04: kết quả cũ tự chuyển vào `lan_chay_truoc\`, không bị xoá |

Khi cần hỗ trợ: gửi thư mục `C:\nghiemthu\edge\logs` (hoặc cả thư mục `C:\nghiemthu\edge` đã nén).

---

## 6. Phạm vi đã kiểm tra trước khi bàn giao (minh bạch)

- Toàn bộ logic của bộ công cụ nằm trong `tools/acceptance/nghiemthu.py`; đã **chạy thật** đủ
  6 bước trên Linux (Chrome 153 thay cho Edge) gồm cả các tình huống lỗi: thiếu Poppler/LibreOffice,
  thiếu Edge, bài kiểm thử FAIL giữa chừng (ảnh chụp lỗi, báo cáo KHÔNG ĐẠT), nhập M01–M12 tương tác,
  Web App cổng 8000 truy cập được qua mạng LAN.
- Các file BAT được kiểm tra tự động (định dạng CRLF, chỉ ký tự ASCII, nhãn `goto`, lệnh gọi,
  ký tự đặc biệt của cmd) nhưng **chưa được chạy trên máy Windows thật** vì môi trường phát triển
  không có Windows. Lần chạy đầu tiên của anh/chị trên Windows là lần kiểm chứng thực tế đầu tiên;
  nếu có lỗi, gửi thư mục `logs` để xử lý.
- Báo cáo **không bao giờ kết luận ĐẠT** nếu kiểm thử tự động không chạy trên Microsoft Edge
  (kênh `msedge`) hoặc còn bài M01–M12 chưa kiểm.
