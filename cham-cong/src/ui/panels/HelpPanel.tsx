import { Card } from '../components/ui';

const STEPS: { title: string; items: string[] }[] = [
  {
    title: '1. Thiết lập lần đầu cho một Đài',
    items: [
      'Thẻ "Thiết lập đơn vị": nhập mã đơn vị, tên Đài, cơ quan chủ quản; chọn chế độ lịch (trực ca 24/7 hoặc hành chính); khai báo ngày lễ, ngày nghỉ riêng.',
      'Khai báo người ký (người lập biểu, phụ trách, lãnh đạo), địa danh, khổ giấy. Bấm "Lưu cấu hình".',
      'Thẻ "Mã công": thêm mã theo quy chế đơn vị (mã, tên, nhóm, hệ số, có tính tổng công, có là ngày làm việc thực tế). Có thể dùng "Thêm bộ mã gợi ý" rồi chỉnh lại.',
      'Thẻ "Nhân sự": thêm từng người hoặc "Nhập từ Excel" (cột Mã NV, Họ và tên, Chức vụ, Bộ phận, Ngày bắt đầu, Ngày kết thúc, Trạng thái).',
    ],
  },
  {
    title: '2. Chấm công hằng tháng',
    items: [
      'Chọn tháng/năm (◀ ▶ hoặc chọn trực tiếp). Nếu tháng chưa có bảng, bấm "Tạo bảng chấm công" – không ảnh hưởng tháng khác.',
      'Nhấp chọn ô (kéo chuột hoặc Shift + mũi tên để chọn nhiều ô), gõ mã rồi Enter, hoặc bấm nút mã phía trên bảng. Ghi đè nhiều ô đã có dữ liệu luôn có bước xác nhận.',
      'Ctrl+C / Ctrl+V sao chép – dán vùng ô (kể cả từ Excel). Delete xóa ô. Ctrl+Z hoàn tác. "Ghi chú ô" để ghi lý do điều chỉnh.',
      'Thay đổi được lưu tự động vào máy; chỉ báo "Đã lưu / Đang lưu / Lỗi lưu" ở góc trên. Nếu báo lỗi, bấm "Lưu" để thử lại.',
      'Nhấp ô "Tổng công" của một dòng để xem chi tiết cách tính. Bấm "Xem cảnh báo" để xem ô trống, mã sai, mã chưa quy định hệ số.',
    ],
  },
  {
    title: '3. Nhập Excel',
    items: [
      'Bấm "Nhập Excel", chọn file. Ứng dụng tự nhận diện dòng tiêu đề, cột mã NV, họ tên, cột ngày và hiển thị bản xem trước.',
      'Chọn phương án: Nhập thêm (chỉ ô trống), Cập nhật (ghi đè ô có dữ liệu trong file), Thay thế (thay toàn bộ dòng). Mã NV không tồn tại và mã công không hợp lệ được liệt kê và bỏ qua.',
      'Dữ liệu chỉ được ghi khi bấm "Xác nhận nhập". Nếu có ghi đè, ứng dụng tạo điểm khôi phục trước.',
    ],
  },
  {
    title: '4. Xuất Excel, in và trình ký',
    items: [
      'Bấm "Xuất Excel" để tải file Bang_cham_cong_[MaDonVi][YYYY][MM].xlsx: tiêu đề, đơn vị, tháng, cột ngày tô màu cuối tuần/lễ, cột tổng hợp có công thức COUNTIF, khối ký, khổ giấy và vùng in, lặp dòng tiêu đề khi in nhiều trang.',
      'Mở file trong Excel → In (Ctrl+P). Thiết lập đã đặt sẵn: vừa 1 trang theo chiều ngang, hướng ngang, lề hẹp.',
      'Nút "In" trên ứng dụng in nhanh trực tiếp từ trình duyệt (bản xem nhanh). Bản trình ký chính thức nên in từ file Excel.',
      'Sau khi trình ký, bấm "Khóa tháng". Bảng đã khóa giữ nguyên mã, hệ số và tên nhân sự tại thời điểm khóa. Chỉ quản trị viên mở khóa và phải ghi lý do.',
      'Dùng mẫu Excel riêng của Đài: Thiết lập đơn vị → "Tải file mẫu có placeholder", chỉnh theo biểu mẫu đã phê duyệt, giữ ô {{BANG_CHAM_CONG}}, rồi "Tải lên mẫu của đơn vị".',
    ],
  },
  {
    title: '5. Sao lưu và phục hồi',
    items: [
      'Dữ liệu nằm trong trình duyệt của máy hiện tại. Xóa dữ liệu duyệt web hoặc hỏng máy có thể làm mất dữ liệu.',
      'Định kỳ (ít nhất hằng tuần và sau khi khóa tháng) bấm "Sao lưu" để tải file .json về, cất ở ổ đĩa khác/USB/thư mục mạng.',
      'Phục hồi: thẻ "Dữ liệu & Sao lưu" → "Chọn file sao lưu", xem trước, chọn phục hồi đơn vị hoặc toàn bộ. Trạng thái trước khi phục hồi được giữ thành điểm khôi phục.',
    ],
  },
  {
    title: '6. Triển khai cho Đài mới',
    items: [
      'Cùng máy: Thiết lập đơn vị → "Nhân bản…" từ một Đài đã cấu hình (sao chép mã công, lịch, mẫu Excel; không sao chép chấm công).',
      'Khác máy: "Xuất cấu hình" ở máy nguồn → chép file .json → máy đích "Nhập cấu hình…", nhập mã và tên Đài mới, xem trước rồi áp dụng.',
      'Dữ liệu chấm công cá nhân chỉ được mang theo khi chọn rõ "Kèm dữ liệu chấm công".',
    ],
  },
];

export function HelpPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {STEPS.map((s) => (
        <Card key={s.title} title={s.title}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">{s.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </Card>
      ))}
    </div>
  );
}
