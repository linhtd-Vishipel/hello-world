// End-to-end acceptance test for report export. Drives the real UI in a real
// browser, downloads real files and records what the dashboard displayed so
// verify.py can reconcile source Excel -> processed data -> dashboard -> files.
//
//   node accept.js --samples <dir> --out <dir> [--base http://127.0.0.1:8000]
//                  [--browser chrome|msedge|chromium] [--exe <path>] [--large] [--headed]
//
// On Windows with Microsoft Edge:  node accept.js --browser msedge --samples ... --out ...
//
// Robustness for unattended runs: tests are grouped in sections; an error in a
// section marks that section's remaining tests FAIL (with the error) and the
// run continues. Every FAIL gets a screenshot loi_<id>.png. Results are saved
// after every section, so a crash still leaves ui_results.json behind.
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

// Every test id this run must report (T34-T37 only with --large).
const SECTIONS = [
  ["S01", "Upload file thực tế + xuất Excel không lọc", ["T01", "T02"]],
  ["S02", "Lọc + xuất Excel/PDF/Word", ["T03", "T04", "T05", "T06", "T07", "T08"]],
  ["S03", "Nút Tải lại", ["T09"]],
  ["S04", "Xem trước PDF", ["T10"]],
  ["S05", "Xuất theo từng bảng thống kê", ["T11"]],
  ["S06", "Bộ lọc rỗng", ["T12"]],
  ["S07", "Làm mới dữ liệu", ["T13"]],
  ["S08", "Xuất toàn bộ sheet", ["T14"]],
  ["S09", "Sheet 18 cột", ["T15", "T16"]],
  ["S10", "Báo cáo ngắn 3 dòng", ["T17", "T18", "T19"]],
  ["S11", "Quy tắc 'Giá'", ["T20", "T21", "T22", "T23"]],
  ["S12", "40 cột, chữ dài", ["T24", "T25", "T26"]],
  ["S13", "25.000 dòng: giới hạn PDF/Word", ["T27", "T28", "T29", "T30", "T31", "T32", "T33"]],
  ["S14", "200.000 dòng", ["T34", "T35", "T36", "T37"]],
  ["S15", "Chức năng cũ", ["T38", "T39", "T40"]],
  ["S16", "Header HTTP + lỗi console", ["T41", "T42"]],
].filter(([sid]) => sid !== "S14" || args.large);

const startedAt = new Date();
const steps = [];
const timings = [];
const record = {};
const shots = [];
let page = null;

function screenshot(name) {
  if (!page) return;
  shots.push(page.screenshot({ path: path.join(OUT, name) }).catch(() => {}));
}
function check(id, name, pass, detail = "") {
  steps.push({ id, name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? "  — " + detail : ""}`);
  if (!pass) screenshot(`loi_${id}.png`);
}
function save(extra = {}) {
  const order = SECTIONS.flatMap(([, , ids]) => ids);
  const sorted = [...steps].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  fs.writeFileSync(path.join(OUT, "ui_results.json"), JSON.stringify(sorted, null, 1), "utf8");
  fs.writeFileSync(path.join(OUT, "dashboard_record.json"), JSON.stringify(record, null, 1), "utf8");
  fs.writeFileSync(path.join(OUT, "ui_summary.json"), JSON.stringify({
    browser: record.browser || null, base: BASE, large: !!args.large,
    started: startedAt.toISOString(), finished: new Date().toISOString(),
    seconds: Math.round((Date.now() - startedAt) / 1000), sections: timings,
    expected: order.length, recorded: steps.length, ...extra,
  }, null, 1), "utf8");
}
function failMissing(ids, reason) {
  for (const id of ids) {
    if (!steps.some((s) => s.id === id)) {
      const sec = SECTIONS.find(([, , list]) => list.includes(id));
      const name = `${sec ? sec[1] : "Bài kiểm thử"} — không thực hiện được`;
      steps.push({ id, name, pass: false, detail: reason });
      console.log(`FAIL [${id}] ${name} — ${reason}`);
    }
  }
}
async function section(sid, fn) {
  const [, name, ids] = SECTIONS.find(([s]) => s === sid) || [];
  if (!ids) return; // section not part of this run (e.g. S14 without --large)
  const t0 = Date.now();
  console.log(`\n--- ${sid}: ${name}`);
  try {
    await fn();
    failMissing(ids, "Bài kiểm thử không ghi nhận kết quả");
  } catch (e) {
    const msg = String((e && e.message) || e).split("\n")[0].slice(0, 300);
    screenshot(`loi_${sid}.png`);
    failMissing(ids, `Lỗi khi chạy nhóm ${sid}: ${msg} (ảnh: loi_${sid}.png)`);
  }
  timings.push({ id: sid, name, tests: ids, seconds: +((Date.now() - t0) / 1000).toFixed(1) });
  save();
}

const FILENAME_RE = /^BaoCao_[A-Za-z0-9]+_\d{8}_\d{4}\.(xlsx|pdf|docx)$/;

(async () => {
  const launch = { headless: !args.headed };
  if (args.exe) launch.executablePath = args.exe;
  else if (args.browser === "msedge") launch.channel = "msedge";
  else if (args.browser === "chrome") launch.channel = "chrome";
  let browser;
  try {
    browser = await chromium.launch(launch);
  } catch (e) {
    const msg = String(e.message || e).split("\n")[0];
    console.error("Không khởi động được trình duyệt:", msg);
    failMissing(SECTIONS.flatMap(([, , ids]) => ids), `Không khởi động được trình duyệt '${args.browser || args.exe || "chromium"}': ${msg}`);
    save({ fatal: msg });
    process.exit(2);
  }
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 950 }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const p = await ctx.newPage();
  page = p;
  const ua = await p.evaluate(() => navigator.userAgent);
  record.browser = { name: args.browser || (args.exe ? path.basename(args.exe) : "chromium"), version: browser.version(), userAgent: ua,
    launch: { channel: launch.channel || null, executablePath: launch.executablePath || null } };
  console.log("Browser:", record.browser.name, record.browser.version, "|", ua);

  const problems = [];
  p.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
  const responses = [];
  const dlUrls = []; // source URL of every browser download (must be http(s)://…/api/exports/…, never blob:)
  p.on("download", (d) => dlUrls.push(d.url()));
  p.on("response", (r) => {
    if (r.url().includes("/export/") || r.url().includes("/api/exports/")) {
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
  record.datasetIds = datasetIds;
  record.responses = responses;
  const currentId = () => p.evaluate(() => location.hash.slice(1));
  let secs, filt;

  await section("S01", async () => {
    await p.goto(BASE + "/");
    secs = await upload("SoTheoDoi_DoanhThu_2026.xlsx", "Doanh thu dịch vụ kỹ thuật 2026");
    datasetIds.main = await currentId();
    const full = await dash("main_full");
    check("T01", "Upload file thực tế 1.200 dòng, Dashboard hiển thị", full.pager && full.pager.startsWith("1.200 dòng"), `${full.pager}, ${secs.toFixed(1)}s`);
    await p.fill("#optAuthor", "Trần Thị Mai");
    await p.dispatchEvent("#optAuthor", "change");
    await download("T02", exportBtn("xlsx"), "main_full_xlsx");
  });

  await section("S02", async () => {
    await p.selectOption("#filters label:has-text('Chi nhánh') select", "Cà Mau");
    await p.fill("#filters input[type=date] >> nth=0", "2026-03-01");
    await p.dispatchEvent("#filters input[type=date] >> nth=0", "change");
    await p.fill("#filters input[type=date] >> nth=1", "2026-06-30");
    await p.dispatchEvent("#filters input[type=date] >> nth=1", "change");
    await p.click("#dataTable th:has-text('Thành tiền')");
    await p.click("#dataTable th:has-text('Thành tiền')");
    await p.waitForTimeout(600);
    filt = await dash("main_filtered");
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
  });

  // Fallback when the browser blocks the automatic download.
  await section("S03", async () => {
    const manualName = await p.locator("#manualDownload").getAttribute("download");
    const [mdl] = await Promise.all([p.waitForEvent("download"), p.click("#manualDownload")]);
    const again = path.join(OUT, "manual__" + mdl.suggestedFilename());
    await mdl.saveAs(again);
    // Same server copy as the automatic download: byte-identical, not a regenerated or empty file.
    const first = fs.readdirSync(OUT).filter((f) => f.endsWith("__" + manualName) && !f.startsWith("manual__")).map((f) => path.join(OUT, f));
    const same = first.length === 1 && fs.readFileSync(first[0]).equals(fs.readFileSync(again));
    check("T09", "Nút '⬇ Tải lại' tải lại đúng file vừa tạo (giống từng byte)", mdl.suggestedFilename() === manualName && FILENAME_RE.test(manualName) && same,
      `${manualName}${same ? "" : " — KHÁC file tải lần đầu"}`);
  });

  await section("S04", async () => {
    await p.click("#previewBtn");
    await p.waitForSelector("#previewModal:not([hidden])", { timeout: 120000 });
    const src = await p.getAttribute("#previewFrame", "src");
    await p.screenshot({ path: path.join(OUT, "ui_preview.png") });
    const [pdl] = await Promise.all([p.waitForEvent("download"), p.click("#previewDownload")]);
    await pdl.saveAs(path.join(OUT, "preview__" + pdl.suggestedFilename()));
    await p.keyboard.press("Escape");
    check("T10", "Xem trước PDF + tải từ bản xem trước", /^\/api\/exports\/[\w-]+\?inline=true$/.test(src) && FILENAME_RE.test(pdl.suggestedFilename()) && await p.locator("#previewModal").isHidden(), pdl.suggestedFilename());
  });

  await section("S05", async () => {
    await download("T11", ".chart-card >> nth=2 >> .chart-tools .export-btn", "main_chart3_xlsx");
  });

  await section("S06", async () => {
    await p.fill("#globalSearch", "không-tồn-tại-xyz");
    await p.waitForTimeout(800);
    await noDownload("T12", exportBtn("pdf"), "Không có dữ liệu", "Bộ lọc rỗng: không tạo file, có thông báo");
    await p.fill("#globalSearch", "");
    await p.waitForTimeout(800);
  });

  await section("S07", async () => {
    await p.click("#reloadBtn");
    await p.waitForFunction(() => document.querySelector("#exportStatus").textContent.includes("làm mới"));
    const after = await dash("main_after_reload");
    check("T13", "Làm mới dữ liệu giữ nguyên bộ lọc và số liệu", filt && after.pager === filt.pager && JSON.stringify(after.kpis) === JSON.stringify(filt.kpis), after.pager);
  });

  await section("S08", async () => {
    await p.selectOption("#optScope", "all_sheets");
    await download("T14", exportBtn("xlsx"), "main_allsheets_xlsx");
    await p.selectOption("#optScope", "current");
  });

  await section("S09", async () => {
    await p.click("#sheetTabs button >> nth=1");
    await p.waitForTimeout(800);
    await dash("equipment");
    await download("T15", exportBtn("pdf"), "equipment_pdf");
    await download("T16", exportBtn("docx"), "equipment_docx");
  });

  await section("S10", async () => {
    await upload("NganGon_3Dong.xlsx", "Chi phí sửa chữa tháng 11");
    await dash("short");
    for (const [i, fmt] of [["T17", "xlsx"], ["T18", "pdf"], ["T19", "docx"]]) await download(i, exportBtn(fmt), `short_${fmt}`);
  });

  await section("S11", async () => {
    await upload("QuyTac_Gia.xlsx", "Kiểm tra quy tắc Giá");
    datasetIds.price = await currentId();
    const price = await dash("price");
    check("T20", "Dashboard áp dụng quy tắc 'Giá' hiện hành", price.kpis.some((k) => k.label.endsWith("(TB)")), price.kpis.map((k) => k.label).join(" | "));
    for (const [i, fmt] of [["T21", "xlsx"], ["T22", "pdf"], ["T23", "docx"]]) await download(i, exportBtn(fmt), `price_${fmt}`);
  });

  await section("S12", async () => {
    await upload("RatRong_40Cot.xlsx", "Hồ sơ kỹ thuật 40 chỉ tiêu");
    await dash("wide");
    for (const [i, fmt] of [["T24", "xlsx"], ["T25", "pdf"], ["T26", "docx"]]) await download(i, exportBtn(fmt), `wide_${fmt}`);
  });

  await section("S13", async () => {
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
  });

  await section("S14", async () => {
    const bigFile = fs.readdirSync(SAMPLES).find((f) => /^RatLon_\d+\.xlsx$/.test(f));
    if (!bigFile) throw new Error(`Không thấy file RatLon_*.xlsx trong ${SAMPLES}`);
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
  });

  await section("S15", async () => {
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
  });

  await section("S16", async () => {
    // File responses (GET /api/exports/<token>) must be real attachments; /prepare returns JSON.
    const files = responses.filter((r) => r.url.includes("/api/exports/"));
    const bad = files.filter((r) => r.status === 200 && !/^attachment; filename="BaoCao_[A-Za-z0-9]+_\d{8}_\d{4}\.(xlsx|pdf|docx)"; filename\*=UTF-8''/.test(r.disposition || "") && !r.url.includes("inline=true"));
    const blobDl = await p.evaluate(() => [...document.querySelectorAll("a[href^='blob:']")].length);
    const notHttp = dlUrls.filter((u) => !/^https?:\/\/[^/]+\/api\/exports\/[\w-]+$/.test(u));
    check("T41", "Tải xuống HTTP chuẩn (không dùng blob:), header Content-Type/Content-Disposition đúng ở mọi lần xuất",
      dlUrls.length > 0 && notHttp.length === 0 && bad.length === 0 && blobDl === 0 && responses.every((r) => r.status !== 500),
      `${dlUrls.length} lượt tải xuống đều từ /api/exports/ (HTTP)` + (notHttp.length ? `; KHÔNG chuẩn: ${notHttp.slice(0, 3).join(", ")}` : "")
      + `; ${files.length} phản hồi file kiểm header, ${bad.length} sai; ${blobDl} liên kết blob:`);
    // The browser itself logs every non-2xx response; exactly the two intended
    // over-limit refusals (T28 PDF, T29 Word -> HTTP 422) are expected here.
    const expected422 = problems.filter((m) => /status of 422/.test(m));
    const other = problems.filter((m) => !/status of 422/.test(m));
    check("T42", "Không có lỗi JavaScript/console (ngoài 2 phản hồi 422 dự kiến ở T28, T29)", other.length === 0 && expected422.length === 2,
      other.length ? other.join(" | ") : `${expected422.length} phản hồi 422 dự kiến`);
  });

  await Promise.all(shots);
  save();
  await browser.close();
  const failed = steps.filter((s) => !s.pass).length;
  console.log(`\nUI: ${steps.length - failed}/${steps.length} PASS`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error("FAILED:", e);
  await Promise.all(shots).catch(() => {});
  failMissing(SECTIONS.flatMap(([, , ids]) => ids), `Dừng bất thường: ${String(e.message || e).split("\n")[0]}`);
  save({ fatal: String(e.message || e) });
  process.exit(2);
});
