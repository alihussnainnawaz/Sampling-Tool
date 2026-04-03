//static/appender.js
const $ = (id) => document.getElementById(id);
let CFG = null;
let APPEND_FILES = [];

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function setupDrawer(){
  const drawer = $("drawer");
  const backdrop = $("drawerBackdrop");
  const toggle = $("drawerToggle");
  const close = $("drawerClose");
  if (!drawer || !backdrop || !toggle || !close) return;

  function openDrawer(){ drawer.classList.add("open"); backdrop.classList.remove("hidden"); }
  function closeDrawer(){ drawer.classList.remove("open"); backdrop.classList.add("hidden"); }

  toggle.addEventListener("click", openDrawer);
  close.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
}

function renderUserDropdown(){
  const sel = $("userSelect");
  if (!sel) return;
  const users = CFG.users || ["Shumail Mehmood"];
  const saved = localStorage.getItem("sampling_current_user");
  const selected = users.includes(saved) ? saved : (CFG.default_user || users[0]);
  sel.innerHTML = "";
  users.forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    if (u === selected) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => localStorage.setItem("sampling_current_user", sel.value));
  localStorage.setItem("sampling_current_user", selected);
}

function updateAppendInfo(){
  const info = $("appendInfo");
  if (!info) return;
  if (!APPEND_FILES.length) {
    info.textContent = "No files selected yet.";
    return;
  }
  info.textContent = `${APPEND_FILES.length} file(s) selected.`;
}

function moveFile(index, direction){
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= APPEND_FILES.length) return;
  const temp = APPEND_FILES[index];
  APPEND_FILES[index] = APPEND_FILES[newIndex];
  APPEND_FILES[newIndex] = temp;
  renderFileList();
}

function removeFile(index){
  APPEND_FILES.splice(index, 1);
  renderFileList();
}

function applyConditionalSort(){
  const condition = $("sortCondition").value || "filename";
  const direction = $("sortDirection").value || "asc";
  const reverse = direction === "desc";

  if (condition === "filename") {
    APPEND_FILES.sort((a, b) => {
      const first = (a.name || "").toLowerCase();
      const second = (b.name || "").toLowerCase();
      return reverse ? second.localeCompare(first) : first.localeCompare(second);
    });
  }
  renderFileList();
}

function renderFileList(){
  const box = $("appendFileList");
  box.innerHTML = "";
  updateAppendInfo();

  if (!APPEND_FILES.length) {
    box.innerHTML = '<div class="subtext">Add files to start appending.</div>';
    return;
  }

  APPEND_FILES.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "append-file-row";
    row.innerHTML = `
      <div class="append-file-meta">
        <div class="append-file-name">${file.name}</div>
        <div class="subtext">Position ${index + 1} • ${(file.size / 1024).toFixed(1)} KB</div>
      </div>
      <div class="append-file-actions">
        <button type="button" class="btn" data-act="up">↑</button>
        <button type="button" class="btn" data-act="down">↓</button>
        <button type="button" class="btn" data-act="remove">Remove</button>
      </div>
    `;

    row.querySelector('[data-act="up"]').addEventListener('click', () => moveFile(index, -1));
    row.querySelector('[data-act="down"]').addEventListener('click', () => moveFile(index, 1));
    row.querySelector('[data-act="remove"]').addEventListener('click', () => removeFile(index));
    box.appendChild(row);
  });
}

function setupFiles(){
  const input = $("appendFiles");
  $("addFilesBtn").addEventListener("click", () => input.click());
  $("clearFilesBtn").addEventListener("click", () => {
    APPEND_FILES = [];
    input.value = "";
    renderFileList();
  });

  input.addEventListener("change", () => {
    const incoming = [...(input.files || [])];
    if (!incoming.length) return;
    APPEND_FILES.push(...incoming);
    renderFileList();
    if ($("sortMode").value === "conditional") applyConditionalSort();
    input.value = "";
  });
}

function setupSortUI(){
  const conditions = CFG.appender?.sort_conditions || ["filename"];
  const select = $("sortCondition");
  select.innerHTML = "";
  conditions.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    if (item === (CFG.appender?.default_sort_condition || "filename")) opt.selected = true;
    select.appendChild(opt);
  });

  $("sortMode").addEventListener("change", () => {
    const isConditional = $("sortMode").value === "conditional";
    select.disabled = !isConditional;
    $("sortDirection").disabled = !isConditional;
    if (isConditional) applyConditionalSort();
  });

  select.addEventListener("change", applyConditionalSort);
  $("sortDirection").addEventListener("change", applyConditionalSort);
  $("sortMode").dispatchEvent(new Event("change"));
}

async function appendAndDownload(){
  const msg = $("appendMsg");
  if (APPEND_FILES.length < 2) {
    msg.textContent = "Select at least 2 files.";
    return;
  }

  msg.textContent = "Preparing appended file...";
  const fd = new FormData();
  APPEND_FILES.forEach((file) => fd.append("files", file, file.name));
  fd.append("sort_mode", $("sortMode").value || "manual");
  fd.append("sort_condition", $("sortCondition").value || "filename");
  fd.append("sort_direction", $("sortDirection").value || "asc");

  const r = await fetch("/api/appender/append", { method: "POST", body: fd });
  if (!r.ok) {
    msg.textContent = "Append failed.";
    return;
  }

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "appended_output.xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  msg.textContent = "Downloaded appended file.";
}

async function init(){
  CFG = await getJSON("/api/config");
  setupDrawer();
  renderUserDropdown();
  setupFiles();
  setupSortUI();
  renderFileList();
  $("appendDownloadBtn").addEventListener("click", appendAndDownload);
}

init().catch(console.error);
