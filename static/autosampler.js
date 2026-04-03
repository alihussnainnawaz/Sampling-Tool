// static/autosampler.js

const $ = (id) => document.getElementById(id);

let state = {
  file: null,
  columns: [],
  rows: 0,
  filename: "",
  cochran: { z: 1.96, p: 0.5, e: 0.05, N: null },
  method: "simple_random",
  strata: [],
  clusterCol: "",
  nClusters: null,
  uuidCol: "",
  runBy: "",
  outputFormat: "xlsx",
  randomSeed: 42,
};

// ── Drawer ──────────────────────────────────────────────
function setupDrawer() {
  const d = $("drawer"), b = $("drawerBackdrop"), t = $("drawerToggle"), c = $("drawerClose");
  if (!d) return;
  t.addEventListener("click", () => { d.classList.add("open"); b.classList.remove("hidden"); });
  c.addEventListener("click", () => { d.classList.remove("open"); b.classList.add("hidden"); });
  b.addEventListener("click", () => { d.classList.remove("open"); b.classList.add("hidden"); });
}

// ── File Upload ─────────────────────────────────────────
$("asUploadBtn").addEventListener("click", () => $("asFileInput").click());

$("asFileInput").addEventListener("change", async () => {
  const f = $("asFileInput").files[0];
  if (!f) return;

  state.file = f;
  $("asFileInfo").textContent = "Reading columns...";
  $("asColumnsWrap").classList.add("hidden");

  const fd = new FormData();
  fd.append("file", f);

  try {
    const r = await fetch("/api/autosampler/columns", { method: "POST", body: fd });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);

    state.columns = data.columns;
    state.rows = data.rows;
    state.filename = data.filename;

    $("asFileInfo").textContent = `${data.filename} — ${data.rows.toLocaleString()} rows, ${data.columns.length} columns`;
    renderColumns(data.columns);
    populateColumnSelects(data.columns);

    // Auto-set N from file rows if not manually set
    if (!$("cochranN").value) {
      state.cochran.N = data.rows;
    }
    updateCochranResult();

  } catch (err) {
    $("asFileInfo").textContent = "Error: " + err.message;
  }

  $("asFileInput").value = "";
});

function renderColumns(cols) {
  const list = $("asColumnsList");
  list.innerHTML = cols.map(c =>
    `<span class="as-col-chip">${c}</span>`
  ).join("");
  $("asColumnsWrap").classList.remove("hidden");
}

function populateColumnSelects(cols) {
  const selects = [$("clusterCol"), $("uuidCol")];
  selects.forEach(sel => {
    if (!sel) return;
    const first = sel.id === "uuidCol" ? '<option value="">— None —</option>' : '<option value="">— Select column —</option>';
    sel.innerHTML = first + cols.map(c => `<option value="${c}">${c}</option>`).join("");
  });
  // Rebuild strata column selects
  renderStrataRows();
}

// ── Cochran ─────────────────────────────────────────────
function cochranN0(z, p, e) { return (z * z * p * (1 - p)) / (e * e); }
function finiteCorrection(n0, N) { return n0 / (1 + (n0 - 1) / N); }

function updateCochranResult() {
  const { z, p, e, N } = state.cochran;
  if (!z || !p || !e || z <= 0 || p <= 0 || p >= 1 || e <= 0 || e >= 1) {
    $("cochranResult").classList.add("hidden");
    return;
  }

  const n0 = cochranN0(z, p, e);
  const n0c = Math.ceil(n0);
  $("crN0").textContent = n0c.toLocaleString();

  const effectiveN = N || state.rows;

  if (effectiveN > 0) {
    const nf = finiteCorrection(n0, effectiveN);
    const nfc = Math.ceil(nf);
    $("crArrow").style.display = "";
    $("crNfWrap").style.display = "";
    $("crNf").textContent = nfc.toLocaleString();
    $("crLabel").textContent = `(N = ${effectiveN.toLocaleString()}, finite correction applied)`;
  } else {
    $("crArrow").style.display = "none";
    $("crNfWrap").style.display = "none";
    $("crLabel").textContent = "Infinite population";
  }

  $("cochranResult").classList.remove("hidden");
  updateSystematicInfo();
}

function getFinalN() {
  const { z, p, e, N } = state.cochran;
  if (!z || !p || !e) return 0;
  const n0 = cochranN0(z, p, e);
  const effectiveN = N || state.rows;
  if (effectiveN > 0) return Math.ceil(finiteCorrection(n0, effectiveN));
  return Math.ceil(n0);
}

// Cochran presets
document.querySelectorAll(".as-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.field;
    const value = parseFloat(btn.dataset.value);
    document.querySelectorAll(`.as-preset[data-field="${field}"]`).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const inputId = field === "z" ? "cochranZ" : field === "p" ? "cochranP" : "cochranE";
    $(inputId).value = value;
    state.cochran[field] = value;
    updateCochranResult();
  });
});

["cochranZ","cochranP","cochranE","cochranN"].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener("input", () => {
    const val = parseFloat(el.value);
    const key = id === "cochranZ" ? "z" : id === "cochranP" ? "p" : id === "cochranE" ? "e" : "N";
    state.cochran[key] = el.value.trim() === "" ? null : (isNaN(val) ? null : val);

    if (key !== "N") {
      const match = [...document.querySelectorAll(`.as-preset[data-field="${key}"]`)]
        .find(b => parseFloat(b.dataset.value) === val);
      document.querySelectorAll(`.as-preset[data-field="${key}"]`).forEach(b => b.classList.remove("active"));
      if (match) match.classList.add("active");
    }
    updateCochranResult();
  });
});

// ── Method Tabs ─────────────────────────────────────────
document.querySelectorAll(".as-method-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".as-method-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.method = tab.dataset.method;

    document.querySelectorAll(".as-method-pane").forEach(p => p.classList.add("hidden"));
    $(`pane-${state.method}`).classList.remove("hidden");

    updateSystematicInfo();
  });
});

// ── Systematic Info ─────────────────────────────────────
function updateSystematicInfo() {
  if (state.method !== "systematic") return;
  const n = getFinalN();
  const N = state.cochran.N || state.rows;
  if (n > 0 && N > 0) {
    const k = Math.round(N / n);
    $("sysK").textContent = k;
    $("systematicInfo").classList.remove("hidden");
  } else {
    $("systematicInfo").classList.add("hidden");
  }
}

// ── Strata Builder ──────────────────────────────────────
function addStrataRow(col = "", value = "", pct = "") {
  state.strata.push({ column: col, value: value, pct: pct });
  renderStrataRows();
}

function renderStrataRows() {
  const container = $("strataRows");
  if (!container) return;

  container.innerHTML = state.strata.map((s, i) => {
    const colOptions = state.columns.map(c =>
      `<option value="${c}" ${c === s.column ? "selected" : ""}>${c}</option>`
    ).join("");

    return `
      <div class="as-strata-row" data-index="${i}">
        <select class="as-input as-select strata-col" data-index="${i}">
          <option value="">— Column —</option>
          ${colOptions}
        </select>
        <input class="as-input strata-val" type="text" value="${s.value}" placeholder="Value (e.g. Male)" data-index="${i}">
        <input class="as-input strata-pct" type="number" min="0" max="100" value="${s.pct}" placeholder="%" data-index="${i}">
        <button class="as-remove-btn strata-remove" data-index="${i}" type="button">&times;</button>
      </div>`;
  }).join("");

  // Bind events
  container.querySelectorAll(".strata-col").forEach(el => {
    el.addEventListener("change", () => {
      state.strata[el.dataset.index].column = el.value;
      checkStrataPct();
    });
  });
  container.querySelectorAll(".strata-val").forEach(el => {
    el.addEventListener("input", () => { state.strata[el.dataset.index].value = el.value; });
  });
  container.querySelectorAll(".strata-pct").forEach(el => {
    el.addEventListener("input", () => {
      state.strata[el.dataset.index].pct = parseFloat(el.value) || 0;
      checkStrataPct();
    });
  });
  container.querySelectorAll(".strata-remove").forEach(el => {
    el.addEventListener("click", () => {
      state.strata.splice(parseInt(el.dataset.index), 1);
      renderStrataRows();
      checkStrataPct();
    });
  });

  checkStrataPct();
}

function checkStrataPct() {
  const total = state.strata.reduce((s, r) => s + (parseFloat(r.pct) || 0), 0);
  const el = $("strataPctCheck");
  if (!el) return;
  if (state.strata.length === 0) { el.textContent = ""; el.className = "as-pct-check"; return; }
  const diff = Math.abs(total - 100);
  if (diff < 0.5) {
    el.textContent = `✓ Total: ${total.toFixed(1)}% — looks good`;
    el.className = "as-pct-check as-pct-ok";
  } else {
    el.textContent = `⚠ Total: ${total.toFixed(1)}% — should sum to 100%`;
    el.className = "as-pct-check as-pct-warn";
  }
}

$("addStrataGroupBtn").addEventListener("click", () => addStrataRow());

// ── Cluster / UUID / Options ────────────────────────────
$("clusterCol").addEventListener("change", () => { state.clusterCol = $("clusterCol").value; });
$("nClusters").addEventListener("input", () => { state.nClusters = parseInt($("nClusters").value) || null; });
$("uuidCol").addEventListener("change", () => { state.uuidCol = $("uuidCol").value; });
$("runBy").addEventListener("input", () => { state.runBy = $("runBy").value; });
$("randomSeed").addEventListener("input", () => { state.randomSeed = parseInt($("randomSeed").value) || 42; });

document.querySelectorAll(".as-fmt-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".as-fmt-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.outputFormat = btn.dataset.fmt;
  });
});

// ── Run ─────────────────────────────────────────────────
$("asRunBtn").addEventListener("click", runSampling);

async function runSampling() {
  const btn = $("asRunBtn");
  const status = $("asRunStatus");

  if (!state.file) {
    status.textContent = "Please upload a dataset file first.";
    status.className = "as-run-status error";
    return;
  }

  const n = getFinalN();
  if (!n || n <= 0) {
    status.textContent = "Invalid Cochran parameters — cannot compute sample size.";
    status.className = "as-run-status error";
    return;
  }

  // Validate method-specific
  if (state.method === "stratified" && state.strata.length === 0) {
    status.textContent = "Add at least one stratification group.";
    status.className = "as-run-status error";
    return;
  }
  if (state.method === "cluster" && !state.clusterCol) {
    status.textContent = "Select a cluster column.";
    status.className = "as-run-status error";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Running...";
  status.textContent = "Sampling and generating audit PDF...";
  status.className = "as-run-status";

  // Build params
  const { z, p, e, N } = state.cochran;
  const effectiveN = N || state.rows;

  const params = {
    cochran: { z, p, e, N: effectiveN || null },
    method: state.method,
    method_params: buildMethodParams(),
    random_state: state.randomSeed,
    run_by: state.runBy || "Unknown",
    uuid_col: state.uuidCol || null,
    output_format: state.outputFormat,
  };

  const fd = new FormData();
  fd.append("file", state.file);
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

    status.textContent = "Done! ZIP downloaded — contains your sample file + PDF audit log.";
    status.className = "as-run-status success";

  } catch (err) {
    status.textContent = "Error: " + err.message;
    status.className = "as-run-status error";
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Run Sampling";
  }
}

function buildMethodParams() {
  if (state.method === "stratified") {
    // Group by column
    const colMap = {};
    state.strata.forEach(s => {
      if (!s.column) return;
      if (!colMap[s.column]) colMap[s.column] = { column: s.column, filters: [] };
      colMap[s.column].filters.push({ value: s.value, pct: parseFloat(s.pct) || 0 });
    });
    return { strata: Object.values(colMap) };
  }

  if (state.method === "cluster") {
    return {
      cluster_column: state.clusterCol,
      n_clusters: state.nClusters || null,
    };
  }

  return {};
}

// ── Init ────────────────────────────────────────────────
setupDrawer();

// Default strata rows
addStrataRow("", "", "");
addStrataRow("", "", "");
