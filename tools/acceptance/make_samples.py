"""Generate realistic Excel files for the export acceptance test.

    python tools/acceptance/make_samples.py <out_dir> [--big-rows 200000]

Files (fixed random seed, so totals are reproducible):
  SoTheoDoi_DoanhThu_2026.xlsx  title rows, merged cells, "Tổng cộng" row, 1,200 rows
                                + sheet "Danh mục thiết bị" with 18 columns
  NganGon_3Dong.xlsx            3 data rows (short report)
  QuyTac_Gia.xlsx               columns containing "Giá"/"gia" (aggregation-rule check)
  RatRong_40Cot.xlsx            40 columns, long text and long unbroken codes (layout)
  DaiTrungBinh_25000.xlsx       25,000 rows (PDF limit 20,000 / Word limit 5,000)
  RatLon_<n>.xlsx               --big-rows rows (default 200,000; parser maximum)
"""
import argparse
import random
from datetime import datetime, timedelta
from pathlib import Path

import openpyxl
from openpyxl.styles import Font

BRANCHES = ["Cà Mau", "Bạc Liêu", "Kiên Giang", "Sóc Trăng", "Hậu Giang", "Phú Quốc"]
SERVICES = ["Lắp đặt VHF/DSC", "Bảo trì AIS", "Sửa chữa MF/HF", "Camera IP", "Mạng nội bộ",
            "Tư vấn kỹ thuật", "Cấp nguồn & máy phát"]
CUSTOMERS = ["Tàu cá CM-90123-TS", "Tàu Vifish 24", "Công ty TNHH Hải Âu", "HTX Nghề cá Sông Đốc",
             "Cảng cá Rạch Gốc", "Đồn Biên phòng Gành Hào", "Tàu KG-91234-TS", "Tàu BL-97777-TS"]
D0 = datetime(2026, 1, 1)


def revenue_rows(rng, n):
    for i in range(1, n + 1):
        q = rng.randint(1, 12)
        p = rng.choice([350000, 750000, 1250000, 2800000, 4500000])
        ck = rng.choice([0, 0, 0.05, 0.1])
        yield [i, D0 + timedelta(days=rng.randint(0, 318), hours=rng.choice([0, 0, 8, 14])),
               rng.choice(BRANCHES), rng.choice(SERVICES), rng.choice(CUSTOMERS), q, p, ck, round(q * p * (1 - ck))]


REVENUE_HEADER = ["STT", "Ngày hoá đơn", "Chi nhánh", "Dịch vụ", "Khách hàng", "Số lượng", "Đơn giá",
                  "Tỷ lệ chiết khấu", "Thành tiền"]


def revenue_book(path, n, seed, with_equipment=True, write_only=False):
    rng = random.Random(seed)
    wb = openpyxl.Workbook(write_only=write_only)
    ws = wb.create_sheet("Doanh thu 2026") if write_only else wb.active
    if not write_only:
        ws.title = "Doanh thu 2026"
    ws.append(["ĐÀI THÔNG TIN DUYÊN HẢI CÀ MAU"])
    ws.append(["SỔ THEO DÕI DOANH THU DỊCH VỤ KỸ THUẬT NĂM 2026"])
    ws.append([])
    ws.append(REVENUE_HEADER)
    total = 0
    for row in revenue_rows(rng, n):
        total += row[8]
        ws.append(row)
    ws.append(["Tổng cộng", None, None, None, None, None, None, None, total])
    if not write_only:
        ws.merge_cells("A2:I2")
        ws["A2"].font = Font(bold=True, size=14)
        for c in ws["B"][4:]:
            c.number_format = "dd/mm/yyyy hh:mm"
        for c in ws["H"][4:]:
            c.number_format = "0%"
    if with_equipment:
        equipment_sheet(wb.create_sheet("Danh mục thiết bị"), rng)
    wb.save(path)


def equipment_sheet(ws, rng):
    ws.append(["Mã thiết bị", "Tên thiết bị", "Loại", "Hãng sản xuất", "Model", "Số serial", "Vị trí lắp đặt",
               "Trạm", "Ngày lắp đặt", "Ngày bảo trì gần nhất", "Trạng thái", "Công suất (W)", "Tần số (MHz)",
               "Giờ hoạt động", "Giá trị tài sản", "Người phụ trách", "Ghi chú", "Mức ưu tiên"])
    for i in range(1, 181):
        ws.append([
            f"TB-{i:04d}", rng.choice(["Máy thu phát VHF", "Bộ AIS lớp A", "Máy phát MF/HF", "Camera PTZ",
                                       "Switch Layer 3", "Máy phát điện 30kVA", "UPS 10kVA"]),
            rng.choice(["Thông tin", "Nguồn", "Mạng", "Giám sát"]),
            rng.choice(["Icom", "Furuno", "JRC", "Hikvision", "Cisco", "Cummins", "APC"]),
            f"M-{rng.randint(100, 999)}", f"SN{rng.randint(10**7, 10**8)}",
            rng.choice(["Phòng máy tầng 2", "Cột anten 60m", "Nhà trạm", "Phòng điều hành"]),
            rng.choice(["Cà Mau", "Sông Đốc", "Hòn Khoai"]),
            D0 - timedelta(days=rng.randint(100, 3000)), D0 + timedelta(days=rng.randint(0, 300)),
            rng.choice(["Hoạt động tốt", "Cần bảo trì", "Hỏng chờ sửa"]),
            rng.choice([25, 50, 100, 400, 1000, 30000]), rng.choice([156.8, 2187.5, 8414.5, None]),
            rng.randint(500, 40000), rng.randint(5, 900) * 1000000,
            rng.choice(["Nguyễn Văn Hùng", "Trần Thị Mai", "Lê Quốc Bảo", "Phạm Thanh Tâm"]),
            rng.choice(["", "Đã thay nguồn tháng 6", "Anten bị ăn mòn muối biển, cần kiểm tra định kỳ hàng quý", ""]),
            rng.choice(["Cao", "Trung bình", "Thấp"]),
        ])


def short_book(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Ngắn"
    ws.append(["Ngày", "Hạng mục", "Số tiền"])
    ws.append([datetime(2026, 11, 2), "Thay ắc quy UPS trạm Hòn Khoai", 12500000])
    ws.append([datetime(2026, 11, 9), "Bảo dưỡng máy phát điện dự phòng", 4800000])
    ws.append([datetime(2026, 11, 16), "Sửa anten VHF kênh 16", 7250000])
    wb.save(path)


def price_rule_book(path, seed=11):
    rng = random.Random(seed)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Quy tắc Giá"
    ws.append(["Ngày", "Nhóm hàng", "Đơn giá", "Giá bán", "Giá trị tài sản", "Số lượng giao",
               "Doanh thu giao dịch", "Thành tiền"])
    for _ in range(240):
        q = rng.randint(1, 20)
        gia = rng.choice([120000, 250000, 480000])
        ws.append([D0 + timedelta(days=rng.randint(0, 300)), rng.choice(["Phụ tùng", "Vật tư", "Thiết bị", "Dịch vụ"]),
                   gia, round(gia * 1.15), rng.randint(10, 500) * 1000000, q, q * gia * 2, q * gia])
    wb.save(path)


def wide_book(path, seed=7):
    rng = random.Random(seed)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Rất rộng"
    header = ["Mã hồ sơ", "Ngày tiếp nhận"] + [f"Chỉ tiêu kỹ thuật số {i:02d}" for i in range(1, 35)] + [
        "Mô tả chi tiết sự cố", "Mã tham chiếu", "Đơn vị xử lý", "Kết quả"]
    ws.append(header)
    for i in range(1, 61):
        ws.append([f"HS-{i:05d}", D0 + timedelta(days=i)] + [round(rng.uniform(0, 99999), 2) for _ in range(34)] + [
            rng.choice(["Mất tín hiệu AIS từ 02:00 đến 04:30 UTC do mất nguồn cấp tại trạm, đã chuyển sang nguồn dự phòng và báo cáo trực ban",
                        "Nhiễu kênh 16", "Hỏng bộ khuếch đại công suất, chờ linh kiện thay thế từ nhà cung cấp"]),
            "REF" + "".join(rng.choice("ABCDEFGHJKLMNPQRSTUVWXYZ0123456789") for _ in range(60)),
            rng.choice(["Tổ kỹ thuật", "Tổ trực canh", "Phòng KT-NV"]), rng.choice(["Hoàn thành", "Đang xử lý"])])
    wb.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--big-rows", type=int, default=200000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    revenue_book(out / "SoTheoDoi_DoanhThu_2026.xlsx", 1200, 2026)
    short_book(out / "NganGon_3Dong.xlsx")
    price_rule_book(out / "QuyTac_Gia.xlsx")
    wide_book(out / "RatRong_40Cot.xlsx")
    revenue_book(out / "DaiTrungBinh_25000.xlsx", 25000, 25, with_equipment=False, write_only=True)
    if a.big_rows:
        revenue_book(out / f"RatLon_{a.big_rows}.xlsx", a.big_rows, 99, with_equipment=False, write_only=True)
    for p in sorted(out.glob("*.xlsx")):
        print(f"{p.name}: {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
