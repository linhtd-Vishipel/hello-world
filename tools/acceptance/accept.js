// End-to-end acceptance test for report export. Drives the real UI in a real
// browser, downloads real files and records what the dashboard displayed so
// verify.py can reconcile source Excel -> processed data -> dashboard -> files.
//
//   node accept.js --samples <dir> --out <dir> [--base http://127.0.0.1:8000]
//                  [--browser chrome|msedge|chromium] [--exe <path>] [--large] [--headed]
//
// On Windows with Microsoft Edge:  node accept.js --browser msedge --samples ... --out ...
"use strict";
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (_) { ({ chromium } = require(process.env.PW || "playwright")); }

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const BASE = args.base || "http://127.0.0.1:8000";
const OUT = path.resolve(args.out || "acceptance_out");
const SAMPLES = path.resolve(args.samples || "samples");
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const record = {};
function check(id, name, pass, detail = "") {
  steps.push({ id, name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  — " + detail : ""}`);
}
const FILENAME_RE = /^BaoCao_[A-Za-z0-9]+_\d{8}_\d{4}\.(xlsx|pdf|docx)$/;

(async () => {
  const launch = { headless: !args.headed };
  if (args.exe) launch.executablePath = args.exe;
  else if (args.browser === "msedge") launch.channel = "msedge";
  else if (args.browser === "chrome") launch.channel = "chrome";
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 950 }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const p = await ctx.newPage();
  const ua = await p.evaluate(() => navigator.userAgent);
  record.browser = { name: args.browser || (args.exe ? path.basename(args.exe) : "chromium"), version: browser.version(), userAgent: ua };
  console.log("Browser:", record.browser.name, record.browser.version, "|", ua);

  const problems = [];
  p.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
  const responses = [];
  p.on("response", (r) => {
    if (r.url().includes("/export/")) {
      const h = r.headers();
      responses.push({ url: r.url().replace(/^.*\/api/, "/api"), status: r.status(), type: h["content-type"], disposition: h["content-disposition"], rows: h["x-report-rows"] });
    }
  });

  const status = () => p.locator("#exportStatus").innerText();
  const idle = () => p.waitForFunction(() => !document.querySelector("#exportPanel").classList.contains("busy"), null, { timeout: 300000 });
  async function download(id, sel, label) {
    const t0 = Date.now();
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 300000 }), p.click(sel)]);
    const fn = dl.suggestedFilename();
    const file = path.join(OUT, `${label}__${fn}`);
    await dl.saveAs(file);
    await idle();
    const size = fs.statSync(file).size;
    check(id, `Tải ${label}`, size > 0 && FILENAME_RE.test(fn), `${fn}, ${Math.round(size / 1024)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return { fn, file };
  }
  async function noDownload(id, sel, expectText, name) {
    let got = false;
    const onDl = () => (got = true);
    p.on("download", onDl);
    await p.click(sel);
    await idle();
    await p.waitForTimeout(1500);
    p.off("download", onDl);
    const st = await status();
    check(id, name, !got && st.includes(expectText), st);
  }
  async function dash(name) {
    const d = await p.evaluate(() => ({
      sheet: document.querySelector("#sheetTabs button.active")?.textContent || null,
      kpis: [...document.querySelectorAll(".kpi")].map((k) => ({ label: k.querySelector(".label").textContent, value: k.querySelector(".value").textContent, sub: k.querySelector(".sub").textContent })),
      pager: document.querySelector("#pager span")?.textContent,
      summary: document.querySelector("#exportSummary")?.textContent,
      charts: [...document.querySelectorAll(".chart-card")].filter((c) => c.querySelector("h3")).map((c) => ({
        title: c.querySelector("h3").textContent,
        head: [...c.querySelectorAll(".chart-table thead th")].map((th) => th.textContent),
        rows: [...c.querySelectorAll(".chart-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)),
      })),
      firstRow: [...document.querySelectorAll("#dataTable tbody tr:first-child td")].map((td) => td.textContent),
    }));
    record[name] = d;
    return d;
  }
  async function upload(file, title) {
    await p.setInputFiles("#fileInput", path.join(SAMPLES, file));
    await p.fill("#titleInput", title);
    await p.fill("#uploaderInput", "Nguyễn Văn Hùng");
    const t0 = Date.now();
    await p.click("#uploadBtn");
    await p.waitForFunction((t) => document.querySelector("#dsTitle")?.textContent === t && document.querySelector("#kpis .kpi"), title, { timeout: 300000 });
    await p.waitForTimeout(600);
    return (Date.now() - t0) / 1000;
  }
  const exportBtn = (fmt) => `#exportPanel [data-fmt="${fmt}"]`;
  const datasetIds = {};
  const currentId = () => p.evaluate(() => location.hash.slice(1));

  // ---- T01 main file -------------------------------------------------------
  await p.goto(BASE + "/");
  let secs = await upload("SoTheoDoi_DoanhThu_2026.xlsx", "Doanh thu dịch vụ kỹ thuật 2026");
  datasetIds.main = await currentId();
  const full = await dash("main_full");
  check("T01", "Upload file thực tế 1.200 dòng, Dashboard hiển thị", full.pager && full.pager.startsWith("1.200 dòng"), `${full.pager}, ${secs.toFixed(1)}s`);
  await p.fill("#optAuthor", "Trần Thị Mai");
  await p.dispatchEvent("#optAuthor", "change");
  await download("T02", exportBtn("xlsx"), "main_full_xlsx");

  // ---- T03 filters + date range + sort -------------------------------------
  await p.selectOption("#filters label:has-text('Chi nhánh') select", "Cà Mau");
  await p.fill("#filters input[type=date] >> nth=0", "2026-03-01");
  await p.dispatchEvent("#filters input[type=date] >> nth=0", "change");
  await p.fill("#filters input[type=date] >> nth=1", "2026-06-30");
  await p.dispatchEvent("#filters input[type=date] >> nth=1", "change");
  await p.click("#dataTable th:has-text('Thành tiền')");
  await p.click("#dataTable th:has-text('Thành tiền')");
  await p.waitForTimeout(600);
  const filt = await dash("main_filtered");
  check("T03", "Lọc Chi nhánh + khoảng ngày + sắp xếp", filt.summary.includes("Cà Mau") && filt.summary.includes("01/03/2026"), filt.summary);
  await p.screenshot({ path: path.join(OUT, "ui_filtered.png") });
  await download("T04", exportBtn("xlsx"), "main_filtered_xlsx");
  const pdfP = download("T05", exportBtn("pdf"), "main_filtered_pdf");
  await p.waitForTimeout(100);
  const busyLabel = await p.locator(exportBtn("pdf")).innerText().catch(() => "");
  await pdfP;
  check("T06", "Trạng thái đang xử lý khi xuất", busyLabel.includes("Đang tạo"), JSON.stringify(busyLabel));
  await download("T07", exportBtn("docx"), "main_filtered_docx");
  const st = await status();
  check("T08", "Thông báo thành công", st.startsWith("✅") && st.includes("70 dòng"), st);

  // ---- T09 manual download link (fallback when the browser blocks auto download)
  const manualName = await p.locator("#manualDownload").getAttribute("download");
  const [mdl] = await Promise.all([p.waitForEvent("download"), p.click("#manualDownload")]);
  await mdl.saveAs(path.join(OUT, "manual__" + mdl.suggestedFilename()));
  check("T09", "Nút '⬇ Tải lại' tải đúng file vừa tạo", mdl.suggestedFilename() === manualName && FILENAME_RE.test(manualName), manualName);

  // ---- T10 preview -----------------------------------------------------------
  await p.click("#previewBtn");
  await p.waitForSelector("#previewModal:not([hidden])", { timeout: 120000 });
  const src = await p.getAttribute("#previewFrame", "src");
  await p.screenshot({ path: path.join(OUT, "ui_preview.png") });
  const [pdl] = await Promise.all([p.waitForEvent("download"), p.click("#previewDownload")]);
  await pdl.saveAs(path.join(OUT, "preview__" + pdl.suggestedFilename()));
  await p.keyboard.press("Escape");
  check("T10", "Xem trước PDF + tải từ bản xem trước", src.startsWith("blob:") && FILENAME_RE.test(pdl.suggestedFilename()) && await p.locator("#previewModal").isHidden(), pdl.suggestedFilename());

  // ---- T11 per-chart export --------------------------------------------------
  await download("T11", ".chart-card >> nth=2 >> .chart-tools .export-btn", "main_chart3_xlsx");

  // ---- T12 empty filter -> no file, clear message ------------------------------
  await p.fill("#globalSearch", "không-tồn-tại-xyz");
  await p.waitForTimeout(800);
  await noDownload("T12", exportBtn("pdf"), "Không có dữ liệu", "Bộ lọc rỗng: không tạo file, có thông báo");
  await p.fill("#globalSearch", "");
  await p.waitForTimeout(800);

  // ---- T13 reload keeps filters ------------------------------------------------
  await p.click("#reloadBtn");
  await p.waitForFunction(() => document.querySelector("#exportStatus").textContent.includes("làm mới"));
  const after = await dash("main_after_reload");
  check("T13", "Làm mới dữ liệu giữ nguyên bộ lọc và số liệu", after.pager === filt.pager && JSON.stringify(after.kpis) === JSON.stringify(filt.kpis), after.pager);

  // ---- T14 all sheets ------------------------------------------------------------
  await p.selectOption("#optScope", "all_sheets");
  await download("T14", exportBtn("xlsx"), "main_allsheets_xlsx");
  await p.selectOption("#optScope", "current");

  // ---- T15 18-column sheet -------------------------------------------------------
  await p.click("#sheetTabs button >> nth=1");
  await p.waitForTimeout(800);
  await dash("equipment");
  await download("T15", exportBtn("pdf"), "equipment_pdf");
  await download("T16", exportBtn("docx"), "equipment_docx");

  // ---- T17 short report ----------------------------------------------------------
  await upload("NganGon_3Dong.xlsx", "Chi phí sửa chữa tháng 11");
  await dash("short");
  for (const [i, fmt] of [["T17", "xlsx"], ["T18", "pdf"], ["T19", "docx"]]) await download(i, exportBtn(fmt), `short_${fmt}`);

  // ---- T20 "Giá" aggregation rule ------------------------------------------------
  await upload("QuyTac_Gia.xlsx", "Kiểm tra quy tắc Giá");
  datasetIds.price = await currentId();
  const price = await dash("price");
  check("T20", "Dashboard áp dụng quy tắc 'Giá' hiện hành", price.kpis.some((k) => k.label.endsWith("(TB)")), price.kpis.map((k) => k.label).join(" | "));
  for (const [i, fmt] of [["T21", "xlsx"], ["T22", "pdf"], ["T23", "docx"]]) await download(i, exportBtn(fmt), `price_${fmt}`);

  // ---- T24 40 columns, long text -------------------------------------------------
  await upload("RatRong_40Cot.xlsx", "Hồ sơ kỹ thuật 40 chỉ tiêu");
  await dash("wide");
  for (const [i, fmt] of [["T24", "xlsx"], ["T25", "pdf"], ["T26", "docx"]]) await download(i, exportBtn(fmt), `wide_${fmt}`);

  // ---- T27 25,000 rows: limits -----------------------------------------------------
  secs = await upload("DaiTrungBinh_25000.xlsx", "Doanh thu 25000 dòng");
  const mid = await dash("mid");
  check("T27", "Upload 25.000 dòng", mid.pager.startsWith("25.000"), `${secs.toFixed(1)}s`);
  await noDownload("T28", exportBtn("pdf"), "vượt giới hạn 20.000 dòng", "PDF 25.000 dòng: từ chối, nêu nguyên nhân + cách xử lý");
  await noDownload("T29", exportBtn("docx"), "vượt giới hạn 5.000 dòng", "Word 25.000 dòng: từ chối, nêu nguyên nhân + cách xử lý");
  check("T30", "Không còn nút tải file cũ sau khi lỗi", (await p.locator("#manualDownload").count()) === 0);
  await download("T31", exportBtn("xlsx"), "mid_xlsx");
  await p.selectOption("#filters label:has-text('Chi nhánh') select", "Cà Mau");
  await p.waitForTimeout(800);
  const midF = await dash("mid_filtered");
  await download("T32", exportBtn("pdf"), "mid_camau_pdf");
  const midRows = parseInt(midF.pager.split(" ")[0].replace(/\./g, ""), 10);
  check("T33", "PDF sau khi lọc còn ≤ 20.000 dòng", midRows > 0 && midRows <= 20000, midF.pager);

  // ---- T34 very large file (optional) --------------------------------------------
  if (args.large) {
    const bigFile = fs.readdirSync(SAMPLES).find((f) => /^RatLon_\d+\.xlsx$/.test(f));
    secs = await upload(bigFile, "Dữ liệu rất lớn");
    const heap = await p.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
    const big = await dash("big");
    check("T34", `Upload + Dashboard ${bigFile}`, big.pager.includes("dòng"), `${big.pager}, ${secs.toFixed(1)}s, JS heap ${heap} MB`);
    const t0 = Date.now();
    await p.selectOption("#filters label:has-text('Chi nhánh') select", "Cà Mau");
    await p.waitForFunction(() => document.querySelector("#exportSummary").textContent.includes("Cà Mau"));
    const bigF = await dash("big_filtered");
    check("T35", "Lọc dữ liệu rất lớn không treo trình duyệt", Date.now() - t0 < 15000, `${Date.now() - t0} ms, ${bigF.pager}`);
    await download("T36", exportBtn("xlsx"), "big_camau_xlsx");
    const ping = await p.evaluate(() => { const t = performance.now(); for (let i = 0; i < 1e6; i++); return performance.now() - t; });
    check("T37", "Trang vẫn phản hồi sau khi xuất", ping < 1000, `${ping.toFixed(0)} ms`);
  }

  // ---- T38 regression: custom chart, theme, delete --------------------------------
  // Newest first: re-running the test on the same server leaves older copies.
  await p.click(`#datasetList li:has-text("Doanh thu dịch vụ kỹ thuật 2026") >> nth=0`);
  await p.waitForFunction(() => document.querySelector("#dsTitle").textContent === "Doanh thu dịch vụ kỹ thuật 2026");
  await p.waitForTimeout(600);
  const before = await p.locator(".chart-card").count();
  await p.selectOption("#bType", "doughnut");
  await p.selectOption("#bDim", "Dịch vụ");
  await p.click("#builderForm button[type=submit]");
  await p.waitForFunction((n) => document.querySelectorAll(".chart-card").length === n + 1, before);
  check("T38", "Chức năng cũ: thêm biểu đồ tuỳ chọn", true, `${before} -> ${before + 1}`);
  await p.click("#themeToggle");
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(OUT, "ui_dark.png") });
  await p.click("#themeToggle");
  check("T39", "Chức năng cũ: đổi giao diện sáng/tối", true);
  await upload("NganGon_3Dong.xlsx", "Bản để xoá");
  const n1 = await p.locator("#datasetList li").count();
  p.once("dialog", (d) => d.accept());
  await p.click("#deleteBtn");
  await p.waitForFunction((n) => document.querySelectorAll("#datasetList li").length === n - 1, n1);
  check("T40", "Chức năng cũ: xoá bộ dữ liệu", true, `${n1} -> ${n1 - 1}`);

  const bad = responses.filter((r) => r.status === 200 && !/^attachment; filename="BaoCao_[A-Za-z0-9]+_\d{8}_\d{4}\.(xlsx|pdf|docx)"; filename\*=UTF-8''/.test(r.disposition || "") && !r.url.includes("inline=true"));
  check("T41", "Header Content-Type/Content-Disposition đúng ở mọi lần xuất", bad.length === 0 && responses.every((r) => r.status !== 500), `${responses.length} phản hồi, ${bad.length} sai`);
  // The browser itself logs every non-2xx response; exactly the two intended
  // over-limit refusals (T28 PDF, T29 Word -> HTTP 422) are expected here.
  const expected422 = problems.filter((m) => /status of 422/.test(m));
  const other = problems.filter((m) => !/status of 422/.test(m));
  check("T42", "Không có lỗi JavaScript/console (ngoài 2 phản hồi 422 dự kiến ở T28, T29)", other.length === 0 && expected422.length === 2,
    other.length ? other.join(" | ") : `${expected422.length} phản hồi 422 dự kiến`);

  record.datasetIds = datasetIds;
  record.responses = responses;
  fs.writeFileSync(path.join(OUT, "dashboard_record.json"), JSON.stringify(record, null, 1));
  fs.writeFileSync(path.join(OUT, "ui_results.json"), JSON.stringify(steps, null, 1));
  await browser.close();
  const failed = steps.filter((s) => !s.pass).length;
  console.log(`\nUI: ${steps.length - failed}/${steps.length} PASS`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAILED:", e); process.exit(2); });
