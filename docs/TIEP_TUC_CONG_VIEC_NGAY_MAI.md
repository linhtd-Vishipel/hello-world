# Tiếp tục công việc — ngày 19/11/2026

Đọc trước: [BIEN_BAN_LAM_VIEC.md](BIEN_BAN_LAM_VIEC.md) (tiến độ 18/11). Không cần làm lại từ đầu:
môi trường ảo `C:\nghiemthu\cong_cu\venv`, dữ liệu mẫu và kết quả 01–05 được giữ nguyên.

**Câu lệnh đầu tiên** (trên Windows, Command Prompt) — kiểm tra đúng bản mã nguồn trước khi làm gì khác:

```bat
py -3 "C:\Nghiệm thu_mới\tools\acceptance\nghiemthu.py" kiem-tra
```

Sau khi tải lại mã nguồn (bước 1), dòng cuối báo cáo bước 06 phải in dấu vân tay **`8f20a1d16f9d`**.
Kiểm tra nhanh bản mã nguồn: thư mục `tools\acceptance\windows\` phải có file `M02_DOI_CHIEU_EXCEL.bat`.

## Thứ tự công việc

### 1. Hoàn thiện điều chỉnh M02 (lấy bản mới)
- Tải lại nhánh `claude/excel-upload-dashboard-app-xfssug` (GitHub → Code → Download ZIP, hoặc `git pull`)
  vào `C:\Nghiệm thu_mới` (chuột phải ZIP → Properties → Unblock trước khi giải nén).
- **Không xoá** `C:\nghiemthu\edge` và `C:\nghiemthu\cong_cu`: kết quả cũ và môi trường ảo dùng lại được.
- Phần mã M02 đã xong (commit `9764e2b`); nếu kết quả trên file thật có FAIL thì gửi
  `C:\nghiemthu\edge\thu_cong\m02_doi_chieu_excel.md` để phân tích và chỉnh tiếp.

### 2. Kiểm thử lại M02 trên Windows
1. Bấm đúp `06_TONG_HOP_BAO_CAO.bat` (Edge tự mở `http://127.0.0.1:8000`). Nhập họ tên; M01 bấm Enter để giữ kết quả.
2. Upload **"Phụ lục 2 Bảng tổng hợp đánh giá chất lượng 2.2024"**, xuất 2 file Excel:
   (a) Phạm vi Excel = **"Toàn bộ dữ liệu mọi sheet (không lọc)"**;
   (b) sheet đang xem, **không lọc, không sắp xếp**, có bảng thống kê.
3. Tới M02 bấm **Enter** để chạy đối chiếu tự động: kéo-thả file nguồn → Enter; gõ số của 2 file xuất (ví dụ `1,2`) → Enter → Enter.
   (Chạy riêng bất kỳ lúc nào: bấm đúp `C:\Nghiệm thu_mới\tools\acceptance\windows\M02_DOI_CHIEU_EXCEL.bat`.)
4. Mở 2 file bằng Microsoft Excel: không báo sửa chữa; tiếng Việt đúng; nút lọc; hàng tiêu đề cố định khi cuộn;
   biểu đồ sheet `TK..` bấm vào hiện Chart Design; ngày dd/mm/yyyy.
5. Nhập **P** chỉ khi đối chiếu tự động 0 FAIL và kiểm bằng mắt đạt (máy không cho nhập P nếu còn FAIL).

### 3. Tiếp tục M03–M12
Làm tiếp trong cùng cửa sổ bước 06, theo nội dung máy hiện (nguyên văn mục 4.4 `docs/EXCEL_DASHBOARD_NGHIEM_THU.md`).
M03–M06, M10 dùng file mẫu `C:\nghiemthu\edge\mau\SoTheoDoi_DoanhThu_2026.xlsx` (M10: `DaiTrungBinh_25000.xlsx`;
M07, M12: `RatLon_200000.xlsx`). M09 làm từ máy khác trong LAN theo địa chỉ cửa sổ in ra. Ảnh lỗi:
`C:\nghiemthu\edge\thu_cong\anh\M07_1.png`… Xong M12, báo cáo tự mở.

### 4. Hoàn thành báo cáo G1–G6
Vì mã nguồn đổi (dấu vân tay mới), chạy lại trên bản mới để báo cáo hợp lệ (G5):
`04_KIEM_THU_EDGE.bat` → `05_DOI_CHIEU_KET_QUA.bat` → `06_TONG_HOP_BAO_CAO.bat` (Enter để giữ kết quả M01–M12 đã nhập).
Không cần chạy lại 01–03 nếu 01 báo ĐẠT. Gửi lại (file nhỏ, tải lên được):
- `C:\nghiemthu\edge\ket_qua_tong_hop.json` (bắt buộc)
- `C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.md`
- `C:\nghiemthu\edge\thu_cong\m02_doi_chieu_excel.md`

ZIP gọn (nếu cần), PowerShell:
```powershell
Compress-Archive -Force -DestinationPath C:\nghiemthu\bao_cao_gon.zip -Path `
  C:\nghiemthu\edge\ket_qua_tong_hop.json, C:\nghiemthu\edge\BAO_CAO_NGHIEM_THU.md, `
  C:\nghiemthu\edge\moi_truong.json, C:\nghiemthu\edge\thu_cong\m02_doi_chieu_excel.md
```

| Mã | Điều kiện | Trường trong `ket_qua_tong_hop.json` |
|---|---|---|
| G1 | Kết luận ĐẠT | `ket_luan = "ĐẠT"` |
| G2 | 0 FAIL, 0 CHƯA KIỂM THỬ (SKIP ghi riêng) | `fail = 0`, `chua = 0`, `skip` |
| G3 | Microsoft Edge kênh msedge | `trinh_duyet.launch.channel = "msedge"` |
| G4 | Windows 10/11, không lỗi môi trường | `he_dieu_hanh`, `loi_moi_truong = []` |
| G5 | Đúng bản bàn giao | `dau_van_tay` bắt đầu bằng `8f20a1d16f9d` |
| G6 | M01–M05 PASS (M02 kèm đối chiếu tự động 0 FAIL) | nhóm D |

### 5. Đối chiếu dấu vân tay mã nguồn
Phía phát triển (máy có mã nguồn):
```bash
cd tools/acceptance && python3 -c "import nghiemthu as n; print(n.source_fingerprint())"
# mong đợi: ('8f20a1d16f9d', 37)
```
So với mục "Dấu vân tay mã nguồn" trong `BAO_CAO_NGHIEM_THU.md` từ Windows.

### 6. Kiểm tra CI và Pull Request #10
- https://github.com/linhtd-Vishipel/hello-world/pull/10 — check `test` phải đạt trên commit mới nhất, không xung đột.
- Phía phát triển: `git fetch origin && git diff --stat origin/main...origin/claude/excel-upload-dashboard-app-xfssug`
- Kiểm thử cục bộ như CI: `python -m pytest -q` (mong đợi 178 passed).

### 7. Merge
**Chỉ merge PR #10 vào `main` khi G1–G6 đạt, CI đạt, không xung đột, và người có thẩm quyền đồng ý (G7–G8).**
Sau merge: xác nhận commit mới nhất của `main` và CI trên `main`.

## Lưu ý
- Không xoá dữ liệu gốc, không ghi đè file người dùng; kết quả cũ tự chuyển vào `C:\nghiemthu\edge\lan_chay_truoc\`.
- Poppler/LibreOffice **không cần cài**; SKIP không tính là PASS.
- Không tuyên bố nghiệm thu Windows đạt khi chưa có `ket_qua_tong_hop.json`.
