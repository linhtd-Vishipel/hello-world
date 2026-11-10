import ExcelJS from 'exceljs';
import { pad2, WEEKDAY_SHORT } from '../domain/calendar';
import { excelCriteria } from '../domain/codes';
import { WORK_TYPE_LABELS } from '../domain/roster/config';
import type { RosterContext } from '../domain/roster/context';
import type { Roster } from '../domain/roster/types';
import { ISSUE_LABELS, personStats, type RosterIssue } from '../domain/roster/validate';
import type { SheetSummary } from '../domain/summary';
import { DEFAULT_TEMPLATE } from '../domain/unit';

const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0').slice(0, 6);
const fill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function rosterFileName(ctx: RosterContext): string {
  return `Lich_phan_ca_${ctx.unit.code}${ctx.year}${pad2(ctx.month)}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
}

interface ExportInput {
  ctx: RosterContext;
  roster: Roster;
  issues: RosterIssue[];
  /** Tổng hợp bảng chấm công cùng tháng (nếu có) để đối chiếu công quy đổi. */
  attendance?: SheetSummary | null;
}

export async function exportRosterXlsx(input: ExportInput): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Dashboard chấm công Đài TTDH';
  const { ctx } = input;
  const t = ctx.unit.template;
  const font = { name: t.fontName, size: t.fontSize };
  const bold = { ...font, bold: true };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const headerCell = (c: ExcelJS.Cell, v: ExcelJS.CellValue) => {
    c.value = v;
    c.font = bold;
    c.alignment = center;
    c.border = BORDER;
    c.fill = fill('#F1F5F9');
  };
  const offFill = (d: number) => (ctx.dayTypes[d - 1] === 'holiday' ? fill(t.holidayColor) : ctx.dayTypes[d - 1] === 'weekend' ? fill(t.weekendColor) : undefined);
  const name = (id: string) => ctx.employees.get(id)?.fullName ?? id;
  const status = input.roster.status === 'da_chot' ? `ĐÃ CHỐT${input.roster.approvedBy ? ` – ${input.roster.approvedBy}` : ''}` : 'BẢN NHÁP';

  const titleBlock = (ws: ExcelJS.Worksheet, lastCol: number, title: string) => {
    const put = (r: number, v: string, f: Partial<ExcelJS.Font>, h: 'left' | 'center' = 'center') => {
      ws.mergeCells(r, 1, r, lastCol);
      const c = ws.getCell(r, 1);
      c.value = v;
      c.font = { ...font, ...f };
      c.alignment = { horizontal: h, vertical: 'middle' };
    };
    put(1, ctx.unit.parentOrg, {}, 'left');
    put(2, `Đơn vị: ${ctx.unit.name}`, { bold: true }, 'left');
    put(4, title + (ctx.unit.isSample ? ' (DỮ LIỆU MẪU)' : ''), { bold: true, size: t.fontSize + 5 });
    put(5, `Tháng ${pad2(ctx.month)} năm ${ctx.year} – ${status}`, { italic: true });
  };
  const signBlock = (ws: ExcelJS.Worksheet, lastCol: number, after: number) => {
    const signers = t.signers.length ? t.signers : DEFAULT_TEMPLATE.signers;
    let r = after + 2;
    const span = Math.max(1, Math.floor(lastCol / signers.length));
    const lastStart = 1 + span * (signers.length - 1);
    ws.mergeCells(r, lastStart, r, lastCol);
    ws.getCell(r, lastStart).value = `${t.place ? t.place + ', ' : ''}ngày ..... tháng ..... năm ${ctx.year}`;
    ws.getCell(r, lastStart).font = { ...font, italic: true };
    ws.getCell(r, lastStart).alignment = { horizontal: 'center' };
    r++;
    signers.forEach((s, i) => {
      const c1 = 1 + span * i;
      const c2 = i === signers.length - 1 ? lastCol : c1 + span - 1;
      const put = (row: number, v: string, f: Partial<ExcelJS.Font>) => {
        ws.mergeCells(row, c1, row, c2);
        const c = ws.getCell(row, c1);
        c.value = v;
        c.font = { ...font, ...f };
        c.alignment = { horizontal: 'center' };
      };
      put(r, s.title, { bold: true });
      put(r + 1, '(Ký, ghi rõ họ tên)', { italic: true });
      put(r + 5, s.name, { bold: true });
    });
    return r + 5;
  };
  const print = (ws: ExcelJS.Worksheet, lastCol: number, lastRow: number, titleRows: string, landscape = true) => {
    ws.pageSetup = {
      ...ws.pageSetup,
      paperSize: (lastCol > 40 ? 8 : 9) as unknown as ExcelJS.PaperSize,
      orientation: landscape ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      printArea: `A1:${colLetter(lastCol)}${lastRow}`,
      printTitlesRow: titleRows,
    };
    ws.headerFooter = { oddFooter: '&C&8Trang &P/&N' };
  };

  // ---------- Trang 1: lịch theo ngày × (vị trí, ca)
  {
    const ws = wb.addWorksheet('Lich phan ca');
    const pairs: { positionId: string; shiftId: string }[] = [];
    for (const p of ctx.config.positions) {
      for (const s of ctx.config.shifts) {
        if (ctx.config.demands.some((d) => d.positionId === p.id && d.shiftId === s.id) || input.roster.assignments.some((a) => a.positionId === p.id && a.shiftId === s.id)) {
          pairs.push({ positionId: p.id, shiftId: s.id });
        }
      }
    }
    const lastCol = 2 + pairs.length + 1;
    titleBlock(ws, lastCol, 'LỊCH PHÂN CA TRỰC');
    const h1 = 7;
    headerCell(ws.getCell(h1, 1), 'Ngày');
    headerCell(ws.getCell(h1 + 1, 1), '');
    ws.mergeCells(h1, 1, h1 + 1, 1);
    headerCell(ws.getCell(h1, 2), 'Thứ');
    headerCell(ws.getCell(h1 + 1, 2), '');
    ws.mergeCells(h1, 2, h1 + 1, 2);
    let c = 3;
    for (const p of ctx.config.positions) {
      const cols = pairs.filter((x) => x.positionId === p.id);
      if (!cols.length) continue;
      for (let k = 0; k < cols.length; k++) headerCell(ws.getCell(h1, c + k), k === 0 ? p.name : '');
      if (cols.length > 1) ws.mergeCells(h1, c, h1, c + cols.length - 1);
      cols.forEach((x, k) => {
        const s = ctx.shifts.get(x.shiftId)!;
        const cell = ws.getCell(h1 + 1, c + k);
        headerCell(cell, `${s.name}\n${s.start}–${s.end}`);
        cell.fill = fill(s.color);
      });
      c += cols.length;
    }
    headerCell(ws.getCell(h1, lastCol), 'Ghi chú');
    headerCell(ws.getCell(h1 + 1, lastCol), '');
    ws.mergeCells(h1, lastCol, h1 + 1, lastCol);
    for (let d = 1; d <= ctx.nDays; d++) {
      const r = h1 + 1 + d;
      const f = offFill(d);
      const vals: string[] = [String(d), WEEKDAY_SHORT[ctx.weekdays[d - 1]]];
      pairs.forEach((x) => {
        const names = input.roster.assignments.filter((a) => a.day === d && a.positionId === x.positionId && a.shiftId === x.shiftId).map((a) => name(a.employeeId));
        vals.push(names.join(', '));
      });
      vals.push(input.roster.dayNotes[String(d)] ?? '');
      vals.forEach((v, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = i === 0 ? d : v;
        cell.font = font;
        cell.border = BORDER;
        cell.alignment = { vertical: 'middle', horizontal: i < 2 ? 'center' : 'left', wrapText: true };
        if (f) cell.fill = f;
      });
      pairs.forEach((x, i) => {
        const need = ctx.config.demands
          .filter((dm) => dm.positionId === x.positionId && dm.shiftId === x.shiftId && dm.dayTypes.includes(ctx.dayTypes[d - 1]))
          .reduce((n, dm) => Math.max(n, dm.minStaff), 0);
        const have = input.roster.assignments.filter((a) => a.day === d && a.positionId === x.positionId && a.shiftId === x.shiftId).length;
        if (have < need) {
          const cell = ws.getCell(r, 3 + i);
          cell.value = `${cell.value ? cell.value + ' – ' : ''}THIẾU ${need - have}`;
          cell.fill = fill('#FCA5A5');
          cell.font = bold;
        }
      });
    }
    const lastRow = h1 + 1 + ctx.nDays;
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 6;
    for (let k = 3; k < lastCol; k++) ws.getColumn(k).width = 18;
    ws.getColumn(lastCol).width = 22;
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: h1 + 1 }];
    const end = signBlock(ws, lastCol, lastRow);
    print(ws, lastCol, end, `${h1}:${h1 + 1}`, pairs.length > 4);
  }

  // ---------- Trang 2: lịch theo nhân sự × ngày (có công thức đếm)
  const stats = personStats(ctx, input.roster.assignments);
  {
    const ws = wb.addWorksheet('Theo nhan su');
    const shifts = ctx.config.shifts.filter((s) => s.active || input.roster.assignments.some((a) => a.shiftId === s.id));
    const firstDay = 4;
    const lastDay = firstDay + ctx.nDays - 1;
    const firstSum = lastDay + 1;
    const totalCol = firstSum + shifts.length;
    const hoursCol = totalCol + 1;
    const leaveCol = hoursCol + 1;
    const lastCol = leaveCol;
    titleBlock(ws, lastCol, 'LỊCH PHÂN CA THEO NHÂN SỰ');
    const h1 = 7;
    ['STT', 'Họ và tên', 'Vị trí chính'].forEach((v, i) => {
      headerCell(ws.getCell(h1, i + 1), v);
      headerCell(ws.getCell(h1 + 1, i + 1), '');
      ws.mergeCells(h1, i + 1, h1 + 1, i + 1);
    });
    for (let d = 1; d <= ctx.nDays; d++) {
      const c1 = ws.getCell(h1, firstDay + d - 1);
      headerCell(c1, d);
      const c2 = ws.getCell(h1 + 1, firstDay + d - 1);
      headerCell(c2, WEEKDAY_SHORT[ctx.weekdays[d - 1]]);
      const f = offFill(d);
      if (f) {
        c1.fill = f;
        c2.fill = f;
      }
    }
    shifts.forEach((s, i) => {
      headerCell(ws.getCell(h1, firstSum + i), s.short);
      headerCell(ws.getCell(h1 + 1, firstSum + i), `${s.hours}h`);
      ws.getCell(h1, firstSum + i).fill = fill(s.color);
    });
    [[totalCol, 'Tổng ngày trực'], [hoursCol, 'Tổng giờ'], [leaveCol, 'Ngày nghỉ có mã']].forEach(([col, label]) => {
      headerCell(ws.getCell(h1, col as number), label as string);
      headerCell(ws.getCell(h1 + 1, col as number), '');
      ws.mergeCells(h1, col as number, h1 + 1, col as number);
    });
    const people = ctx.participants;
    people.forEach((id, idx) => {
      const r = h1 + 2 + idx;
      const prof = ctx.profiles.get(id);
      const vals = [idx + 1, name(id), ctx.positions.get(prof?.primaryPositionId ?? '')?.name ?? WORK_TYPE_LABELS[prof?.workType ?? 'truc_ca']];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        c.font = font;
        c.border = BORDER;
        c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left' };
      });
      for (let d = 1; d <= ctx.nDays; d++) {
        const c = ws.getCell(r, firstDay + d - 1);
        const a = input.roster.assignments.find((x) => x.day === d && x.employeeId === id);
        const leave = ctx.leaves.get(id)?.get(d);
        c.font = font;
        c.border = BORDER;
        c.alignment = center;
        if (a) {
          const s = ctx.shifts.get(a.shiftId);
          c.value = s?.short ?? '?';
          if (s) c.fill = fill(s.color);
          const pos = ctx.positions.get(a.positionId);
          if (pos && prof?.primaryPositionId !== pos.id && (prof?.positionIds.length ?? 0) > 1) c.note = pos.name;
        } else if (leave) {
          c.value = leave.code;
          c.fill = fill('#FEF08A');
        } else {
          const f = offFill(d);
          if (f) c.fill = f;
        }
      }
      const range = `${colLetter(firstDay)}${r}:${colLetter(lastDay)}${r}`;
      const st = stats.get(id);
      shifts.forEach((s, i) => {
        const c = ws.getCell(r, firstSum + i);
        c.value = { formula: `COUNTIF(${range},"${excelCriteria(s.short)}")`, result: st?.byShift[s.id] ?? 0 };
        c.font = font;
        c.border = BORDER;
        c.alignment = center;
      });
      const sumRange = `${colLetter(firstSum)}${r}:${colLetter(totalCol - 1)}${r}`;
      const tc = ws.getCell(r, totalCol);
      tc.value = { formula: `SUM(${sumRange})`, result: st?.shifts ?? 0 };
      const hc = ws.getCell(r, hoursCol);
      hc.value = {
        formula: shifts.map((s, i) => `${colLetter(firstSum + i)}${r}*${s.hours}`).join('+') || '0',
        result: st?.hours ?? 0,
      };
      const lc = ws.getCell(r, leaveCol);
      lc.value = { formula: `COUNTA(${range})-${colLetter(totalCol)}${r}`, result: st?.leaveDays ?? 0 };
      for (const c of [tc, hc, lc]) {
        c.font = bold;
        c.border = BORDER;
        c.alignment = center;
      }
    });
    // Dòng tổng cộng theo cột ngày (số người trực mỗi ngày)
    const totalRow = h1 + 2 + people.length;
    ws.getCell(totalRow, 2).value = 'Số người trực';
    ws.getCell(totalRow, 2).font = bold;
    for (let d = 1; d <= ctx.nDays; d++) {
      const col = colLetter(firstDay + d - 1);
      const c = ws.getCell(totalRow, firstDay + d - 1);
      const crit = shifts.map((s) => `COUNTIF(${col}${h1 + 2}:${col}${totalRow - 1},"${excelCriteria(s.short)}")`).join('+');
      c.value = { formula: crit || '0', result: input.roster.assignments.filter((a) => a.day === d).length };
      c.font = bold;
      c.border = BORDER;
      c.alignment = center;
    }
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 22;
    ws.getColumn(3).width = 16;
    for (let k = firstDay; k <= lastDay; k++) ws.getColumn(k).width = 4.2;
    for (let k = firstSum; k <= lastCol; k++) ws.getColumn(k).width = 7;
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: h1 + 1 }];
    const legendRow = totalRow + 2;
    ws.mergeCells(legendRow, 1, legendRow, lastCol);
    ws.getCell(legendRow, 1).value = 'Ký hiệu: ' + ctx.config.shifts.map((s) => `${s.short} = ${s.name} (${s.start}–${s.end})`).join('; ') + '; ô vàng = ngày nghỉ có mã; ô xám/đỏ nhạt = cuối tuần/ngày lễ.';
    ws.getCell(legendRow, 1).font = { ...font, italic: true };
    ws.getCell(legendRow, 1).alignment = { wrapText: true };
    ws.getRow(legendRow).height = 30;
    const end = signBlock(ws, lastCol, legendRow);
    print(ws, lastCol, end, `${h1}:${h1 + 1}`);
  }

  // ---------- Trang 3: tổng hợp số ca, số ngày trực, số công
  {
    const ws = wb.addWorksheet('Tong hop cong');
    const heads = [
      'STT', 'Mã NV', 'Họ và tên', 'Loại', 'Nhóm', 'Số ngày trực', 'Số ca', 'Ca đêm', 'Ngày cuối tuần/lễ', 'Ngày hành chính',
      'Tổng giờ', 'Ngày nghỉ có mã', 'Định mức', 'Chênh lệch (+thừa/−thiếu)', 'Trần công', 'Công quy đổi (bảng chấm công)',
    ];
    titleBlock(ws, heads.length, 'TỔNG HỢP CA TRỰC VÀ CÔNG');
    const h = 7;
    heads.forEach((v, i) => headerCell(ws.getCell(h, i + 1), v));
    ws.getRow(h).height = 42;
    ctx.participants.forEach((id, idx) => {
      const s = stats.get(id)!;
      const prof = ctx.profiles.get(id);
      const att = input.attendance?.rows[id];
      const r = h + 1 + idx;
      const vals: ExcelJS.CellValue[] = [
        idx + 1, ctx.employees.get(id)?.code ?? '', name(id), WORK_TYPE_LABELS[prof?.workType ?? 'truc_ca'], prof?.group ?? '',
        s.days, s.shifts, s.nights, s.weekendDays, s.adminDays, s.hours, s.leaveDays, s.target,
        { formula: `F${r}+L${r}-M${r}`, result: s.diff }, s.cap, att ? att.convertedTotal : 'Chưa có bảng',
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        c.font = font;
        c.border = BORDER;
        c.alignment = { vertical: 'middle', horizontal: i === 2 || i === 3 || i === 4 ? 'left' : 'center' };
        if (i === 5 && s.days > s.cap) c.fill = fill('#FCA5A5');
      });
    });
    [5, 9, 22, 12, 14, 9, 7, 7, 10, 10, 8, 10, 9, 12, 8, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const end = signBlock(ws, heads.length, h + ctx.participants.length);
    print(ws, heads.length, end, `${h}:${h}`);
  }

  // ---------- Trang 4: vi phạm quy tắc
  {
    const ws = wb.addWorksheet('Vi pham');
    const heads = ['STT', 'Mức độ', 'Loại', 'Ngày', 'Nhân sự', 'Vị trí', 'Nội dung'];
    titleBlock(ws, heads.length, 'BÁO CÁO KIỂM TRA LỊCH PHÂN CA');
    const h = 7;
    heads.forEach((v, i) => headerCell(ws.getCell(h, i + 1), v));
    if (!input.issues.length) {
      ws.mergeCells(h + 1, 1, h + 1, heads.length);
      ws.getCell(h + 1, 1).value = 'Không phát hiện vi phạm.';
      ws.getCell(h + 1, 1).font = font;
    }
    input.issues.forEach((iss, idx) => {
      const r = h + 1 + idx;
      const vals = [
        idx + 1, iss.severity === 'error' ? 'Lỗi' : 'Cảnh báo', ISSUE_LABELS[iss.kind], iss.day ?? '',
        iss.employeeId ? name(iss.employeeId) : '', iss.positionId ? ctx.positions.get(iss.positionId)?.name ?? '' : '', iss.message,
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = v;
        c.font = font;
        c.border = BORDER;
        c.alignment = { vertical: 'top', wrapText: i === 6 };
        if (i === 1) c.fill = fill(iss.severity === 'error' ? '#FCA5A5' : '#FDE68A');
      });
    });
    [5, 10, 28, 6, 20, 20, 70].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    print(ws, heads.length, h + Math.max(1, input.issues.length), `${h}:${h}`);
  }

  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}
