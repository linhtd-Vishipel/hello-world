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
| 01 | `01_KIEM_TRA_MOI_TRUONG.bat` | Kiểm tra Python ≥ 3.11, Node.js ≥ 20, Edge, thư viện, cổng mạng, ổ đĩa (Poppler/LibreOffice: tùy chọn, không có thì SKIP) | ~10 giây |
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

Về đường dẫn:

- Thư mục mã nguồn **được phép có dấu cách hoặc dấu tiếng Việt**, nhưng nên **ngắn** (ví dụ `C:\nghiemthu\ma_nguon`).
  Đường dẫn quá dài (như thư mục Downloads lồng nhiều cấp) có thể vượt giới hạn 260 ký tự của Windows
  khi cài thư viện; bước 01 sẽ cảnh báo.
- Thư mục kết quả `C:\nghiemthu\edge` **nên không có dấu tiếng Việt** (tránh lỗi với công cụ bên ngoài);
  bước 01 báo CẢNH BÁO nếu có dấu. Tên tài khoản Windows có dấu (ví dụ `C:\Users\Hùng`) không ảnh hưởng.
- Không chạy từ ổ mạng (`\\may-chu\...`): chép mã nguồn về ổ đĩa của máy.

### 1.2 Cài Python 3.12 hoặc 3.13 (khuyến nghị)

Bộ công cụ **chỉ chấp nhận Python 3.11 trở lên** và đã chạy thử với 3.13. File BAT thử lần lượt
`py -3.13` → `py -3.12` → `py -3.11` → `py -3` (bản Python 3 mới nhất) → `python` → `python3`;
mỗi lựa chọn đều được chạy thử **và kiểm tra phiên bản** — bản cũ hơn 3.11 (ví dụ 3.10) bị bỏ qua và máy
tìm tiếp lựa chọn sau. Phiên bản quá mới có thể chưa có sẵn gói cài đặt cho thư viện (bước 01 sẽ cảnh báo);
khi đó cài thêm Python 3.13.

1. Mở `https://www.python.org/downloads/windows/`, chọn bản **Python 3.13.x** (hoặc 3.12.x), tải **Windows installer (64-bit)**.
2. Chạy file cài, **đánh dấu ô "Add python.exe to PATH"** ở màn hình đầu, rồi bấm **Install Now**.
3. Kiểm tra: mở Command Prompt **mới**, gõ `py -3 --version` → hiện `Python 3.1x.x`.

### 1.3 Cài Node.js bản LTS (20 trở lên)

1. Mở `https://nodejs.org/`, tải bản **LTS** (file `.msi`).
2. Cài với các lựa chọn mặc định.
3. Kiểm tra: Command Prompt mới, gõ `node --version` → hiện `v20...` hoặc mới hơn.

### 1.4 Microsoft Edge

Edge có sẵn trên Windows 10/11. Mở Edge, vào địa chỉ `edge://settings/help` để cập nhật bản mới nhất.

### 1.5 Poppler và LibreOffice — KHÔNG bắt buộc, KHÔNG cần cài

Bộ nghiệm thu **không yêu cầu, không tự tải và không tự cài** Poppler hay LibreOffice. Các file xuất được
kiểm tra bằng thư viện đã có trong bộ công cụ:

| File | Công cụ kiểm tra (bắt buộc, có sẵn) | Nội dung kiểm tra |
|---|---|---|
| Excel (.xlsx) | `openpyxl` + đọc gói ZIP/XML | mở được, gói ZIP/XML hợp lệ, tên sheet, số dòng/cột, tiêu đề cột, định dạng số và ngày tháng, tổng cộng so với Dashboard, dữ liệu sau xuất == file gốc |
| PDF | `pdfcheck.py` (thư viện chuẩn Python) | file tồn tại, dung lượng, header/cấu trúc PDF, số trang, khổ A4, trích xuất chữ, tiếng Việt, trang trắng, tiêu đề mồ côi cuối trang, chữ tràn lề, số trang "Trang i/n", font nhúng, ảnh biểu đồ |
| Word (.docx) | `python-docx` + đọc gói ZIP/XML | mở được, ZIP/XML hợp lệ, liên kết nội bộ, tiêu đề, nội dung, bảng vừa khổ giấy, dòng tiêu đề bảng lặp lại, độ rộng cột tối thiểu, font, tiếng Việt, số liệu thống kê == Dashboard, không thiếu mục |

Nếu máy **đã có sẵn** Poppler hoặc LibreOffice, bộ công cụ dùng thêm để đối chiếu chéo (so chữ PDF với
`pdftotext`; dựng trang thử file Word). Nếu không có, các mục đó ghi **SKIP**:

- **SKIP không bao giờ được tính là PASS** và được ghi riêng một cột trong báo cáo;
- SKIP không làm bước 01 hay kết luận bị LỖI, vì phép kiểm tra bắt buộc tương ứng đã chạy bằng thư viện có sẵn;
- Việc dựng trang thực tế của file Word (ngắt trang, trình bày) không kiểm tra tự động được khi không có
  LibreOffice — nội dung này do bài thủ công **M04** (mở bằng Microsoft Word) đảm nhận, vẫn bắt buộc.

Trạng thái trong báo cáo: **PASS** (đạt), **FAIL** (lỗi thật), **SKIP** (công cụ tùy chọn không có),
**CHƯA KIỂM THỬ** (NOT TESTED — bài chưa chạy; còn bài này thì kết luận luôn là KHÔNG ĐẠT).

### 1.6 Dung lượng ổ đĩa

| Thành phần | Dung lượng (đo thực tế) | Ghi chú |
|---|---|---|
| Môi trường ảo Python `C:\nghiemthu\cong_cu\venv` | ~120 MB | tạo **một lần**, các lần chạy sau dùng lại; cài bằng `pip --no-cache-dir` (không lưu bộ nhớ đệm) |
| `node_modules` (Playwright) trong thư mục mã nguồn | ~19 MB | **không** tải trình duyệt — dùng Edge có sẵn |
| Kết quả `C:\nghiemthu\edge` (mẫu + 1 lần chạy) | ~100 MB | lần chạy cũ được chuyển vào `lan_chay_truoc\`, **không tự xoá** — anh/chị tự xoá khi không cần |

Bước 01 yêu cầu trống ≥ 3 GB (≥ 2 GB nếu đã cài xong bước 03); bước 02 và 05 kiểm tra lại dung lượng trống
trước khi tạo/xử lý dữ liệu lớn (200.000 dòng) và dừng lại nếu không đủ.

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

Cài thư viện cho Web App và bộ kiểm thử (vào môi trường riêng `C:\nghiemthu\cong_cu\venv`, không ảnh hưởng
Python của máy), cài Playwright bằng `npm ci`, sau đó **mở thử Microsoft Edge** bằng Playwright.
Đạt khi có dòng bắt đầu bằng `OK <phiên bản Edge>` và dòng `KẾT LUẬN: ĐẠT`. Chạy lại 01 để xác nhận mọi mục `[ OK ]`.

Chỉ khi bước 03 thành công trọn vẹn, máy mới ghi nhận `C:\nghiemthu\edge\cai_dat_thanh_cong.json`.
**Bước 04 và 05 từ chối chạy** nếu chưa có ghi nhận này (ví dụ `pip`/`npm ci` lỗi, hoặc không mở được Edge).

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
   | `B` | Chưa kiểm thử (bỏ qua lần này) — báo cáo ghi **CHƯA KIỂM THỬ** |
   | Enter | Giữ kết quả đã nhập lần trước |

4. **Ảnh chụp lỗi**: bấm `Windows + Shift + S`, chọn vùng, mở **Paint**, `Ctrl + V`, lưu vào
   `C:\nghiemthu\edge\thu_cong\anh\` với tên bắt đầu bằng mã bài, ví dụ `M07_1.png`.
   Báo cáo tự gắn ảnh vào đúng bài.
5. Nhập xong M12: máy tắt Web App, lập báo cáo và **tự mở `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.html`**.

Có thể chạy lại 06 nhiều lần (ví dụ làm M01–M06 hôm nay, M07–M12 hôm sau): nhấn **Enter** để giữ
kết quả cũ, chỉ nhập bài cần cập nhật. File mẫu để upload nằm ở `C:\nghiemthu\edge\mau\`.

### M02 — đối chiếu file Excel xuất với file Excel thực tế

M02 **không dùng số dòng cố định**: số sheet, số dòng, số cột, tên cột đều lấy từ chính file nguồn, nên dùng được
cho mọi báo cáo (ví dụ "Phụ lục 2 Bảng tổng hợp đánh giá chất lượng 2.2024", sheet lớn nhất khoảng 26 dòng).

1. Trên Edge (`http://127.0.0.1:8000`), upload **file Excel thực tế** cần nghiệm thu.
2. Xuất **2 file Excel**:
   - (a) mục **Phạm vi Excel** chọn **"Toàn bộ dữ liệu mọi sheet (không lọc)"** → bấm 📊 Xuất Excel;
   - (b) mục **Phạm vi Excel** chọn lại sheet đang xem, **không lọc, không sắp xếp**, có bảng thống kê → bấm 📊 Xuất Excel.
3. Chạy đối chiếu tự động — tới M02 ở bước 06 máy hỏi "Chạy đối chiếu tự động M02 ngay?", bấm **Enter**
   (hoặc chạy riêng **`M02_DOI_CHIEU_EXCEL.bat`** bất kỳ lúc nào):
   - **File nguồn** (.xlsx/.xlsm/.xls/.csv): kéo-thả file Excel thực tế vào cửa sổ, hoặc gõ/dán đường dẫn, bấm Enter.
     Máy in lại tên và đường dẫn file đã nhận.
   - **File xuất** (.xlsx): máy liệt kê các file `BaoCao_*.xlsx` mới nhất trong **thư mục tải xuống thật của Edge**
     (kể cả ổ khác, ví dụ `E:\Downloads`) và thư mục của file nguồn. Chọn bằng một trong các cách:
     - gõ số thứ tự: `1` hoặc `1,2` hoặc `1 2`;
     - kéo-thả hoặc dán **từng** file, mỗi lần một dòng, Enter;
     - dán nhiều đường dẫn trên một dòng (cách nhau dấu cách, dấu phẩy, chấm phẩy; có hoặc không có ngoặc kép).
     Máy in "→ Nhận file xuất 1: …" cho từng file. Bấm Enter trên dòng trống để bắt đầu đối chiếu.
   - File bị từ chối luôn kèm **lý do cụ thể**: không tìm thấy (kèm thư mục và file gần giống), sai định dạng
     (.xls/.csv là file nguồn), là thư mục, trùng file nguồn, không đọc được (đang mở trong Excel), nội dung không phải
     .xlsx. Ký tự vô hình khi chép đường dẫn (ví dụ từ hộp thoại Properties) được tự loại bỏ.
4. Máy chỉ **đọc** file (không sửa file nguồn, không thêm dữ liệu) và kiểm tra cho **từng sheet**:

   | Nội dung | Cách kiểm |
   |---|---|
   | Đúng tên và thứ tự sheet | theo quy tắc đặt tên của Web App (`Tổng quan`, `TK..`, `DL <tên sheet>` / `Dữ liệu chi tiết`) |
   | Đúng số dòng thực tế | bằng số dòng dữ liệu của sheet nguồn sau quy tắc xử lý (bỏ dòng tiêu đề, dòng/cột trống, dòng "Tổng cộng") |
   | Không mất, không nhân đôi, không thêm dòng | so khớp từng dòng; thêm đối chiếu thô với file nguồn không qua quy tắc xử lý |
   | Không đổi thứ tự, nội dung | so từng ô với file nguồn |
   | Tiêu đề, bộ lọc, cố định hàng tiêu đề | hàng tiêu đề in đậm, AutoFilter, Freeze Panes |
   | Biểu đồ sửa được | biểu đồ Excel thật, dữ liệu lấy từ ô của sheet (không phải ảnh) |
   | Ngày dd/mm/yyyy | định dạng ô và giá trị ngày thật; **SKIP** nếu file không có cột ngày |

   Kết quả lưu ở `C:\nghiemthu\edge\thu_cong\m02_doi_chieu_excel.md` (và `.json`).
5. Mở 2 file xuất bằng **Microsoft Excel**, kiểm bằng mắt: không có thông báo sửa chữa file; tiếng Việt đúng;
   nút lọc hoạt động; cuộn xuống hàng tiêu đề vẫn đứng yên; bấm vào biểu đồ ở sheet `TK..` → hiện thẻ **Chart Design**
   (sửa được); cột ngày hiển thị `dd/mm/yyyy`.
6. Nhập kết quả M02: **P** chỉ được chấp nhận khi đối chiếu tự động đã chạy và **0 FAIL**; nếu chưa chạy hoặc còn
   FAIL, máy chỉ cho nhập F hoặc B. SKIP (không áp dụng) không được tính là PASS.

---

## 3. Đọc báo cáo nghiệm thu

File `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.html` (mở bằng Edge) gồm:

- **Kết luận ĐẠT hoặc KHÔNG ĐẠT** và lý do;
- **Tổng số bài kiểm thử, số PASS, số FAIL, số CHƯA KIỂM THỬ** — theo 4 nhóm:
  A. 42 bài giao diện T01–T42 · B. đối chiếu dữ liệu/trình bày file · C. 16 bài dữ liệu lớn · D. 12 bài thủ công M01–M12;
- **6 bước thực hiện** 01–06: trạng thái (ĐẠT / CÓ LỖI / CHƯA CHẠY), giờ bắt đầu, kết thúc, thời gian, mã thoát;
- **Lỗi môi trường** (bước 01), nếu có;
- **Chi tiết từng lỗi** kèm **ảnh chụp màn hình** (bấm vào ảnh để phóng to);
- **Thời gian** từng nhóm kiểm thử tự động; kết quả từng bài;
- **Vị trí lưu log và ảnh** (đường dẫn đầy đủ) và danh sách **log**.

Bài nào chưa thực hiện được ghi **CHƯA KIỂM THỬ** (nếu bước 04 chưa chạy, báo cáo vẫn liệt kê đủ T01–T42 với
trạng thái này). Không có bài nào được ghi PASS nếu chưa thực sự chạy.

| Kết luận | Ý nghĩa |
|---|---|
| **ĐẠT** | Mọi bài PASS (M09 có thể "PASS kèm cảnh báo HTTP"), chạy trên Microsoft Edge, đủ các bước, không còn bài CHƯA KIỂM THỬ, không có lỗi môi trường |
| **KHÔNG ĐẠT — CÓ BÀI FAIL / LỖI** | Có ít nhất một bài FAIL, hoặc bước 01 còn lỗi môi trường |
| **KHÔNG ĐẠT — CHƯA ĐỦ ĐIỀU KIỆN** | Không có FAIL nhưng còn bài CHƯA KIỂM THỬ, bước chưa chạy, kết quả 05 cũ hơn 04, hoặc không chạy trên Edge |

Bản Markdown `BAO_CAO_NGHIEM_THU.md` và dữ liệu `ket_qua_tong_hop.json` có cùng nội dung.

---

## 4. Thư mục kết quả `C:\nghiemthu\edge`

```
C:\nghiemthu\edge\
├─ BAO_CAO_NGHIEM_THU.html / .md     báo cáo nghiệm thu
├─ ket_qua_tong_hop.json             số liệu tổng hợp
├─ moi_truong.json                   kết quả bước 01
├─ trang_thai_cac_buoc.json          thời gian, mã thoát từng bước
├─ cai_dat_thanh_cong.json           ghi nhận bước 03 đạt (điều kiện để chạy 04, 05)
├─ mau\                              6 file Excel mẫu
├─ ket_qua_tu_dong\                  file tải về (Excel/PDF/Word), ảnh loi_*.png, ui_*.png, kết quả 04 + 05
├─ ket_qua_du_lieu_lon\              kết quả kiểm tra dữ liệu lớn
├─ thu_cong\ket_qua_thu_cong.json    kết quả M01–M12;  thu_cong\anh\  ảnh chụp lỗi thủ công
├─ thu_cong\m02_doi_chieu_excel.md   kết quả đối chiếu tự động M02 (file Excel xuất ↔ file nguồn)
├─ du_lieu_may_chu\, du_lieu_thu_cong\   dữ liệu Web App khi kiểm thử
├─ logs\                             01_...log → 06_...log, may_chu_*.log
└─ lan_chay_truoc\<thời điểm>\       kết quả, mẫu, báo cáo, kết quả M01–M12 các lần trước (không bị xoá)
```

**An toàn dữ liệu:** bộ công cụ không xoá và không ghi đè dữ liệu. Trước khi tạo lại dữ liệu mẫu (02),
chạy lại kiểm thử (04, 05), cập nhật kết quả M01–M12 hay lập lại báo cáo (06), bản cũ được chuyển/sao lưu vào
`lan_chay_truoc\<thời điểm>\`. Bộ công cụ không sửa mã nguồn Web App, không ghi `__pycache__` vào thư mục mã nguồn,
không chạy lệnh Git nào ngoài việc đọc mã commit để ghi vào báo cáo.

### Mã thoát của file BAT

Mỗi file BAT in `ma thoat` khi chưa đạt và trả đúng mã thoát của chương trình bên trong:

| Mã | Ý nghĩa |
|---|---|
| 0 | Bước đạt |
| 1 | Có bài FAIL, thiếu điều kiện, hoặc lỗi được mô tả trong cửa sổ/log |
| 2 | Không mở được trình duyệt / dừng bất thường (bước 04), hoặc thiếu file `nghiemthu.py` |
| 124 | Một lệnh chạy quá thời gian cho phép và đã bị dừng |
| 127 | Không chạy được một chương trình cần thiết |
| 130 | Người dùng bấm Ctrl+C |
| 9009 | Không tìm thấy Python |

### Biến môi trường (chỉ dùng khi cần thay đổi mặc định)

Đặt bằng lệnh `setx TEN_BIEN "gia tri"` trong Command Prompt, rồi **mở lại** file BAT:

| Biến | Mặc định | Dùng khi |
|---|---|---|
| `NGHIEMTHU_DIR` | `C:\nghiemthu\edge` | Muốn lưu kết quả ở thư mục khác (không dấu tiếng Việt) |
| `NGHIEMTHU_CONG_CU` | `C:\nghiemthu\cong_cu` | Muốn đặt môi trường Python riêng ở nơi khác |
| `NGHIEMTHU_PORT` | `8765` | Cổng 8765 bị chương trình khác chiếm (cổng 8000 của bước 06 cố định theo tài liệu M07/M09) |
| `POPPLER_BIN` | tự tìm | (Tùy chọn) Máy đã có Poppler ở thư mục lạ, muốn dùng thêm để đối chiếu chéo |
| `NGHIEMTHU_SOFFICE` | tự tìm | (Tùy chọn) Máy đã có LibreOffice ở thư mục lạ, muốn dùng thêm để dựng trang Word |

Gửi kết quả: chuột phải thư mục `C:\nghiemthu\edge` → **Send to → Compressed (zipped) folder**.

---

## 5. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `[LOI] Khong tim thay Python tren may.` | Cài Python (mục 1.2), nhớ đánh dấu "Add python.exe to PATH", mở lại file BAT |
| `[LOI] Chi tim thay Python cu hon 3.11: ...` | Máy chỉ có Python cũ (ví dụ 3.9, 3.10). Cài thêm Python 3.12 hoặc 3.13 (mục 1.2) — không cần gỡ bản cũ — rồi mở lại file BAT |
| Mở BAT hiện "Windows protected your PC" | Bấm **More info → Run anyway**; lần sau nhớ Unblock file ZIP trước khi giải nén (mục 1.1) |
| `[LỖI] Node.js` / `npm` không tìm thấy | Cài Node.js (mục 1.3), mở lại file BAT |
| `[SKIP] Poppler` / `[SKIP] LibreOffice` ở bước 01 | Bình thường — công cụ tùy chọn, **không cần cài** (mục 1.5) |
| `Ổ đĩa chỉ còn trống ... GB` | Giải phóng ổ đĩa (không xoá dữ liệu gốc) hoặc đặt `NGHIEMTHU_DIR` sang ổ khác, rồi chạy lại bước đó |
| `Cổng 8765/8000 đang bị chương trình khác dùng` | Đóng cửa sổ kiểm thử cũ hoặc Web App đang chạy; hoặc khởi động lại máy |
| `pip install thất bại` / `npm ci thất bại` ở bước 03 | Kiểm tra Internet. Mạng công ty có proxy: hỏi bộ phận IT địa chỉ proxy, chạy trong Command Prompt: `setx HTTPS_PROXY http://proxy.congty:8080` và `npm config set proxy http://proxy.congty:8080` và `npm config set https-proxy http://proxy.congty:8080`, rồi mở lại file 03 |
| `Playwright không mở được trình duyệt` | Cập nhật Edge (`edge://settings/help`), khởi động lại máy, chạy lại 03 |
| Phần mềm diệt virus chặn | Cho phép thư mục `C:\nghiemthu` |
| Muốn làm lại từ đầu | Chạy lại từ bước 04: kết quả cũ tự chuyển vào `lan_chay_truoc\`, không bị xoá |

Khi cần hỗ trợ: gửi thư mục `C:\nghiemthu\edge\logs` (hoặc cả thư mục `C:\nghiemthu\edge` đã nén).

---

## 6. Phạm vi đã kiểm tra trước khi bàn giao (minh bạch)

- Toàn bộ logic của bộ công cụ nằm trong `tools/acceptance/nghiemthu.py`; đã **chạy thật** đủ
  6 bước trên Linux (Chrome 153 thay cho Edge) gồm cả các tình huống lỗi; máy không có
  Poppler/LibreOffice (bước 01 ĐẠT, các mục phụ ghi SKIP),
  thiếu Edge, bài kiểm thử FAIL giữa chừng (ảnh chụp lỗi, báo cáo KHÔNG ĐẠT), nhập M01–M12 tương tác,
  Web App cổng 8000 truy cập được qua mạng LAN.
- Các file BAT được kiểm tra tự động (định dạng CRLF, chỉ ký tự ASCII, nhãn `goto`, lệnh gọi,
  ký tự đặc biệt của cmd) nhưng **chưa được chạy trên máy Windows thật** vì môi trường phát triển
  không có Windows. Lần chạy đầu tiên của anh/chị trên Windows là lần kiểm chứng thực tế đầu tiên;
  nếu có lỗi, gửi thư mục `logs` để xử lý.
- Báo cáo **không bao giờ kết luận ĐẠT** nếu kiểm thử tự động không chạy trên Microsoft Edge
  (kênh `msedge`) hoặc còn bài CHƯA KIỂM THỬ.
