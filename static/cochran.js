// static/cochran.js

const $ = (id) => document.getElementById(id);

let state = {
  z: 1.96,
  p: 0.5,
  e: 0.05,
  n: null,
  nSource: "manual"
};

// ── Cochran Formula ─────────────────────────────────────
function cochranN0(z, p, e) {
  return (z * z * p * (1 - p)) / (e * e);
}

function finiteCorrection(n0, N) {
  return n0 / (1 + (n0 - 1) / N);
}

// ── Calculate ───────────────────────────────────────────
function calculate() {
  const { z, p, e, n } = state;
  const msg = $("calcMsg");

  if (!z || !p || !e || z <= 0 || p <= 0 || p >= 1 || e <= 0 || e >= 1) {
    $("resultNumbers").innerHTML = `<span class="cochran-result-dash">&mdash;</span>`;
    $("resultSub").textContent = "Fix parameter values to see result.";
    $("resultBreakdown").innerHTML = `<div class="subtext" style="padding:8px 0">No result yet.</div>`;
    $("resultCard").classList.remove("has-result");
    if (msg) msg.textContent = "Invalid parameters.";
    return;
  }

  const n0 = cochranN0(z, p, e);
  const n0ceil = Math.ceil(n0);

  let resultHTML = `<span class="cochran-result-n0">${n0ceil.toLocaleString()}</span>`;
  let subText = "Infinite population — no finite correction applied.";
  let breakdownRows = buildBreakdown(z, p, e, n0, null);

  if (n && n > 0) {
    const nFinal = finiteCorrection(n0, n);
    const nFinalCeil = Math.ceil(nFinal);
    const reduction = n0ceil - nFinalCeil;
    const reductionPct = ((reduction / n0ceil) * 100).toFixed(1);

    resultHTML = `
      <span class="cochran-result-n0">${n0ceil.toLocaleString()}</span>
      <span class="cochran-result-arrow">→</span>
      <span class="cochran-result-n">${nFinalCeil.toLocaleString()}</span>
    `;
    subText = `Finite correction applied (N = ${n.toLocaleString()}) — ${reduction > 0 ? `saved ${reduction.toLocaleString()} samples (${reductionPct}%)` : "no reduction, population is very large"}`;
    breakdownRows = buildBreakdown(z, p, e, n0, { N: n, nFinal, nFinalCeil });
  }

  $("resultNumbers").innerHTML = resultHTML;
  $("resultSub").textContent = subText;
  $("resultBreakdown").innerHTML = breakdownRows;
  $("resultCard").classList.add("has-result");

  if (msg) msg.textContent = "Calculated.";
  setTimeout(() => { if (msg) msg.textContent = ""; }, 1500);

  // Pulse
  const card = $("resultCard");
  card.style.transition = "box-shadow 0.3s ease";
  card.style.boxShadow = "0 0 0 4px rgba(17,24,39,0.08)";
  setTimeout(() => { card.style.boxShadow = ""; }, 300);
}

function buildBreakdown(z, p, e, n0, finite) {
  const rows = [
    { label: "Z (confidence)", value: z, highlight: false },
    { label: "p (proportion)", value: p, highlight: false },
    { label: "e (margin of error)", value: e, highlight: false },
    { label: "n₀ (base, ceiling)", value: Math.ceil(n0).toLocaleString(), highlight: !finite },
  ];

  if (finite) {
    rows.push({ label: "N (population)", value: finite.N.toLocaleString(), highlight: false });
    rows.push({ label: "n (corrected, raw)", value: finite.nFinal.toFixed(4), highlight: false });
    rows.push({ label: "n (final, ceiling)", value: finite.nFinalCeil.toLocaleString(), highlight: true });
  }

  return rows.map(r => `
    <div class="cochran-breakdown-row${r.highlight ? " highlight" : ""}">
      <span class="cochran-breakdown-label">${r.label}</span>
      <span class="cochran-breakdown-value">${r.value}</span>
    </div>
  `).join("");
}

// ── Calculate Button ────────────────────────────────────
$("calcBtn").addEventListener("click", calculate);

// Also calculate on Enter in any input
["paramZ","paramP","paramE","paramN"].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener("keydown", (e) => { if (e.key === "Enter") calculate(); });
});

// ── Preset Buttons ──────────────────────────────────────
document.querySelectorAll(".cochran-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const param = btn.dataset.param;
    const value = btn.dataset.value;
    const inputId = param === "z" ? "paramZ" : param === "p" ? "paramP" : "paramE";

    document.querySelectorAll(`.cochran-preset[data-param="${param}"]`).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const input = $(inputId);
    if (input) {
      input.value = value;
      state[param] = parseFloat(value);
    }
  });
});

// ── Parameter Inputs (sync preset highlights) ───────────
["paramZ","paramP","paramE","paramN"].forEach(id => {
  const input = $(id);
  if (!input) return;

  input.addEventListener("input", () => {
    const val = parseFloat(input.value);
    const key = id === "paramZ" ? "z" : id === "paramP" ? "p" : id === "paramE" ? "e" : "n";

    if (id === "paramN") {
      state.n = input.value.trim() === "" ? null : (isNaN(val) ? null : Math.round(val));
    } else {
      state[key] = isNaN(val) ? null : val;
      // Sync preset active
      const match = [...document.querySelectorAll(`.cochran-preset[data-param="${key}"]`)]
        .find(b => parseFloat(b.dataset.value) === val);
      document.querySelectorAll(`.cochran-preset[data-param="${key}"]`).forEach(b => b.classList.remove("active"));
      if (match) match.classList.add("active");
    }
  });
});

// ── N Tabs ──────────────────────────────────────────────
document.querySelectorAll(".cochran-n-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".cochran-n-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    const which = tab.dataset.tab;
    state.nSource = which;

    $("nTabManual").classList.toggle("hidden", which !== "manual");
    $("nTabFile").classList.toggle("hidden", which !== "file");

    if (which === "manual") {
      const val = parseFloat($("paramN").value);
      state.n = $("paramN").value.trim() === "" ? null : (isNaN(val) ? null : Math.round(val));
    } else {
      const countEl = $("nFileCount");
      const fileResult = $("nFileResult");
      state.n = (!fileResult.classList.contains("hidden") && countEl.textContent)
        ? (parseInt(countEl.textContent.replace(/,/g, ""), 10) || null)
        : null;
    }
  });
});

// ── File Upload ─────────────────────────────────────────
function readFileRowCount(file) {
  return new Promise((resolve, reject) => {
    const name = (file.name || "").toLowerCase();

    if (name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const lines = (e.target.result || "").split(/\r?\n/).filter(l => l.trim() !== "");
        resolve(Math.max(0, lines.length - 1));
      };
      reader.onerror = reject;
      reader.readAsText(file);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (typeof XLSX !== "undefined") {
        const reader = new FileReader();
        reader.onload = (e) => {
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
      } else {
        reject(new Error("XLSX library not loaded yet. Try again in a moment or use CSV."));
      }
    } else {
      reject(new Error("Unsupported file type. Use CSV or Excel (.xlsx/.xls)."));
    }
  });
}

async function handleNFile(file) {
  if (!file) return;
  const dropText = $("nFileDrop").querySelector(".cochran-file-drop-text");
  if (dropText) dropText.textContent = "Reading...";

  try {
    const count = await readFileRowCount(file);
    $("nFileName").textContent = file.name;
    $("nFileCount").textContent = count.toLocaleString();
    $("nFileResult").classList.remove("hidden");
    $("nFileDrop").classList.add("hidden");
    state.n = count;
  } catch (err) {
    alert("Failed to read file: " + err.message);
  } finally {
    if (dropText) dropText.textContent = "Drop file here or";
  }
}

// Browse button — only triggers file input, NOT the drop zone click
$("nFileBrowse").addEventListener("click", (e) => {
  e.stopPropagation();
  $("nFileInput").click();
});

$("nFileInput").addEventListener("change", () => {
  const f = $("nFileInput").files[0];
  if (f) handleNFile(f);
  $("nFileInput").value = "";
});

$("nFileClear").addEventListener("click", () => {
  $("nFileResult").classList.add("hidden");
  $("nFileDrop").classList.remove("hidden");
  $("nFileName").textContent = "";
  $("nFileCount").textContent = "";
  state.n = null;
});

// Drag & drop on the drop zone only
const dropZone = $("nFileDrop");
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const f = e.dataTransfer.files[0];
  if (f) handleNFile(f);
});
// Drop zone click opens file picker (but not if Browse btn was clicked)
dropZone.addEventListener("click", (e) => {
  if (e.target === $("nFileBrowse") || $("nFileBrowse").contains(e.target)) return;
  $("nFileInput").click();
});

// ── Drawer ──────────────────────────────────────────────
function setupDrawer() {
  const drawer = $("drawer");
  const backdrop = $("drawerBackdrop");
  const toggle = $("drawerToggle");
  const close = $("drawerClose");
  if (!drawer || !backdrop || !toggle || !close) return;

  toggle.addEventListener("click", () => { drawer.classList.add("open"); backdrop.classList.remove("hidden"); });
  close.addEventListener("click", () => { drawer.classList.remove("open"); backdrop.classList.add("hidden"); });
  backdrop.addEventListener("click", () => { drawer.classList.remove("open"); backdrop.classList.add("hidden"); });
}

// ── Load SheetJS ─────────────────────────────────────────
function loadSheetJS() {
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  document.head.appendChild(s);
}

// ── Init ────────────────────────────────────────────────
setupDrawer();
loadSheetJS();
