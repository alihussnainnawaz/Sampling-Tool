// static/cochran.js — Cochran Calculator + Integrated Sampling Engine

const $ = (id) => document.getElementById(id);

// ── Global state ────────────────────────────────────────
let cochranState = { z: 1.96, p: 0.5, e: 0.05, n: null, nSource: "manual" };
let lastResult   = { n0ceil: null, nFinalCeil: null, N: null };
let samplerState = {
  method: null,
  file: null,
  columns: [],
  rows: 0,
  filename: "",
  strata: [],
  clusterCol: "",
  nClusters: null,
  uuidCol: "",
  runBy: "",
  outputFormat: "xlsx",
  seed: 42,
};

function getFinalN() {
  return lastResult.nFinalCeil ?? lastResult.n0ceil ?? 0;
}

// ═══════════════════════════════════════════════════════
// COCHRAN CALCULATOR
// ═══════════════════════════════════════════════════════

function cochranN0(z, p, e) { return (z * z * p * (1 - p)) / (e * e); }
function finiteCorrection(n0, N) { return n0 / (1 + (n0 - 1) / N); }

function calculate() {
  const { z, p, e, n } = cochranState;
  const msg = $("calcMsg");

  if (!z || !p || !e || z <= 0 || p <= 0 || p >= 1 || e <= 0 || e >= 1) {
    $("resultNumbers").innerHTML = '<span class="cochran-result-dash">&mdash;</span>';
    $("resultSub").textContent = "Fix parameter values to see result.";
    $("resultBreakdown").innerHTML = '<div class="subtext" style="padding:8px 0">No result yet.</div>';
    $("resultCard").classList.remove("has-result");
    $("samplingMethodRow").classList.add("hidden");
    return;
  }

  const n0 = cochranN0(z, p, e);
  const n0ceil = Math.ceil(n0);
  lastResult = { n0ceil, nFinalCeil: null, N: n };

  let resultHTML = `<span class="cochran-result-n0">${n0ceil.toLocaleString()}</span>`;
  let subText = "Infinite population — no finite correction applied.";
  let breakdownRows = buildBreakdown(z, p, e, n0, null);

  if (n && n > 0) {
    const nFinal = finiteCorrection(n0, n);
    const nFinalCeil = Math.ceil(nFinal);
    lastResult.nFinalCeil = nFinalCeil;
    const reduction = n0ceil - nFinalCeil;
    const reductionPct = ((reduction / n0ceil) * 100).toFixed(1);
    resultHTML = `
      <span class="cochran-result-n0">${n0ceil.toLocaleString()}</span>
      <span class="cochran-result-arrow">&rarr;</span>
      <span class="cochran-result-n">${nFinalCeil.toLocaleString()}</span>`;
    subText = `Finite correction applied (N = ${n.toLocaleString()}) — ${reduction > 0 ? `saved ${reduction.toLocaleString()} samples (${reductionPct}%)` : "no reduction"}`;
    breakdownRows = buildBreakdown(z, p, e, n0, { N: n, nFinal, nFinalCeil });
  }

  $("resultNumbers").innerHTML = resultHTML;
  $("resultSub").textContent = subText;
  $("resultBreakdown").innerHTML = breakdownRows;
  $("resultCard").classList.add("has-result");
  $("samplingMethodRow").classList.remove("hidden");

  // Update engine n display if open
  $("sgN").textContent = getFinalN().toLocaleString();

  if (msg) { msg.textContent = "Calculated."; setTimeout(() => { msg.textContent = ""; }, 1500); }
  const card = $("resultCard");
  card.style.boxShadow = "0 0 0 4px rgba(17,24,39,0.08)";
  setTimeout(() => { card.style.boxShadow = ""; }, 300);
}

function buildBreakdown(z, p, e, n0, finite) {
  const rows = [
    { label: "Z (confidence)", value: z },
    { label: "p (proportion)", value: p },
    { label: "e (margin of error)", value: e },
    { label: "n\u2080 (base, ceiling)", value: Math.ceil(n0).toLocaleString(), highlight: !finite },
  ];
  if (finite) {
    rows.push({ label: "N (population)", value: finite.N.toLocaleString() });
    rows.push({ label: "n (corrected, raw)", value: finite.nFinal.toFixed(4) });
    rows.push({ label: "n (final, ceiling)", value: finite.nFinalCeil.toLocaleString(), highlight: true });
  }
  return rows.map(r => `
    <div class="cochran-breakdown-row${r.highlight ? " highlight" : ""}">
      <span class="cochran-breakdown-label">${r.label}</span>
      <span class="cochran-breakdown-value">${r.value}</span>
    </div>`).join("");
}

$("calcBtn").addEventListener("click", calculate);
["paramZ","paramP","paramE","paramN"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });
});

// Presets
document.querySelectorAll(".cochran-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param;
    const value = btn.dataset.value;
    const inputId = param === "z" ? "paramZ" : param === "p" ? "paramP" : "paramE";
    document.querySelectorAll(`.cochran-preset[data-param="${param}"]`).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const input = $(inputId);
    if (input) { input.value = value; cochranState[param] = parseFloat(value); }
  });
});

// Inputs
["paramZ","paramP","paramE","paramN"].forEach(id => {
  const input = $(id);
  if (!input) return;
  input.addEventListener("input", () => {
    const val = parseFloat(input.value);
    const key = id === "paramZ" ? "z" : id === "paramP" ? "p" : id === "paramE" ? "e" : "n";
    if (id === "paramN") {
      cochranState.n = input.value.trim() === "" ? null : (isNaN(val) ? null : Math.round(val));
    } else {
      cochranState[key] = isNaN(val) ? null : val;
      const match = [...document.querySelectorAll(`.cochran-preset[data-param="${key}"]`)]
        .find(b => parseFloat(b.dataset.value) === val);
      document.querySelectorAll(`.cochran-preset[data-param="${key}"]`).forEach(b => b.classList.remove("active"));
      if (match) match.classList.add("active");
    }
  });
});

// N tabs
document.querySelectorAll(".cochran-n-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cochran-n-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.tab;
    cochranState.nSource = which;
    $("nTabManual").classList.toggle("hidden", which !== "manual");
    $("nTabFile").classList.toggle("hidden", which !== "file");
    if (which === "manual") {
      const val = parseFloat($("paramN").value);
      cochranState.n = $("paramN").value.trim() === "" ? null : (isNaN(val) ? null : Math.round(val));
    } else {
      const countEl = $("nFileCount");
      const fileResult = $("nFileResult");
      cochranState.n = (!fileResult.classList.contains("hidden") && countEl.textContent)
        ? (parseInt(countEl.textContent.replace(/,/g, ""), 10) || null) : null;
    }
  });
});

// N file upload
function readFileRowCount(file) {
  return new Promise((resolve, reject) => {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = e => {
        const lines = (e.target.result || "").split(/\r?\n/).filter(l => l.trim() !== "");
        resolve(Math.max(0, lines.length - 1));
      };
      reader.onerror = reject;
      reader.readAsText(file);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (typeof XLSX !== "undefined") {
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const wb = XLSX.read(e.target.result, { type: "array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            const rows = data.filter(r => r.some(c => c !== null && c !== undefined && c !== ""));
            resolve(Math.max(0, rows.length - 1));
          } catch (err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      } else { reject(new Error("XLSX library not loaded yet. Try again or use CSV.")); }
    } else { reject(new Error("Unsupported file type.")); }
  });
}

async function handleNFile(file) {
  if (!file) return;
  try {
    const count = await readFileRowCount(file);
    $("nFileName").textContent = file.name;
    $("nFileCount").textContent = count.toLocaleString();
    $("nFileResult").classList.remove("hidden");
    $("nFileDrop").classList.add("hidden");
    cochranState.n = count;
  } catch (err) { alert("Failed to read file: " + err.message); }
}

$("nFileBrowse").addEventListener("click", e => { e.stopPropagation(); $("nFileInput").click(); });
$("nFileInput").addEventListener("change", () => {
  const f = $("nFileInput").files[0];
  if (f) handleNFile(f);
  $("nFileInput").value = "";
});
$("nFileClear").addEventListener("click", () => {
  $("nFileResult").classList.add("hidden");
  $("nFileDrop").classList.remove("hidden");
  cochranState.n = null;
});
const nDropZone = $("nFileDrop");
nDropZone.addEventListener("dragover", e => { e.preventDefault(); nDropZone.classList.add("dragover"); });
nDropZone.addEventListener("dragleave", () => nDropZone.classList.remove("dragover"));
nDropZone.addEventListener("drop", e => {
  e.preventDefault(); nDropZone.classList.remove("dragover");
  const f = e.dataTransfer.files[0]; if (f) handleNFile(f);
});
nDropZone.addEventListener("click", e => {
  if (e.target === $("nFileBrowse") || $("nFileBrowse").contains(e.target)) return;
  $("nFileInput").click();
});

// ═══════════════════════════════════════════════════════
// METHOD PICKER MODAL
// ═══════════════════════════════════════════════════════

$("openSamplingBtn").addEventListener("click", () => {
  $("smN").textContent = getFinalN().toLocaleString();
  $("samplingModal").classList.remove("hidden");
});
$("smClose").addEventListener("click", () => $("samplingModal").classList.add("hidden"));
$("samplingModal").addEventListener("click", e => {
  if (e.target === $("samplingModal")) $("samplingModal").classList.add("hidden");
});

const METHOD_META = {
  simple_random: { icon: "🎲", title: "Simple Random Sampling" },
  stratified:    { icon: "📊", title: "Stratified Sampling" },
  cluster:       { icon: "🗺️", title: "Cluster Sampling" },
  systematic:    { icon: "📋", title: "Systematic (Interval) Sampling" },
};

document.querySelectorAll(".sm-method-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    $("samplingModal").classList.add("hidden");
    openSamplingEngine(btn.dataset.method);
  });
});

$("sgChangeBtn").addEventListener("click", () => {
  $("smN").textContent = getFinalN().toLocaleString();
  $("samplingModal").classList.remove("hidden");
});

// ═══════════════════════════════════════════════════════
// SAMPLING ENGINE
// ═══════════════════════════════════════════════════════

function openSamplingEngine(method) {
  samplerState.method = method;
  const meta = METHOD_META[method];

  $("sgIcon").textContent = meta.icon;
  $("sgTitle").textContent = meta.title;
  $("sgN").textContent = getFinalN().toLocaleString();

  renderMethodParams(method);

  $("sgEngineCard").classList.remove("hidden");
  $("sgEngineCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Dataset upload for sampler ──────────────────────────
$("sgUploadBtn").addEventListener("click", () => $("sgFileInput").click());
$("sgFileInput").addEventListener("change", async () => {
  const f = $("sgFileInput").files[0];
  if (!f) return;
  samplerState.file = f;
  $("sgFileInfo").textContent = "Reading...";
  $("sgColumnsWrap").classList.add("hidden");

  const fd = new FormData();
  fd.append("file", f);
  try {
    const r = await fetch("/api/autosampler/columns", { method: "POST", body: fd });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);

    samplerState.columns = data.columns;
    samplerState.rows = data.rows;
    samplerState.filename = data.filename;

    $("sgFileInfo").textContent = `${data.filename} — ${data.rows.toLocaleString()} rows, ${data.columns.length} columns`;

    // Render column chips
    $("sgColumnsList").innerHTML = data.columns.map(c =>
      `<span class="sg-col-chip">${c}</span>`).join("");
    $("sgColumnsWrap").classList.remove("hidden");

    // Populate selects
    populateSgSelects(data.columns);

    // Re-render method params with columns
    renderMethodParams(samplerState.method);

  } catch (err) {
    $("sgFileInfo").textContent = "Error: " + err.message;
  }
  $("sgFileInput").value = "";
});

function populateSgSelects(cols) {
  [$("sgUuidCol")].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">— None —</option>' +
      cols.map(c => `<option value="${c}">${c}</option>`).join("");
  });
}

// ── Method param renderers ──────────────────────────────
function renderMethodParams(method) {
  const container = $("sgMethodParams");
  if (!container) return;

  if (method === "simple_random") {
    container.innerHTML = `
      <div class="sg-section-title">Method Settings</div>
      <div class="sg-method-info">
        Randomly selects <strong>${getFinalN().toLocaleString()}</strong> rows from your dataset with equal probability. No additional configuration needed.
      </div>`;

  } else if (method === "stratified") {
    container.innerHTML = `
      <div class="sg-section-title">Stratification Groups</div>
      <div class="sg-section-sub">Define how to split your sample. Each row = one group. Percentages must sum to 100%.</div>
      <div class="sg-strata-header">
        <span>Column</span><span>Value</span><span>% of sample</span><span></span>
      </div>
      <div id="sgStrataRows"></div>
      <button id="sgAddStrataBtn" class="btn" type="button" style="margin-top:8px">+ Add Group</button>
      <div id="sgPctCheck" class="sg-pct-check"></div>`;
    renderStrataRows();
    $("sgAddStrataBtn").addEventListener("click", () => {
      samplerState.strata.push({ column: "", value: "", pct: "" });
      renderStrataRows();
    });

  } else if (method === "cluster") {
    const colOptions = samplerState.columns.map(c =>
      `<option value="${c}" ${c === samplerState.clusterCol ? "selected" : ""}>${c}</option>`
    ).join("");
    container.innerHTML = `
      <div class="sg-section-title">Cluster Settings</div>
      <div class="sg-run-options-grid">
        <div class="sg-field">
          <label>Cluster Column</label>
          <select id="sgClusterCol" class="sg-input sg-select">
            <option value="">— Select column —</option>
            ${colOptions}
          </select>
        </div>
        <div class="sg-field">
          <label>Number of Clusters <span class="subtext">(blank = auto)</span></label>
          <input id="sgNClusters" class="sg-input" type="number" min="1" placeholder="Auto"
            value="${samplerState.nClusters || ""}">
        </div>
      </div>`;
    $("sgClusterCol").addEventListener("change", () => { samplerState.clusterCol = $("sgClusterCol").value; });
    $("sgNClusters").addEventListener("input", () => { samplerState.nClusters = parseInt($("sgNClusters").value) || null; });

  } else if (method === "systematic") {
    const n = getFinalN();
    const N = samplerState.rows || cochranState.n || "?";
    const k = N !== "?" ? Math.round(N / n) : "?";
    container.innerHTML = `
      <div class="sg-section-title">Systematic Settings</div>
      <div class="sg-sys-display">
        <div class="sg-sys-item"><div class="sg-sys-label">Population N</div><div class="sg-sys-value">${typeof N === "number" ? N.toLocaleString() : N}</div></div>
        <div class="sg-sys-item"><div class="sg-sys-label">Sample n</div><div class="sg-sys-value">${n.toLocaleString()}</div></div>
        <div class="sg-sys-item sg-sys-highlight"><div class="sg-sys-label">Interval k = N/n</div><div class="sg-sys-value">${k}</div></div>
        <div class="sg-sys-item"><div class="sg-sys-label">Start</div><div class="sg-sys-value">Random (1 to k)</div></div>
      </div>
      <div class="sg-method-info" style="margin-top:10px">Upload your dataset and every ${k === "?" ? "k-th" : k + "th"} row will be selected automatically.</div>`;
  }
}

// ── Strata builder ──────────────────────────────────────
function renderStrataRows() {
  const container = $("sgStrataRows");
  if (!container) return;

  container.innerHTML = samplerState.strata.map((s, i) => {
    const colOptions = samplerState.columns.map(c =>
      `<option value="${c}" ${c === s.column ? "selected" : ""}>${c}</option>`).join("");
    return `
      <div class="sg-strata-row" data-index="${i}">
        <select class="sg-input sg-select sg-strata-col" data-index="${i}">
          <option value="">— Column —</option>${colOptions}
        </select>
        <input class="sg-input sg-strata-val" type="text" value="${s.value}" placeholder="e.g. Male" data-index="${i}">
        <input class="sg-input sg-strata-pct" type="number" min="0" max="100" step="0.1" value="${s.pct}" placeholder="%" data-index="${i}">
        <button class="sg-remove-btn sg-strata-remove" data-index="${i}" type="button">&times;</button>
      </div>`;
  }).join("");

  container.querySelectorAll(".sg-strata-col").forEach(el => {
    el.addEventListener("change", () => { samplerState.strata[el.dataset.index].column = el.value; checkPct(); });
  });
  container.querySelectorAll(".sg-strata-val").forEach(el => {
    el.addEventListener("input", () => { samplerState.strata[el.dataset.index].value = el.value; });
  });
  container.querySelectorAll(".sg-strata-pct").forEach(el => {
    el.addEventListener("input", () => { samplerState.strata[el.dataset.index].pct = parseFloat(el.value) || 0; checkPct(); });
  });
  container.querySelectorAll(".sg-strata-remove").forEach(el => {
    el.addEventListener("click", () => {
      samplerState.strata.splice(parseInt(el.dataset.index), 1);
      renderStrataRows(); checkPct();
    });
  });
  checkPct();
}

function checkPct() {
  const el = $("sgPctCheck");
  if (!el) return;
  const total = samplerState.strata.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0);
  if (samplerState.strata.length === 0) { el.textContent = ""; el.className = "sg-pct-check"; return; }
  const diff = Math.abs(total - 100);
  if (diff < 0.5) {
    el.textContent = `✓ Total: ${total.toFixed(1)}% — good to go`;
    el.className = "sg-pct-check sg-pct-ok";
  } else {
    el.textContent = `⚠ Total: ${total.toFixed(1)}% — must sum to 100%`;
    el.className = "sg-pct-check sg-pct-warn";
  }
}

// ── Run options ─────────────────────────────────────────
$("sgUuidCol").addEventListener("change", () => { samplerState.uuidCol = $("sgUuidCol").value; });
$("sgRunBy").addEventListener("input", () => { samplerState.runBy = $("sgRunBy").value; });
$("sgSeed").addEventListener("input", () => { samplerState.seed = parseInt($("sgSeed").value) || 42; });

document.querySelectorAll(".sg-fmt-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sg-fmt-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    samplerState.outputFormat = btn.dataset.fmt;
  });
});

// ── Run ─────────────────────────────────────────────────
$("sgRunBtn").addEventListener("click", runSampling);

async function runSampling() {
  const btn = $("sgRunBtn");
  const status = $("sgRunStatus");

  if (!samplerState.file) {
    status.textContent = "Upload a dataset file first.";
    status.className = "sg-run-status error"; return;
  }

  const n = getFinalN();
  if (!n || n <= 0) {
    status.textContent = "Calculate sample size first (Step 1).";
    status.className = "sg-run-status error"; return;
  }

  if (samplerState.method === "stratified" && samplerState.strata.length === 0) {
    status.textContent = "Add at least one stratification group.";
    status.className = "sg-run-status error"; return;
  }
  if (samplerState.method === "cluster" && !samplerState.clusterCol) {
    status.textContent = "Select a cluster column.";
    status.className = "sg-run-status error"; return;
  }

  btn.disabled = true;
  btn.textContent = "Running...";
  status.textContent = "Sampling dataset and generating audit PDF...";
  status.className = "sg-run-status";

  const effectiveN = cochranState.n || samplerState.rows;
  const { z, p, e } = cochranState;

  // Build method params
  let method_params = {};
  if (samplerState.method === "stratified") {
    const colMap = {};
    samplerState.strata.forEach(s => {
      if (!s.column) return;
      if (!colMap[s.column]) colMap[s.column] = { column: s.column, filters: [] };
      colMap[s.column].filters.push({ value: s.value, pct: parseFloat(s.pct) || 0 });
    });
    method_params = { strata: Object.values(colMap) };
  } else if (samplerState.method === "cluster") {
    method_params = { cluster_column: samplerState.clusterCol, n_clusters: samplerState.nClusters || null };
  }

  const params = {
    cochran: { z, p, e, N: effectiveN || null },
    method: samplerState.method,
    method_params,
    random_state: samplerState.seed,
    run_by: samplerState.runBy || "Unknown",
    uuid_col: samplerState.uuidCol || null,
    output_format: samplerState.outputFormat,
  };

  const fd = new FormData();
  fd.append("file", samplerState.file);
  fd.append("params", JSON.stringify(params));

  try {
    const r = await fetch("/api/autosampler/run", { method: "POST", body: fd });
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(data.error || "Server error");
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sampling_run_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    status.textContent = "✓ Done! ZIP downloaded — sample file + PDF audit log.";
    status.className = "sg-run-status success";
  } catch (err) {
    status.textContent = "Error: " + err.message;
    status.className = "sg-run-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Run & Download";
  }
}

// ═══════════════════════════════════════════════════════
// DRAWER + SHEETJS
// ═══════════════════════════════════════════════════════
function setupDrawer() {
  const d = $("drawer"), b = $("drawerBackdrop"), t = $("drawerToggle"), c = $("drawerClose");
  if (!d) return;
  t.addEventListener("click", () => { d.classList.add("open"); b.classList.remove("hidden"); });
  c.addEventListener("click", () => { d.classList.remove("open"); b.classList.add("hidden"); });
  b.addEventListener("click", () => { d.classList.remove("open"); b.classList.add("hidden"); });
}
function loadSheetJS() {
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  document.head.appendChild(s);
}

setupDrawer();
loadSheetJS();

// Default strata rows
samplerState.strata = [
  { column: "", value: "", pct: "" },
  { column: "", value: "", pct: "" },
];
