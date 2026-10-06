/* Excel Dashboard frontend.
 * Loads a parsed dataset from the API and builds the dashboard in the
 * browser: filters, KPIs, auto charts, custom charts, profile and table.
 * All file-derived text is inserted with textContent (never innerHTML).
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });
  const nfCompact = new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 });
  const AGG_LABEL = { sum: "Tổng", avg: "Trung bình", count: "Số dòng", min: "Nhỏ nhất", max: "Lớn nhất" };
  const GRAIN_LABEL = { day: "ngày", month: "tháng", quarter: "quý", year: "năm" };
  const TYPE_LABEL = { number: "Số", date: "Ngày", category: "Phân loại", text: "Văn bản" };
  const ROLE_LABEL = { measure: "Chỉ số", dimension: "Nhóm", time: "Thời gian", identifier: "Mã/STT", text: "Mô tả" };
  const AVG_HINT = /(%|tỷ lệ|ty le|tỉ lệ|rate|đơn giá|don gia|giá|gia|price|bình quân|trung bình|avg|average|nhiệt độ|temp)/i;
  const TOP_N = 12;
  const PAGE_SIZE = 50;

  const state = {
    datasets: [],
    current: null,      // {meta, sheets, dashboard}
    sheetIdx: 0,
    filters: {},        // colIdx -> value
    dateFrom: "", dateTo: "",
    charts: [],         // Chart.js instances
    tableSearch: "", tablePage: 0, tableSort: null,
  };

  // ---------------------------------------------------------------- helpers
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function seriesColors() { return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar("--series-" + i)); }
  function fmt(v) { return typeof v === "number" ? nf.format(v) : v == null ? "" : String(v); }
  function fmtDate(iso) {
    if (!iso) return "";
    const [d, t] = iso.split("T");
    const [y, m, dd] = d.split("-");
    return `${dd}/${m}/${y}` + (t && t !== "00:00:00" ? " " + t.slice(0, 5) : "");
  }
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let detail = res.statusText;
      try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) {}
      throw new Error(detail);
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------------------------------------------------------------- theme
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("xd-theme"); } catch (_) {}
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    $("themeToggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("xd-theme", next); } catch (_) {}
      if (state.current) renderSheet();
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.current && renderSheet());
  }

  // ---------------------------------------------------------------- upload
  function initUpload() {
    const input = $("fileInput"), dz = $("dropzone"), btn = $("uploadBtn");
    const setFile = () => {
      const f = input.files[0];
      dz.classList.toggle("has-file", !!f);
      $("dropText").textContent = f ? `${f.name} (${(f.size / 1024).toFixed(0)} KB)` : "Kéo thả file Excel vào đây";
      btn.disabled = !f;
    };
    input.addEventListener("change", setFile);
    ["dragenter", "dragover"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("drag"); }));
    dz.addEventListener("drop", (ev) => {
      if (ev.dataTransfer.files.length) { input.files = ev.dataTransfer.files; setFile(); }
    });
    try { $("uploaderInput").value = localStorage.getItem("xd-uploader") || ""; } catch (_) {}

    $("uploadForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = input.files[0];
      if (!f) return;
      const msg = $("uploadMsg");
      msg.className = "msg"; msg.textContent = "Đang xử lý…"; btn.disabled = true;
      const fd = new FormData();
      fd.append("file", f);
      fd.append("title", $("titleInput").value);
      fd.append("uploader", $("uploaderInput").value);
      try { localStorage.setItem("xd-uploader", $("uploaderInput").value); } catch (_) {}
      try {
        const meta = await api("/api/datasets", { method: "POST", body: fd });
        msg.textContent = "Đã tải lên: " + meta.title;
        input.value = ""; $("titleInput").value = ""; setFile();
        await loadList();
        openDataset(meta.id);
      } catch (e) {
        msg.className = "msg error"; msg.textContent = "Lỗi: " + e.message; btn.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- dataset list
  async function loadList() {
    state.datasets = await api("/api/datasets");
    renderList();
  }
  function renderList() {
    const q = $("datasetSearch").value.trim().toLowerCase();
    const list = $("datasetList");
    list.replaceChildren();
    const items = state.datasets.filter((d) =>
      !q || (d.title + " " + d.filename + " " + d.uploader).toLowerCase().includes(q));
    $("datasetCount").textContent = state.datasets.length ? `${state.datasets.length} bộ` : "";
    if (!items.length) list.append(el("li", { class: "muted" }, state.datasets.length ? "Không có kết quả" : "Chưa có file nào"));
    for (const d of items) {
      const rows = d.sheets.reduce((a, s) => a + s.row_count, 0);
      list.append(el("li", {
        class: state.current && state.current.meta.id === d.id ? "active" : null,
        onclick: () => openDataset(d.id),
      },
        el("div", { class: "t" }, d.title),
        el("div", { class: "m" }, `${new Date(d.uploaded_at).toLocaleString("vi-VN")} · ${d.uploader || "Ẩn danh"} · ${nf.format(rows)} dòng`)));
    }
  }

  async function openDataset(id) {
    try {
      state.current = await api("/api/datasets/" + id);
    } catch (e) { toast("Không mở được: " + e.message); return; }
    state.current.dashboard.charts = state.current.dashboard.charts || {};
    state.sheetIdx = 0;
    try { history.replaceState(null, "", "#" + id); } catch (_) {}
    $("emptyState").hidden = true;
    $("dashboard").hidden = false;
    const m = state.current.meta;
    $("dsTitle").textContent = m.title;
    $("dsMeta").textContent = `${m.filename} · ${m.uploader || "Ẩn danh"} · ${new Date(m.uploaded_at).toLocaleString("vi-VN")}`;
    $("downloadBtn").href = `/api/datasets/${id}/file`;
    renderTabs();
    selectSheet(0);
    renderList();
  }

  function renderTabs() {
    const tabs = $("sheetTabs");
    tabs.replaceChildren();
    const sheets = state.current.sheets;
    tabs.hidden = sheets.length < 2;
    sheets.forEach((s, i) => tabs.append(el("button", {
      type: "button", class: i === state.sheetIdx ? "active" : null,
      onclick: () => selectSheet(i),
    }, s.name)));
  }

  function selectSheet(i) {
    state.sheetIdx = i;
    state.filters = {}; state.dateFrom = ""; state.dateTo = "";
    state.tableSearch = ""; state.tablePage = 0; state.tableSort = null;
    $("tableSearch").value = "";
    [...$("sheetTabs").children].forEach((b, j) => b.classList.toggle("active", j === i));
    const s = sheet();
    const notes = [];
    if (s.skipped_total_rows) notes.push(`Đã bỏ qua ${s.skipped_total_rows} dòng "Tổng cộng" để tránh cộng trùng.`);
    if (s.truncated) notes.push("File quá lớn: chỉ hiển thị 200.000 dòng đầu.");
    $("sheetNotice").hidden = !notes.length;
    $("sheetNotice").textContent = notes.join(" ");
    renderFilters();
    renderBuilderOptions();
    renderProfile();
    renderSheet();
  }

  const sheet = () => state.current.sheets[state.sheetIdx];
  const cols = () => sheet().columns.map((c, i) => ({ ...c, idx: i }));
  const PRIMARY_HINT = /(doanh thu|doanh số|thành tiền|thanh tien|số tiền|so tien|tổng tiền|giá trị|gia tri|lợi nhuận|chi phí|revenue|sales|amount|total|value|cost|profit)/i;
  /** Measure columns, most important first: money-like names, then additive
   *  columns by total, then average-type columns (đơn giá, tỷ lệ…). */
  const measures = () => cols().filter((c) => c.role === "measure").sort((a, b) => {
    const rank = (c) => (PRIMARY_HINT.test(c.name) ? 0 : AVG_HINT.test(c.name) ? 2 : 1);
    return rank(a) - rank(b) || Math.abs(b.sum || 0) - Math.abs(a.sum || 0);
  });
  const dims = () => cols().filter((c) => c.role === "dimension" && c.distinct >= 2)
    .sort((a, b) => a.distinct - b.distinct);
  const timeCol = () => cols().find((c) => c.role === "time");

  // ---------------------------------------------------------------- filters
  function renderFilters() {
    const box = $("filters");
    box.replaceChildren();
    const rows = sheet().rows;
    for (const d of dims().filter((c) => c.distinct <= 300).slice(0, 4)) {
      const values = [...new Set(rows.map((r) => r[d.idx]).filter((v) => v != null))].sort((a, b) => a.localeCompare(b, "vi"));
      const sel = el("select", { onchange: (e) => { setFilter(d.idx, e.target.value); } },
        el("option", { value: "" }, "Tất cả"), values.map((v) => el("option", { value: v }, v)));
      box.append(el("label", { class: "field" }, d.name, sel));
    }
    const t = timeCol();
    if (t) {
      const from = el("input", { type: "date", min: t.min.slice(0, 10), max: t.max.slice(0, 10),
        onchange: (e) => { state.dateFrom = e.target.value; refresh(); } });
      const to = el("input", { type: "date", min: t.min.slice(0, 10), max: t.max.slice(0, 10),
        onchange: (e) => { state.dateTo = e.target.value; refresh(); } });
      box.append(el("label", { class: "field" }, t.name + " từ", from), el("label", { class: "field" }, "đến", to));
    }
    if (box.children.length) {
      box.append(el("button", { class: "btn ghost", type: "button", onclick: () => { selectSheet(state.sheetIdx); } }, "Xoá lọc"));
    }
  }
  function setFilter(idx, value) {
    if (value) state.filters[idx] = value; else delete state.filters[idx];
    refresh();
  }
  function refresh() { state.tablePage = 0; renderSheet(); }

  function filteredRows() {
    const t = timeCol();
    const entries = Object.entries(state.filters);
    return sheet().rows.filter((r) => {
      for (const [i, v] of entries) if (r[i] !== v) return false;
      if (t && (state.dateFrom || state.dateTo)) {
        const d = r[t.idx];
        if (!d) return false;
        const day = d.slice(0, 10);
        if (state.dateFrom && day < state.dateFrom) return false;
        if (state.dateTo && day > state.dateTo) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- aggregation
  function timeKey(iso, grain) {
    if (!iso) return null;
    if (grain === "day") return iso.slice(0, 10);
    if (grain === "month") return iso.slice(0, 7);
    if (grain === "year") return iso.slice(0, 4);
    return iso.slice(0, 4) + "-Q" + (Math.floor((+iso.slice(5, 7) - 1) / 3) + 1);
  }
  function timeLabel(key, grain) {
    if (grain === "day") { const [y, m, d] = key.split("-"); return `${d}/${m}/${y}`; }
    if (grain === "month") { const [y, m] = key.split("-"); return `${m}/${y}`; }
    if (grain === "quarter") { const [y, q] = key.split("-"); return `${q}/${y}`; }
    return key;
  }
  function autoGrain(t) {
    const days = (new Date(t.max) - new Date(t.min)) / 86400000;
    return days <= 62 ? "day" : days <= 3 * 366 ? "month" : days <= 8 * 366 ? "quarter" : "year";
  }

  /** Returns [{key, label, value}] grouped by dimension. */
  function aggregate(rows, dimIdx, measureIdx, agg, grain) {
    const acc = new Map();
    for (const r of rows) {
      let k = r[dimIdx];
      if (grain) k = timeKey(k, grain);
      if (k == null) k = "(Trống)";
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { sum: 0, n: 0, min: Infinity, max: -Infinity, rows: 0 }));
      a.rows++;
      if (measureIdx != null) {
        const v = r[measureIdx];
        if (typeof v === "number") { a.sum += v; a.n++; if (v < a.min) a.min = v; if (v > a.max) a.max = v; }
      }
    }
    const out = [];
    for (const [k, a] of acc) {
      let value;
      if (agg === "count" || measureIdx == null) value = a.rows;
      else if (agg === "sum") value = a.sum;
      else if (agg === "avg") value = a.n ? a.sum / a.n : null;
      else if (agg === "min") value = a.n ? a.min : null;
      else value = a.n ? a.max : null;
      out.push({ key: k, label: grain && k !== "(Trống)" ? timeLabel(k, grain) : String(k), value });
    }
    if (grain) out.sort((x, y) => String(x.key).localeCompare(String(y.key)));
    else out.sort((x, y) => (y.value ?? -Infinity) - (x.value ?? -Infinity));
    return out;
  }
  /** Keep the top N groups, fold the rest into "Khác" (only for additive aggregations). */
  function topN(groups, n, agg) {
    if (groups.length <= n) return groups;
    const head = groups.slice(0, n);
    if (agg === "sum" || agg === "count") {
      head.push({ key: "__other", label: `Khác (${groups.length - n})`, value: groups.slice(n).reduce((a, g) => a + (g.value || 0), 0), other: true });
    }
    return head;
  }
  function defaultAgg(col) { return col && AVG_HINT.test(col.name) ? "avg" : "sum"; }

  // ---------------------------------------------------------------- render sheet
  function renderSheet() {
    state.charts.forEach((c) => c.destroy());
    state.charts = [];
    const rows = filteredRows();
    renderKpis(rows);
    renderCharts(rows);
    renderTable(rows);
  }

  function renderKpis(rows) {
    const box = $("kpis");
    box.replaceChildren();
    const total = sheet().rows.length;
    box.append(kpi("Số dòng", nf.format(rows.length), rows.length !== total ? `trên tổng ${nf.format(total)}` : "toàn bộ dữ liệu"));
    for (const m of measures().slice(0, 5)) {
      const vals = rows.map((r) => r[m.idx]).filter((v) => typeof v === "number");
      if (!vals.length) { box.append(kpi(m.name, "–", "không có giá trị")); continue; }
      const sum = vals.reduce((a, b) => a + b, 0), avg = sum / vals.length;
      const [lo, hi] = extent(vals);
      if (defaultAgg(m) === "avg") box.append(kpi(m.name + " (TB)", fmtKpi(avg), `Thấp nhất ${nf.format(lo)} · Cao nhất ${nf.format(hi)}`));
      else box.append(kpi(m.name, fmtKpi(sum), (Math.abs(sum) >= 1e6 ? `= ${nf.format(sum)} · ` : "") + `TB ${nf.format(avg)} / dòng`));
    }
  }
  function extent(vals) {
    let lo = Infinity, hi = -Infinity;
    for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  }
  function fmtKpi(v) { return Math.abs(v) >= 1e6 ? nfCompact.format(v) : nf.format(v); }
  function kpi(label, value, sub) {
    return el("div", { class: "kpi", title: label }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), el("div", { class: "sub" }, sub));
  }

  /** Charts suggested from the column roles. */
  function autoSpecs() {
    const specs = [];
    const ms = measures(), ds = dims(), t = timeCol();
    const m = ms[0];
    const agg = m ? defaultAgg(m) : "count";
    const mName = m ? m.name : null;
    if (t) {
      specs.push({ id: "auto-time", auto: true, type: "line", dimension: t.name, measure: mName, agg, time_grain: autoGrain(t), wide: true });
    }
    for (const d of ds.slice(0, 4)) {
      specs.push({ id: "auto-dim-" + d.idx, auto: true, type: d.distinct > 6 ? "hbar" : "bar", dimension: d.name, measure: mName, agg });
    }
    if (ms.length >= 2 && ds.length) {
      specs.push({ id: "auto-dim2", auto: true, type: ds[0].distinct > 6 ? "hbar" : "bar", dimension: ds[0].name, measure: ms[1].name, agg: defaultAgg(ms[1]) });
    }
    if (m) specs.push({ id: "auto-hist", auto: true, type: "hist", dimension: m.name, measure: m.name, agg: "count" });
    return specs;
  }

  function renderCharts(rows) {
    const box = $("charts");
    box.replaceChildren();
    const custom = (state.current.dashboard.charts[sheet().name] || []).map((c) => ({ ...c, custom: true }));
    const specs = [...autoSpecs(), ...custom];
    if (!specs.length) {
      box.append(el("div", { class: "card muted" }, "Không tìm thấy cột số hoặc cột phân loại để vẽ biểu đồ. Xem bảng dữ liệu bên dưới."));
      return;
    }
    for (const spec of specs) {
      try { box.append(chartCard(spec, rows)); } catch (e) { console.error(e); }
    }
  }

  function specTitle(spec) {
    if (spec.title) return spec.title;
    if (spec.type === "hist") return `Phân bố ${spec.measure}`;
    const what = spec.measure && spec.agg !== "count" ? `${AGG_LABEL[spec.agg]} ${spec.measure}` : "Số dòng";
    const by = spec.time_grain ? `theo ${GRAIN_LABEL[spec.time_grain]}` : `theo ${spec.dimension}`;
    return `${what} ${by}`;
  }

  function chartCard(spec, rows) {
    const c = cols();
    const dim = c.find((x) => x.name === spec.dimension);
    const mea = spec.measure ? c.find((x) => x.name === spec.measure) : null;
    if (!dim || (spec.measure && !mea)) {
      return el("div", { class: "card chart-card muted" }, `Biểu đồ "${specTitle(spec)}" tham chiếu cột không còn tồn tại.`);
    }
    let groups;
    if (spec.type === "hist") groups = histogram(rows.map((r) => r[mea.idx]).filter((v) => typeof v === "number"));
    else {
      groups = aggregate(rows, dim.idx, mea ? mea.idx : null, spec.agg, dim.role === "time" ? (spec.time_grain || autoGrain(dim)) : null);
      if (dim.role !== "time") groups = topN(groups, spec.type === "doughnut" ? 6 : TOP_N, spec.agg);
    }

    const canvas = el("canvas", { role: "img", "aria-label": specTitle(spec) });
    const boxEl = el("div", { class: "chart-box" }, canvas);
    if (spec.type === "hbar") boxEl.style.height = Math.max(200, groups.length * 26 + 40) + "px";
    const tableEl = el("div", { class: "chart-table", hidden: true }, groupTable(groups, spec));
    const tools = el("div", { class: "chart-tools" },
      el("button", { class: "btn small", type: "button", title: "Xem dạng bảng", onclick: () => {
        tableEl.hidden = !tableEl.hidden; boxEl.hidden = !tableEl.hidden;
      } }, "Bảng"),
      spec.custom ? el("button", { class: "btn small danger", type: "button", title: "Xoá biểu đồ", onclick: () => removeChart(spec.id) }, "Xoá") : null);
    const sub = spec.custom ? "Biểu đồ tự thêm" : "Tự động";
    const card = el("div", { class: "card chart-card" + (spec.wide ? " wide" : "") },
      el("div", { class: "chart-head" }, el("div", {}, el("h3", {}, specTitle(spec)), el("div", { class: "sub" }, sub + (groups.length ? "" : " · không có dữ liệu"))), tools),
      boxEl, tableEl);
    requestAnimationFrame(() => drawChart(canvas, spec, groups));
    return card;
  }

  function histogram(vals) {
    if (!vals.length) return [];
    const [min, max] = extent(vals);
    if (min === max) return [{ key: min, label: nf.format(min), value: vals.length }];
    const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(vals.length))));
    const w = (max - min) / bins;
    const counts = new Array(bins).fill(0);
    for (const v of vals) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
    return counts.map((n, i) => ({ key: i, label: `${nfCompact.format(min + i * w)}–${nfCompact.format(min + (i + 1) * w)}`, value: n }));
  }

  function groupTable(groups, spec) {
    const valHead = spec.type === "hist" ? "Số dòng" : spec.measure && spec.agg !== "count" ? `${AGG_LABEL[spec.agg]} ${spec.measure}` : "Số dòng";
    return el("table", { class: "table" },
      el("thead", {}, el("tr", {}, el("th", {}, spec.type === "hist" ? "Khoảng" : spec.dimension), el("th", {}, valHead))),
      el("tbody", {}, groups.map((g) => el("tr", {}, el("td", {}, g.label), el("td", { class: "num" }, fmt(g.value))))));
  }

  function drawChart(canvas, spec, groups) {
    if (!window.Chart || !canvas.isConnected) return;
    const text2 = cssVar("--text-secondary"), grid = cssVar("--grid"), surface = cssVar("--surface-1");
    const palette = seriesColors(), other = cssVar("--other");
    const labels = groups.map((g) => g.label), data = groups.map((g) => g.value);
    const font = { family: getComputedStyle(document.body).fontFamily, size: 12 };
    const tooltip = {
      backgroundColor: cssVar("--text-primary"), titleColor: surface, bodyColor: surface,
      padding: 10, cornerRadius: 6, displayColors: spec.type === "doughnut",
      callbacks: { label: (ctx) => " " + nf.format(spec.type === "hbar" ? ctx.parsed.x : ctx.parsed.y) },
    };
    let cfg;
    if (spec.type === "doughnut") {
      const colors = groups.map((g, i) => (g.other ? other : palette[i % palette.length]));
      const total = data.reduce((a, b) => a + (b || 0), 0);
      tooltip.callbacks.label = (ctx) => ` ${nf.format(ctx.parsed)} (${total ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)`;
      cfg = {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: surface, borderWidth: 2 }] },
        options: { maintainAspectRatio: false, cutout: "60%",
          plugins: { legend: { position: "right", labels: { color: text2, font, boxWidth: 12, boxHeight: 12 } }, tooltip } },
      };
    } else {
      const horizontal = spec.type === "hbar";
      const line = spec.type === "line";
      const color = palette[0];
      const valueAxis = { beginAtZero: true, grid: { color: grid, drawTicks: false }, border: { display: false },
        ticks: { color: text2, font, padding: 6, callback: (v) => nfCompact.format(v) } };
      const catAxis = { grid: { display: false }, border: { color: grid }, ticks: { color: text2, font, autoSkip: true, maxRotation: 0,
        callback: function (v) { const l = this.getLabelForValue(v); return l.length > 22 ? l.slice(0, 21) + "…" : l; } } };
      cfg = {
        type: line ? "line" : "bar",
        data: { labels, datasets: [{
          data,
          backgroundColor: line ? color : groups.map((g) => (g.other ? other : color)),
          borderColor: line ? color : surface,
          borderWidth: line ? 2 : 0,
          borderRadius: line ? 0 : 4, borderSkipped: "start",
          maxBarThickness: 36, categoryPercentage: 0.85, barPercentage: 0.9,
          pointRadius: line && data.length <= 40 ? 3 : 0, pointHoverRadius: 5, pointBackgroundColor: color, tension: 0.25, fill: false, spanGaps: true,
        }] },
        options: {
          maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x",
          interaction: { mode: "index", intersect: false, axis: horizontal ? "y" : "x" },
          scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
          plugins: { legend: { display: false }, tooltip },
        },
      };
    }
    state.charts.push(new Chart(canvas, cfg));
  }

  // ---------------------------------------------------------------- custom charts
  function renderBuilderOptions() {
    const c = cols();
    const dimOpts = [...dims(), ...c.filter((x) => x.role === "time"),
      ...c.filter((x) => x.role === "text" && x.distinct > 1 && x.distinct <= 1000)];
    $("bDim").replaceChildren(...dimOpts.map((x) => el("option", { value: x.name }, x.name)));
    $("bMeasure").replaceChildren(el("option", { value: "" }, "(Đếm số dòng)"),
      ...c.filter((x) => x.type === "number").map((x) => el("option", { value: x.name }, x.name)));
    const m = measures()[0];
    if (m) { $("bMeasure").value = m.name; $("bAgg").value = defaultAgg(m); }
    updateGrain();
    $("builder").hidden = !dimOpts.length;
  }
  function updateGrain() {
    const d = cols().find((x) => x.name === $("bDim").value);
    $("bGrainWrap").hidden = !(d && d.role === "time");
  }
  function initBuilder() {
    $("bDim").addEventListener("change", updateGrain);
    $("bMeasure").addEventListener("change", () => { if (!$("bMeasure").value) $("bAgg").value = "count"; });
    $("builderForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const d = cols().find((x) => x.name === $("bDim").value);
      if (!d) return;
      const measure = $("bMeasure").value || null;
      const spec = {
        id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: $("bTitle").value.trim(),
        type: $("bType").value,
        dimension: d.name,
        measure,
        agg: measure ? $("bAgg").value : "count",
        time_grain: d.role === "time" ? $("bGrain").value : null,
      };
      const name = sheet().name;
      const charts = state.current.dashboard.charts;
      charts[name] = [...(charts[name] || []), spec];
      if (await saveDashboard()) { $("bTitle").value = ""; renderSheet(); toast("Đã thêm biểu đồ"); }
      else charts[name].pop();
    });
  }
  async function removeChart(id) {
    const name = sheet().name;
    const charts = state.current.dashboard.charts;
    const before = charts[name] || [];
    charts[name] = before.filter((c) => c.id !== id);
    if (await saveDashboard()) renderSheet(); else charts[name] = before;
  }
  async function saveDashboard() {
    try {
      await api(`/api/datasets/${state.current.meta.id}/dashboard`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charts: state.current.dashboard.charts }),
      });
      return true;
    } catch (e) { toast("Không lưu được: " + e.message); return false; }
  }

  // ---------------------------------------------------------------- profile & table
  function renderProfile() {
    const t = $("profileTable");
    t.replaceChildren(
      el("thead", {}, el("tr", {}, ["Cột", "Kiểu", "Vai trò", "Có giá trị", "Trống", "Số giá trị khác nhau", "Nhỏ nhất", "Lớn nhất"].map((h) => el("th", {}, h)))),
      el("tbody", {}, cols().map((c) => el("tr", {},
        el("td", {}, c.name),
        el("td", {}, el("span", { class: "badge" }, TYPE_LABEL[c.type] || c.type)),
        el("td", {}, ROLE_LABEL[c.role] || c.role),
        el("td", { class: "num" }, nf.format(c.non_empty)),
        el("td", { class: "num" }, nf.format(c.empty)),
        el("td", { class: "num" }, nf.format(c.distinct)),
        el("td", { class: "num" }, c.type === "date" ? fmtDate(c.min) : fmt(c.min)),
        el("td", { class: "num" }, c.type === "date" ? fmtDate(c.max) : fmt(c.max))))));
  }

  function renderTable(rows) {
    const c = cols();
    const q = state.tableSearch.toLowerCase();
    let view = q ? rows.filter((r) => r.some((v) => v != null && String(v).toLowerCase().includes(q))) : rows;
    if (state.tableSort) {
      const { idx, dir } = state.tableSort;
      view = [...view].sort((a, b) => {
        const x = a[idx], y = b[idx];
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "vi")) * dir;
      });
    }
    const pages = Math.max(1, Math.ceil(view.length / PAGE_SIZE));
    state.tablePage = Math.min(state.tablePage, pages - 1);
    const pageRows = view.slice(state.tablePage * PAGE_SIZE, (state.tablePage + 1) * PAGE_SIZE);
    $("dataTable").replaceChildren(
      el("thead", {}, el("tr", {}, c.map((col) => el("th", {
        title: "Bấm để sắp xếp",
        onclick: () => {
          const s = state.tableSort;
          state.tableSort = s && s.idx === col.idx ? (s.dir === 1 ? { idx: col.idx, dir: -1 } : null) : { idx: col.idx, dir: 1 };
          renderTable(filteredRows());
        },
      }, col.name + (state.tableSort && state.tableSort.idx === col.idx ? (state.tableSort.dir === 1 ? " ▲" : " ▼") : ""))))),
      el("tbody", {}, pageRows.map((r) => el("tr", {}, c.map((col) => el("td", { class: col.type === "number" ? "num" : null },
        col.type === "date" ? fmtDate(r[col.idx]) : fmt(r[col.idx])))))));
    $("pager").replaceChildren(
      el("span", {}, `${nf.format(view.length)} dòng · trang ${state.tablePage + 1}/${pages}`),
      el("button", { class: "btn small", type: "button", disabled: state.tablePage === 0, onclick: () => { state.tablePage--; renderTable(filteredRows()); } }, "‹ Trước"),
      el("button", { class: "btn small", type: "button", disabled: state.tablePage >= pages - 1, onclick: () => { state.tablePage++; renderTable(filteredRows()); } }, "Sau ›"));
  }

  // ---------------------------------------------------------------- init
  function init() {
    initTheme();
    initUpload();
    initBuilder();
    $("datasetSearch").addEventListener("input", renderList);
    let tsTimer;
    $("tableSearch").addEventListener("input", (e) => {
      clearTimeout(tsTimer);
      tsTimer = setTimeout(() => { state.tableSearch = e.target.value.trim(); state.tablePage = 0; renderTable(filteredRows()); }, 200);
    });
    $("printBtn").addEventListener("click", () => window.print());
    $("deleteBtn").addEventListener("click", async () => {
      const m = state.current.meta;
      if (!confirm(`Xoá bộ dữ liệu "${m.title}"? Thao tác không thể hoàn tác.`)) return;
      try {
        await api("/api/datasets/" + m.id, { method: "DELETE" });
        state.current = null;
        $("dashboard").hidden = true; $("emptyState").hidden = false;
        try { history.replaceState(null, "", location.pathname); } catch (_) {}
        await loadList();
      } catch (e) { toast("Không xoá được: " + e.message); }
    });
    if (!window.Chart) toast("Không tải được thư viện biểu đồ. Bảng dữ liệu vẫn hoạt động.");
    loadList().then(() => {
      const id = location.hash.slice(1);
      if (id && state.datasets.some((d) => d.id === id)) openDataset(id);
    }).catch((e) => toast("Không tải được danh sách: " + e.message));
  }
  init();
})();
