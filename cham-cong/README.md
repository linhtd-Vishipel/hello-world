# Dashboard chấm công đa Đài Thông tin Duyên hải

Ứng dụng web chấm công theo tháng cho các Đài TTDH: quản lý nhân sự, danh mục mã công, nhập công trên lưới, tổng hợp tự động, nhập/xuất Excel trình ký, khóa tháng, sao lưu/phục hồi và cấu hình nhiều Đài trên cùng một mã nguồn.

Giao diện tiếng Việt. Chạy hoàn toàn trên trình duyệt (chế độ local), không cần máy chủ cơ sở dữ liệu.

## 1. Kiến trúc

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Giao diện | React 18 + TypeScript + Tailwind CSS | Phổ biến, dễ bảo trì, chạy trên máy tính và máy tính bảng |
| Nghiệp vụ | Hàm TypeScript thuần trong `src/domain` | Tách khỏi giao diện, có kiểm thử |
| Lưu trữ | IndexedDB (thư viện `idb`) | Lưu trên máy, không cần cài máy chủ |
| Excel | ExcelJS | Hỗ trợ định dạng ô, viền, gộp ô, công thức, thiết lập in |
| Trạng thái | zustand (vanilla store, `src/state/store.ts`) | Kiểm thử được không cần trình duyệt |
| Kiểm thử | Vitest + fake-indexeddb | Chạy nhanh bằng Node |

```
cham-cong/
├── src/domain/      # Lịch, nhân sự, mã công, tính công, khóa tháng, sao lưu, phân quyền, băm mật khẩu
├── src/excel/       # Xuất Excel (mẫu mặc định + mẫu riêng của Đài), nhập Excel, file mẫu placeholder
├── src/storage/     # Kho IndexedDB, tách dữ liệu theo unitId
├── src/state/       # Bộ điều khiển ứng dụng: quyền, nhật ký, hoàn tác, lưu an toàn, điểm khôi phục
├── src/ui/          # Giao diện React (App + các màn hình trong panels/)
└── tests/           # Kiểm thử bắt buộc (lịch, nhân sự, mã công, tổng hợp, Excel, lưu trữ, đa đơn vị)
```

### Mô hình dữ liệu (rút gọn)

- **Unit** (Đài): mã, tên, cơ quan chủ quản, lịch làm việc (trực ca/hành chính, ngày cuối tuần, ngày lễ), nhóm công, cấu hình mẫu Excel và người ký.
- **Employee**: khóa nội bộ bất biến + mã NV (duy nhất trong đơn vị), họ tên, chức vụ, bộ phận, trạng thái, ngày bắt đầu/kết thúc.
- **AttendanceCode**: mã, tên, nhóm, màu, mô tả quy tắc, trạng thái, danh sách **phiên bản quy tắc theo tháng hiệu lực** (hệ số, có tính tổng công, có là ngày làm việc thực tế).
- **MonthSheet** (`unitId:YYYY-MM`): danh sách dòng, ô chấm công, ghi chú ô, ghi chú dòng, trạng thái khóa + ảnh chụp mã công/tên nhân sự tại thời điểm khóa.
- **AuditEntry**, **User** (mật khẩu băm PBKDF2-SHA256), **Snapshot** (điểm khôi phục).

### Quy tắc nghiệp vụ chính

- Dữ liệu chấm công gắn với khóa nội bộ của nhân sự → đổi tên/mã không mất dữ liệu.
- Không xóa vật lý nhân sự đã có dữ liệu chấm công; chỉ chuyển "Đã nghỉ".
- Thêm/sửa nhân sự: tự cập nhật danh sách dòng của các bảng **chưa khóa** phù hợp thời gian làm việc, hiển thị trước các tháng bị ảnh hưởng.
- Mã công đã dùng không xóa, không đổi ký hiệu; chỉ ngừng sử dụng (dữ liệu cũ giữ nguyên).
- Không tự áp đặt hệ số: mã có thể để "Chưa quy định" và được cảnh báo khi tính tổng.
- Tổng hợp phân biệt: số ngày có ghi mã, ngày làm việc thực tế, tổng công quy đổi, số ngày theo từng mã và từng nhóm.
- Bảng đã khóa: không sửa được; giữ nguyên mã, hệ số, tên nhân sự lúc khóa; chỉ quản trị viên mở khóa (bắt buộc ghi lý do).
- Lịch trực ca: cuối tuần/lễ chỉ tô màu, không mặc định là ngày nghỉ của nhân sự.

## 2. Cài đặt và chạy

Yêu cầu: Node.js 18+ (khuyến nghị 20/22).

```bash
cd cham-cong
npm install
npm run dev        # chạy thử tại http://localhost:5173
npm test           # chạy toàn bộ kiểm thử
npm run build      # đóng gói vào thư mục dist/
npm run preview    # xem bản đóng gói tại http://localhost:4173
```

**Triển khai nội bộ:** sao chép thư mục `dist/` lên bất kỳ máy chủ web tĩnh nào trong mạng nội bộ (IIS, Nginx, Apache…). Không cần cơ sở dữ liệu. Mỗi máy truy cập lưu dữ liệu riêng trong trình duyệt của máy đó.

> Lưu ý: mở trực tiếp file `dist/index.html` bằng `file://` có thể bị trình duyệt chặn module; nên dùng `npm run preview` hoặc máy chủ web.

## 3. Sử dụng nhanh

1. Lần đầu mở: tạo đơn vị (mã, tên Đài, cơ quan chủ quản) hoặc phục hồi từ file sao lưu. Có nút "Tạo dữ liệu mẫu" để thử – đơn vị mẫu được gắn nhãn **DỮ LIỆU MẪU** ở mọi nơi, kể cả file Excel.
2. **Thiết lập đơn vị**: lịch làm việc, ngày lễ, nhóm công, người ký, khổ giấy, mẫu Excel.
3. **Mã công**: thêm mã theo quy chế; "Quy tắc mới" để đổi hệ số từ một tháng hiệu lực.
4. **Nhân sự**: thêm/sửa/ngừng; nhập/xuất Excel.
5. **Bảng chấm công**: chọn tháng → "Tạo bảng chấm công" → nhập mã (gõ trực tiếp, bấm nút mã cho vùng chọn, Ctrl+C/Ctrl+V, Ctrl+Z hoàn tác, ghi chú ô).
6. Kiểm tra thẻ thống kê và "Xem cảnh báo" → "Xuất Excel" → in trình ký → "Khóa tháng".

Hướng dẫn chi tiết có ngay trong ứng dụng (thẻ **Hướng dẫn**).

## 4. Nhập Excel

- **Bảng chấm công**: file có dòng tiêu đề chứa "Mã NV"/"Mã nhân viên" và "Họ và tên", cùng dãy cột ngày 1…28/31. Ứng dụng tự nhận diện, cho xem trước, liệt kê mã NV không tồn tại, mã công không hợp lệ, dòng trùng, ô gộp, tháng không khớp.
  - Phương án: *Nhập thêm* (chỉ ô trống) · *Cập nhật* (ghi đè ô có dữ liệu trong file) · *Thay thế* (thay toàn bộ dòng).
  - Chỉ ghi sau khi xác nhận; nếu có ghi đè, tự tạo điểm khôi phục trước.
  - File xuất từ ứng dụng có thể nhập lại trực tiếp. Ô công thức được đọc theo giá trị kết quả.
- **Danh sách nhân sự**: cột Mã NV, Họ và tên, Chức vụ, Bộ phận, Ngày bắt đầu, Ngày kết thúc (dd/mm/yyyy hoặc yyyy-mm-dd), Trạng thái, Ghi chú.

## 5. Xuất Excel và in trình ký

Nút **Xuất Excel** tải file `Bang_cham_cong_[MaDonVi][YYYY][MM].xlsx` (mẫu tên đổi được trong Thiết lập đơn vị, ví dụ `Bang_cham_cong_{MaDonVi}_{YYYY}_{MM}`).

Nội dung trang "Bang cham cong":
- Cơ quan chủ quản, tên đơn vị, số hiệu mẫu (mặc định "Mẫu số 01a-LĐTL"), tên bảng, tháng/năm.
- Cột STT, Mã NV, Họ tên, Chức vụ, các ngày (số ngày + thứ), tô màu cuối tuần/ngày lễ, ghi chú ô thành comment Excel.
- Cột tổng hợp theo từng mã (công thức `COUNTIF`), Ngày làm việc thực tế, Tổng công quy đổi (công thức theo hệ số của tháng), Ghi chú.
- Dòng ký hiệu, dòng "…, ngày … tháng … năm …", khối ký người lập – người kiểm tra – lãnh đạo.
- Thiết lập in: A4/A3 (tự động theo số cột), hướng ngang, vừa 1 trang chiều ngang, lề hẹp, vùng in, **lặp 3 dòng tiêu đề khi in nhiều trang**, đánh số trang, cố định khung.

Trang "Tong hop" (tùy chọn): số ngày theo mã, theo nhóm, ngày có ghi mã, LVTT, tổng công, ô thiếu, cảnh báo, và bảng quy tắc mã công áp dụng cho tháng.

**Dùng mẫu Excel chính thức của Đài:** Thiết lập đơn vị → "Tải file mẫu có placeholder" → sửa theo biểu mẫu đã phê duyệt (giữ ô `{{BANG_CHAM_CONG}}` ở vị trí góc trên-trái bảng) → "Tải lên mẫu của đơn vị" → Lưu cấu hình. Placeholder hỗ trợ: `{{CO_QUAN_CHU_QUAN}} {{TEN_DON_VI}} {{MA_DON_VI}} {{TIEU_DE}} {{THANG}} {{NAM}} {{SO_NHAN_SU}} {{CHUC_DANH_KY_1..3}} {{TEN_KY_1..3}}`. Nội dung bên dưới ô neo (khối ký, kể cả ô gộp) tự dời xuống sau bảng.

Nút **In** trên ứng dụng in nhanh từ trình duyệt; bản trình ký chính thức nên in từ file Excel.

## 6. Sao lưu và phục hồi

- Dữ liệu nằm trong trình duyệt của **máy hiện tại**. Xóa dữ liệu duyệt web, đổi hồ sơ trình duyệt hoặc hỏng máy có thể mất dữ liệu. Ứng dụng hiển thị cảnh báo này và thời điểm tải file sao lưu gần nhất.
- **Sao lưu**: nút "Sao lưu" (đơn vị hiện tại) hoặc thẻ "Dữ liệu & Sao lưu" (toàn bộ – chỉ quản trị viên). File `.json` là bản sao độc lập; hãy lưu ở ổ đĩa khác/USB/thư mục mạng. Khuyến nghị: hằng tuần và ngay sau khi khóa tháng.
- **Điểm khôi phục** được tạo tự động trước khi nhập Excel có ghi đè, nhập nhân sự có cập nhật, và trước khi phục hồi (giữ 20 bản gần nhất, nằm trên cùng máy).
- **Phục hồi**: chọn file → xem trước (đơn vị, số nhân sự, mã công, bảng) → phục hồi một đơn vị (không ảnh hưởng đơn vị khác) hoặc toàn bộ.

## 7. Triển khai cho Đài mới

- **Cùng máy**: Thiết lập đơn vị → "Nhân bản…" → nhập mã/tên Đài mới → xem trước → Áp dụng. Sao chép mã công, nhóm công, lịch, ngày lễ, mẫu Excel; **không** sao chép chấm công; xóa tên người ký; tùy chọn kèm nhân sự.
- **Khác máy**: máy nguồn "Xuất cấu hình" (mặc định không kèm nhân sự/chấm công) → máy đích "Nhập cấu hình…" → nhập mã/tên mới → xem trước (kiểm tra trùng mã đơn vị, trùng mã công, trùng mã NV) → Áp dụng. Mọi bản ghi được cấp khóa mới.
- Hoặc tạo đơn vị trống ở "Tạo đơn vị" và cấu hình từ đầu.

Không cần sửa mã nguồn cho Đài mới.

## 8. Phân quyền và an toàn

| Vai trò | Quyền |
|---|---|
| Quản trị viên | Toàn quyền: cấu hình đơn vị, mã công, người dùng, mở khóa tháng, phục hồi |
| Người lập chấm công | Nhập/sửa công, quản lý nhân sự, nhập Excel, sao lưu đơn vị |
| Người kiểm tra | Xem, đối chiếu, khóa tháng, xuất báo cáo |
| Người xem | Chỉ đọc, xuất báo cáo |

- Khi chưa có tài khoản: chế độ cục bộ không đăng nhập (quyền quản trị, có banner cảnh báo). Tạo tài khoản quản trị đầu tiên ở thẻ "Người dùng" → từ lần mở sau bắt buộc đăng nhập.
- Mật khẩu băm PBKDF2-SHA256 (120.000 vòng, salt ngẫu nhiên), không lưu văn bản thuần.
- Tài khoản có thể giới hạn theo đơn vị.
- **Giới hạn quan trọng:** ở chế độ local, phân quyền và cách ly đơn vị chỉ có hiệu lực trên giao diện của máy đó (người có quyền truy cập máy vẫn đọc được IndexedDB). Khi nhiều người/nhiều Đài dùng chung dữ liệu qua mạng, cần bổ sung backend có xác thực, phân quyền và tách dữ liệu theo đơn vị ở máy chủ (xem mục 10).

## 9. Kiểm thử

```bash
npm test
```

29 kiểm thử trong `tests/`, bao phủ 20 trường hợp bắt buộc:

| # | Trường hợp | Tệp |
|---|---|---|
| 1–5 | Tháng 2 năm thường/nhuận, tháng 30/31 ngày, chuyển 12 → 1 | `calendar.test.ts` |
| 6–8 | Thêm nhân viên, đổi tên giữ mã, ngừng làm việc | `employees.test.ts` |
| 9 | Thêm và ngừng sử dụng mã công, quy tắc theo hiệu lực | `codes.test.ts` |
| 10–11, 18–19 | Sửa mã một ngày, tổng hợp sau sửa, tháng khóa, phát hiện ô thiếu/mã sai | `sheet.test.ts` |
| 12–14 | Nhập Excel hợp lệ, mã NV không tồn tại, xuất Excel và kiểm tra định dạng/in | `excel.test.ts` |
| 15–17, 20 | Đóng/mở lại dữ liệu, sao lưu/phục hồi, chuyển đơn vị không lẫn dữ liệu, 500 nhân sự | `persistence.test.ts` |

Kiểm thử xuất Excel mở lại file bằng ExcelJS để kiểm tra giá trị, công thức, kết quả, gộp ô, màu, viền, phông, khổ giấy, hướng, vùng in, dòng tiêu đề lặp và khối ký.

## 10. Hạn chế hiện tại

- Chế độ local: dữ liệu mỗi máy độc lập, không đồng bộ tự động giữa các máy (chuyển bằng file sao lưu/cấu hình).
- Chưa có backend nhiều người dùng đồng thời. Khi cần, đề xuất: API (FastAPI/Node) + PostgreSQL, bảng có cột `unit_id` và kiểm tra quyền ở mọi truy vấn, xác thực phiên/JWT; tầng `src/domain` và `src/excel` dùng lại được.
- Nhập Excel đọc trang tính đầu tiên nhận diện được và giá trị kết quả của công thức; không giữ lại công thức của file nguồn.
- Mỗi ô chứa một mã công (nửa ngày dùng mã riêng, ví dụ `X/2` với hệ số 0,5).
- Lễ âm lịch cần khai báo thủ công hằng năm.

## 11. Cập nhật phiên bản

1. Sao lưu toàn bộ (thẻ "Dữ liệu & Sao lưu") trước khi cập nhật.
2. Lấy mã nguồn mới, chạy `npm install && npm test && npm run build`.
3. Thay thư mục `dist/` trên máy chủ web. Dữ liệu IndexedDB giữ nguyên vì cùng địa chỉ trang.
4. Nếu có sự cố, phục hồi từ file sao lưu.
