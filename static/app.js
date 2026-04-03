// static/app.js - Complete File with Conditional Filtering

let CFG = null;
let DEPTH = [];
let SELECTED = {};
let OPTIONS = {};
let QUOTA = {};
let SEARCH_TIMER = null;

let PROFILE_LIST = [];
let PROFILE_TIMER = null;
let PROFILE_ACTIVE_INDEX = -1;
let PROFILE_VISIBLE_RESULTS = [];
let PROFILE_SUGGESTION = null;
let PROFILE_SKIP_PREDICT_ONCE = false;

const $ = (id) => document.getElementById(id);

async function getJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids) {
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}

function cssSafe(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function setDatasetInfo(text) {
  const n = $("datasetInfo");
  if (n) n.textContent = text;
}

/* ===========================
   Conditional Filtering (Real-time)
=========================== */

async function loadConditionalFilterInfo() {
  const listEl = $("conditionalFiltersList");
  const countEl = $("filteredCount");
  if (!listEl || !countEl) return;

  try {
    const cfg = await getJSON("/api/config");
    const rules = cfg.mask_rules || [];

    listEl.innerHTML = "";

    if (rules.length === 0) {
      listEl.innerHTML = `<div class="subtext">No conditional filters are currently active.</div>`;
      countEl.textContent = "";
      return;
    }

    const container = el("div", { class: "rules" });

    rules.forEach(r => {
      const opMap = {
        "==": "=", "eq": "=", "equals": "=",
        "!=": "≠", "neq": "≠",
        "in": "IN", "isin": "IN",
        "not in": "NOT IN", "notin": "NOT IN"
      };
      const opDisplay = opMap[r.op] || (r.op || "").toUpperCase();
      const valueStr = Array.isArray(r.values) ? r.values.join(", ") : (r.value || r.values || "");

      const row = el("div", { class: "rowitem" }, [
        el("div", { class: "left" }, [
          el("div", { class: "name" }, [`${r.col} ${opDisplay} ${valueStr}`])
        ])
      ]);
      container.appendChild(row);
    });

    listEl.appendChild(container);

    const info = await getJSON("/api/effective_rows");
    const total = info.total_rows || 0;
    const remaining = info.filtered_rows || 0;
    const hidden = total - remaining;

    countEl.innerHTML = hidden > 0
      ? `<span style="color:#ef4444;font-weight:700;">${hidden.toLocaleString()} rows hidden</span> by conditional filters <span style="color:#6b7280;">(${remaining.toLocaleString()} remaining)</span>`
      : `All rows are visible (no active filters)`;

  } catch (e) {
    console.error("Conditional filter load failed:", e);
    listEl.innerHTML = `<div class="subtext" style="color:#ef4444;">Failed to load conditional filter info</div>`;
    countEl.textContent = "";
  }
}

/* ===========================
   Profile (Original Code)
=========================== */

function setProfileMsg(t) {
  const n = $("profileMsg");
  if (n) n.textContent = t || "";
}

function setProfileMsgShort(msg) {
  setProfileMsg(msg);
  setTimeout(() => setProfileMsg(""), 1200);
}

async function refreshProfiles() {
  const data = await getJSON("/api/profiles");
  PROFILE_LIST = data.profiles || [];
}

function scoreProfileName(name, query) {
  const n = (name || "").toLowerCase();
  const q = (query || "").toLowerCase().trim();

  if (!q) return 1;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900;
  if (n.includes(q)) return 700;

  const tokens = n.split(/[\s_-]+/);
  if (tokens.some(t => t.startsWith(q))) return 650;

  return -1;
}

function getRankedProfiles(query) {
  return [...PROFILE_LIST]
    .map((p) => ({ ...p, _score: scoreProfileName(p.name, query) }))
    .filter((p) => p._score >= 0)
    .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name))
    .slice(0, 10);
}

function getBestProfileMatch(query) {
  const ranked = getRankedProfiles(query);
  return ranked.length ? ranked[0] : null;
}

function hideProfileResults() {
  const box = $("profileResults");
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  PROFILE_ACTIVE_INDEX = -1;
  PROFILE_VISIBLE_RESULTS = [];
  PROFILE_SUGGESTION = null;
}

function setProfileActive(index) {
  const box = $("profileResults");
  if (!box) return;

  const items = [...box.querySelectorAll(".profile-item")];
  items.forEach((el, i) => el.classList.toggle("active", i === index));
  PROFILE_ACTIVE_INDEX = index;

  if (items[index]) items[index].scrollIntoView({ block: "nearest" });
}

function applyInlineProfileSuggestion() {
  const input = $("profileSearch");
  if (!input) return;

  const raw = input.value || "";
  const q = raw.trim();
  if (!q) {
    PROFILE_SUGGESTION = null;
    return;
  }

  const best = getBestProfileMatch(q);
  if (!best) {
    PROFILE_SUGGESTION = null;
    return;
  }

  const bestName = best.name;
  if (bestName.toLowerCase().startsWith(raw.toLowerCase()) && bestName.length > raw.length) {
    PROFILE_SUGGESTION = bestName;
    const start = raw.length;
    const end = bestName.length;
    input.value = bestName;
    input.setSelectionRange(start, end);
  } else {
    PROFILE_SUGGESTION = best.name;
  }
}

async function selectProfileResult(item) {
  if (!item) return;

  if (item.type === "existing") {
    const data = await getJSON(`/api/profiles/${encodeURIComponent(item.name)}`);
    await applyProfile(data.profile);
    $("profileSearch").value = item.name;
    hideProfileResults();
    setProfileMsgShort("Loaded.");
    return;
  }

  if (item.type === "create") {
    const payload = currentProfilePayload();

    await getJSON("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: item.name, profile: payload })
    });

    await refreshProfiles();
    $("profileSearch").value = item.name;
    hideProfileResults();
    setProfileMsgShort("Saved.");
  }
}

function renderProfileResults(q) {
  const box = $("profileResults");
  if (!box) return;

  box.innerHTML = "";
  PROFILE_ACTIVE_INDEX = -1;
  PROFILE_VISIBLE_RESULTS = [];

  const query = (q || "").trim();
  const ranked = getRankedProfiles(query);

  ranked.forEach((p) => {
    const rowMeta = { type: "existing", name: p.name };
    PROFILE_VISIBLE_RESULTS.push(rowMeta);

    const nameEl = el("span", {}, [p.name]);
    const delEl = el("span", { class: "profile-del" }, ["×"]);
    const item = el("div", { class: "profile-item" }, [nameEl, delEl]);

    item.addEventListener("click", async () => {
      await selectProfileResult(rowMeta);
    });

    delEl.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = confirm(`Delete profile "${p.name}" ?`);
      if (!ok) return;

      await fetch(`/api/profiles/${encodeURIComponent(p.name)}`, { method: "DELETE" });
      await refreshProfiles();
      renderProfileResults($("profileSearch")?.value || "");
    });

    box.appendChild(item);
  });

  const exactExists = ranked.some((p) => p.name.toLowerCase() === query.toLowerCase());

  if (query && !exactExists) {
    const createMeta = { type: "create", name: query };
    PROFILE_VISIBLE_RESULTS.push(createMeta);

    const create = el("div", { class: "profile-item" }, [
      el("span", { style: "font-weight:800" }, [`Create "${query}"`])
    ]);

    create.addEventListener("click", async () => {
      await selectProfileResult(createMeta);
    });

    box.appendChild(create);
  }

  if (PROFILE_VISIBLE_RESULTS.length === 0) {
    box.appendChild(el("div", { class: "profile-item" }, [
      el("span", { style: "color:#6b7280" }, ["No profiles found"])
    ]));
  }

  box.classList.remove("hidden");
}

function currentProfilePayload() {
  const last = DEPTH[DEPTH.length - 1];
  const minCount = Number($("minCount")?.value || (CFG.defaults?.min_count ?? 50));
  const sampleCount = Number($("sampleCount")?.value || (CFG.defaults?.sample_count ?? 50));
  const addedBy = $("userSelect")?.value || CFG.default_user || "Shumail Mehmood";

  return {
    depth_levels: DEPTH,
    selected: SELECTED,
    min_count: Number.isFinite(minCount) ? minCount : 0,
    sample_count: Number.isFinite(sampleCount) ? sampleCount : 0,
    quota: QUOTA[last] || {},
    added_by: addedBy,
  };
}

async function applyProfile(profile) {
  if (!profile) return;

  const cfgLevels = CFG.levels || ["DISTRICT"];
  const pDepth = (profile.depth_levels || []).filter((l) => cfgLevels.includes(l));
  const depthToUse = pDepth.length ? pDepth : cfgLevels.slice(0, 1);

  DEPTH = depthToUse;
  SELECTED = {};
  OPTIONS = {};
  QUOTA = {};

  renderDepthButtons();
  renderCards();

  for (const lvl of DEPTH) {
    SELECTED[lvl] = ((profile.selected || {})[lvl] || []).map(String);
  }

  await hydrateOptionsChain();

  const last = DEPTH[DEPTH.length - 1];
  QUOTA[last] = { ...(profile.quota || {}) };

  const minEl = $("minCount");
  const scEl = $("sampleCount");
  if (minEl) minEl.value = profile.min_count ?? (CFG.defaults?.min_count ?? 50);
  if (scEl) scEl.value = profile.sample_count ?? (CFG.defaults?.sample_count ?? 50);

  renderOptions(last);
  updateReadyCount();
  await loadConditionalFilterInfo();   // Added
}

async function resetAllFilters() {
  SELECTED = {};
  OPTIONS = {};
  QUOTA = {};
  renderCards();
  await hydrateOptionsChain();
  updateReadyCount();
  await loadConditionalFilterInfo();   // Added
}

function setupProfileUI() {
  const updateBtn = $("profileUpdateBtn");
  const resetBtn = $("resetFiltersBtn");

  updateBtn?.addEventListener("click", async () => {
    const input = $("profileSearch");
    const inputVal = (input?.value || "").trim();
    if (!inputVal) {
      setProfileMsgShort("Type/select a profile first.");
      return;
    }

    const exact = PROFILE_LIST.find((p) => p.name.toLowerCase() === inputVal.toLowerCase());
    if (!exact) {
      setProfileMsgShort("Select an existing profile to update.");
      return;
    }

    try {
      await getJSON("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: exact.name,
          profile: currentProfilePayload()
        })
      });

      await refreshProfiles();
      input.value = exact.name;
      setProfileMsgShort("Updated.");
    } catch {
      setProfileMsgShort("Update failed.");
    }
  });

  resetBtn?.addEventListener("click", async () => {
    setProfileMsg("Resetting...");
    try {
      await resetAllFilters();
      setProfileMsgShort("Reset done.");
    } catch {
      setProfileMsgShort("Reset failed.");
    }
  });
}

function setupProfileSearch() {
  const input = $("profileSearch");
  const box = $("profileResults");

  if (!input || !box) return;

  input.addEventListener("input", (e) => {
    const q = input.value || "";
    PROFILE_SUGGESTION = null;
    clearTimeout(PROFILE_TIMER);

    const isDeletion =
      e.inputType === "deleteContentBackward" ||
      e.inputType === "deleteContentForward";

    PROFILE_TIMER = setTimeout(() => {
      renderProfileResults(q);

      if (isDeletion || PROFILE_SKIP_PREDICT_ONCE) {
        PROFILE_SKIP_PREDICT_ONCE = false;
        return;
      }

      applyInlineProfileSuggestion();
    }, 120);
  });

  input.addEventListener("focus", () => {
    renderProfileResults(input.value || "");
    applyInlineProfileSuggestion();
  });

  input.addEventListener("keydown", async (e) => {
    const resultsOpen = !box.classList.contains("hidden");
    const maxIndex = PROFILE_VISIBLE_RESULTS.length - 1;

    if (e.key === "Backspace" || e.key === "Delete") {
      PROFILE_SKIP_PREDICT_ONCE = true;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!resultsOpen) renderProfileResults(input.value || "");
      if (maxIndex >= 0) {
        const next = PROFILE_ACTIVE_INDEX < maxIndex ? PROFILE_ACTIVE_INDEX + 1 : 0;
        setProfileActive(next);
        const active = PROFILE_VISIBLE_RESULTS[next];
        if (active?.name) {
          input.value = active.name;
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!resultsOpen) renderProfileResults(input.value || "");
      if (maxIndex >= 0) {
        const prev = PROFILE_ACTIVE_INDEX > 0 ? PROFILE_ACTIVE_INDEX - 1 : maxIndex;
        setProfileActive(prev);
        const active = PROFILE_VISIBLE_RESULTS[prev];
        if (active?.name) {
          input.value = active.name;
          input.setSelectionRange(input.value.length, input.value.length);
        }
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();

      const q = (input.value || "").trim();
      if (!q) return;

      if (PROFILE_ACTIVE_INDEX >= 0 && PROFILE_VISIBLE_RESULTS[PROFILE_ACTIVE_INDEX]) {
        await selectProfileResult(PROFILE_VISIBLE_RESULTS[PROFILE_ACTIVE_INDEX]);
        return;
      }

      const exact = PROFILE_LIST.find((p) => p.name.toLowerCase() === q.toLowerCase());
      if (exact) {
        await selectProfileResult({ type: "existing", name: exact.name });
        return;
      }

      const best = getBestProfileMatch(q);
      if (best) {
        await selectProfileResult({ type: "existing", name: best.name });
        return;
      }

      await selectProfileResult({ type: "create", name: q });
      return;
    }

    if (e.key === "Tab") {
      if (PROFILE_SUGGESTION) {
        const suggestion = PROFILE_SUGGESTION;
        input.value = suggestion;
        input.setSelectionRange(input.value.length, input.value.length);
        renderProfileResults(input.value);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Escape") {
      hideProfileResults();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".profile-combo")) {
      hideProfileResults();
    }
  });
}

/* ===========================
   Dataset search (Original)
=========================== */

function hideSearchResults() {
  const box = $("searchResults");
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
}

function showSearchResults(results) {
  const box = $("searchResults");
  if (!box) return;

  box.innerHTML = "";

  if (!results.length) {
    box.appendChild(el("div", { class: "search-empty" }, ["No matches found"]));
    box.classList.remove("hidden");
    return;
  }

  results.forEach((r) => {
    const item = el("button", { class: "search-item", type: "button" }, [
      el("div", { class: "search-item-title" }, [r.label]),
      el("div", { class: "search-item-meta" }, [`${r.level} • ${r.path}`]),
    ]);

    item.addEventListener("click", async () => {
      DEPTH = r.depth_levels.slice();
      SELECTED = {};
      OPTIONS = {};
      QUOTA = {};

      for (const [lvl, vals] of Object.entries(r.selected || {})) {
        SELECTED[lvl] = (vals || []).map(String);
      }

      renderDepthButtons();
      renderCards();
      await hydrateOptionsChain();

      hideSearchResults();
      const input = $("quickSearch");
      if (input) input.value = r.path;
    });

    box.appendChild(item);
  });

  box.classList.remove("hidden");
}

async function runSearch(query) {
  if (!query.trim()) {
    hideSearchResults();
    return;
  }

  try {
    const data = await getJSON(`/api/search_options?q=${encodeURIComponent(query)}&limit=12`);
    showSearchResults(data.results || []);
  } catch {
    hideSearchResults();
  }
}

function setupSearchUI() {
  const input = $("quickSearch");
  const box = $("searchResults");
  if (!input || !box) return;

  input.addEventListener("input", () => {
    const q = input.value || "";
    clearTimeout(SEARCH_TIMER);
    SEARCH_TIMER = setTimeout(() => runSearch(q), 180);
  });

  input.addEventListener("focus", () => {
    if ((input.value || "").trim()) runSearch(input.value);
  });

  document.addEventListener("click", (e) => {
    const wrap = e.target.closest(".search-wrap");
    if (!wrap) hideSearchResults();
  });
}

/* ===========================
   Current level quick search (Original)
=========================== */

let LEVEL_ACTIVE_INDEX = -1;
let LEVEL_VISIBLE_RESULTS = [];
let LEVEL_SUGGESTION = null;
let LEVEL_SKIP_PREDICT_ONCE = false;

function getCommittedLevelOptions() {
  const last = DEPTH[DEPTH.length - 1];
  const opts = OPTIONS[last] || [];
  const selectedKeys = new Set((SELECTED[last] || []).map(String));

  return opts.filter((o) => selectedKeys.has(String(o.key ?? o.value)));
}

function getCommittedLevelLabels() {
  return getCommittedLevelOptions().map((o) => String(o.value));
}

function composeLevelSearchValue(token = "") {
  const labels = getCommittedLevelLabels();
  const cleanToken = String(token || "");

  if (!labels.length) return cleanToken;
  if (!cleanToken) return `${labels.join(", ")}, `;
  return `${labels.join(", ")}, ${cleanToken}`;
}

function getCurrentLevelToken(raw) {
  const input = String(raw || "");
  const labels = getCommittedLevelLabels();

  if (!labels.length) {
    const parts = input.split(",");
    return (parts[parts.length - 1] || "").trim();
  }

  const prefix = `${labels.join(", ")}, `;
  if (input.toLowerCase().startsWith(prefix.toLowerCase())) {
    return input.slice(prefix.length).trim();
  }

  const parts = input.split(",");
  return (parts[parts.length - 1] || "").trim();
}

function setLevelInputToken(token, selectFrom = null) {
  const { input } = getCurrentLevelSearchState();
  if (!input) return;

  const value = composeLevelSearchValue(token);
  input.value = value;

  const end = value.length;
  const start = selectFrom === null ? end : selectFrom;
  input.setSelectionRange(start, end);
}

function syncLevelSearchInputFromSelected() {
  const { input } = getCurrentLevelSearchState();
  if (!input) return;
  input.value = composeLevelSearchValue("");
}

function scoreLevelOption(text, query) {
  const t = (text || "").toLowerCase();
  const q = (query || "").toLowerCase().trim();

  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900;
  if (t.includes(q)) return 700;

  const tokens = t.split(/[\s_-]+/);
  if (tokens.some(tok => tok.startsWith(q))) return 650;

  return -1;
}

function getCurrentLevelSearchState() {
  const last = DEPTH[DEPTH.length - 1];
  return {
    level: last,
    input: $("levelSearch"),
    box: $("levelSearchResults"),
    opts: OPTIONS[last] || []
  };
}

function getLevelOptionKey(option) {
  const last = DEPTH[DEPTH.length - 1];
  return String(last === DEPTH[DEPTH.length - 1] ? (option.key ?? option.value) : option.value);
}

function hideLevelSearchResults() {
  const { box } = getCurrentLevelSearchState();
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  LEVEL_ACTIVE_INDEX = -1;
  LEVEL_VISIBLE_RESULTS = [];
  LEVEL_SUGGESTION = null;
}

function setLevelActive(index) {
  const { box } = getCurrentLevelSearchState();
  if (!box) return;

  const items = [...box.querySelectorAll(".level-search-item")];
  items.forEach((el, i) => el.classList.toggle("active", i === index));
  LEVEL_ACTIVE_INDEX = index;

  if (items[index]) items[index].scrollIntoView({ block: "nearest" });
}

function getRankedLevelOptions(query) {
  const { opts } = getCurrentLevelSearchState();
  const q = String(query || "").trim();
  const selectedKeys = new Set(
    ((SELECTED[DEPTH[DEPTH.length - 1]] || []).map(String))
  );

  return [...opts]
    .filter((o) => !selectedKeys.has(String(o.key ?? o.value)))
    .map((o) => ({
      ...o,
      _score: q
        ? Math.max(
            scoreLevelOption(o.value, q),
            scoreLevelOption(o.path || "", q)
          )
        : 1
    }))
    .filter((o) => o._score >= 0)
    .sort((a, b) => b._score - a._score || String(a.value).localeCompare(String(b.value)))
    .slice(0, 12);
}

function getBestLevelMatch(query) {
  const ranked = getRankedLevelOptions(query);
  return ranked.length ? ranked[0] : null;
}

function applyInlineLevelSuggestion() {
  const { input } = getCurrentLevelSearchState();
  if (!input) return;

  const rawToken = getCurrentLevelToken(input.value || "");
  if (!rawToken) {
    LEVEL_SUGGESTION = null;
    return;
  }

  const best = getBestLevelMatch(rawToken);
  if (!best) {
    LEVEL_SUGGESTION = null;
    return;
  }

  const bestName = String(best.value);
  if (bestName.toLowerCase().startsWith(rawToken.toLowerCase()) && bestName.length > rawToken.length) {
    LEVEL_SUGGESTION = best;
    const prefix = composeLevelSearchValue("");
    const full = composeLevelSearchValue(bestName);

    input.value = full;
    input.setSelectionRange(prefix.length + rawToken.length, full.length);
  } else {
    LEVEL_SUGGESTION = best;
  }
}

function selectCurrentLevelOption(option) {
  if (!option) return;

  const last = DEPTH[DEPTH.length - 1];
  const key = String(option.key ?? option.value);
  const def = defaultQuotaValue();

  if (!SELECTED[last]) SELECTED[last] = [];
  if (!SELECTED[last].includes(key)) {
    SELECTED[last].push(key);
  }

  if (!QUOTA[last]) QUOTA[last] = {};
  if (!(key in QUOTA[last])) {
    QUOTA[last][key] = Math.min(def, Number(option.count || 0));
  }

  renderOptions(last);
  updateReadyCount();
  syncLevelSearchInputFromSelected();
  hideLevelSearchResults();
}

function renderLevelSearchResults(q) {
  const { box } = getCurrentLevelSearchState();
  if (!box) return;

  box.innerHTML = "";
  LEVEL_ACTIVE_INDEX = -1;
  LEVEL_VISIBLE_RESULTS = [];

  const token = getCurrentLevelToken(q);
  const ranked = getRankedLevelOptions(token);

  if (!ranked.length) {
    box.appendChild(el("div", { class: "search-empty" }, ["No matches found"]));
    box.classList.remove("hidden");
    return;
  }

  ranked.forEach((o) => {
    LEVEL_VISIBLE_RESULTS.push(o);

    const item = el("div", { class: "level-search-item" }, [
      el("div", { class: "search-item-title" }, [String(o.value)]),
      el("div", { class: "search-item-meta" }, [String(o.path || o.value)]),
    ]);

    item.addEventListener("click", () => {
      selectCurrentLevelOption(o);
    });

    box.appendChild(item);
  });

  box.classList.remove("hidden");
}

function setupLevelSearchUI() {
  document.addEventListener("input", (e) => {
    if (e.target?.id !== "levelSearch") return;

    const input = e.target;
    const q = input.value || "";
    const isDeletion =
      e.inputType === "deleteContentBackward" ||
      e.inputType === "deleteContentForward";

    if (!q.trim()) {
      hideLevelSearchResults();
      return;
    }

    setTimeout(() => {
      renderLevelSearchResults(q);
      if (isDeletion || LEVEL_SKIP_PREDICT_ONCE) {
        LEVEL_SKIP_PREDICT_ONCE = false;
        return;
      }
      applyInlineLevelSuggestion();
    }, 80);
  });

  document.addEventListener("focusin", (e) => {
    if (e.target?.id !== "levelSearch") return;
    const input = e.target;
    if ((input.value || "").trim()) {
      renderLevelSearchResults(input.value);
      applyInlineLevelSuggestion();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target?.id !== "levelSearch") return;

    const { box, input } = getCurrentLevelSearchState();
    const resultsOpen = box && !box.classList.contains("hidden");
    const maxIndex = LEVEL_VISIBLE_RESULTS.length - 1;

    if (e.key === "Backspace" || e.key === "Delete") {
      LEVEL_SKIP_PREDICT_ONCE = true;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!resultsOpen) renderLevelSearchResults(input.value || "");
      if (maxIndex >= 0) {
        const next = LEVEL_ACTIVE_INDEX < maxIndex ? LEVEL_ACTIVE_INDEX + 1 : 0;
        setLevelActive(next);
        const active = LEVEL_VISIBLE_RESULTS[next];
        if (active?.value) {
          setLevelInputToken(String(active.value));
        }
      }
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!resultsOpen) renderLevelSearchResults(input.value || "");
      if (maxIndex >= 0) {
        const prev = LEVEL_ACTIVE_INDEX > 0 ? LEVEL_ACTIVE_INDEX - 1 : maxIndex;
        setLevelActive(prev);
        const active = LEVEL_VISIBLE_RESULTS[prev];
        if (active?.value) {
          setLevelInputToken(String(active.value));
        }
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();

      const q = getCurrentLevelToken(input.value || "");
      if (!q) return;

      if (LEVEL_ACTIVE_INDEX >= 0 && LEVEL_VISIBLE_RESULTS[LEVEL_ACTIVE_INDEX]) {
        selectCurrentLevelOption(LEVEL_VISIBLE_RESULTS[LEVEL_ACTIVE_INDEX]);
        return;
      }

      const best = getBestLevelMatch(q);
      if (best) {
        selectCurrentLevelOption(best);
      }
      return;
    }

    if (e.key === "Tab") {
      if (LEVEL_SUGGESTION) {
        setLevelInputToken(String(LEVEL_SUGGESTION.value));
        renderLevelSearchResults(input.value);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Escape") {
      hideLevelSearchResults();
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".level-search-wrap")) {
      hideLevelSearchResults();
    }
  });
}

/* ===========================
   Ready count & Main UI (Original)
=========================== */

function getOptionKey(level, option) {
  const isLast = DEPTH[DEPTH.length - 1] === level;
  return String(isLast ? (option.key ?? option.value) : option.value);
}

function updateReadyCount() {
  const elCount = $("readyCount");
  if (!elCount) return;

  const last = DEPTH[DEPTH.length - 1];
  const opts = OPTIONS[last] || [];
  const selected = new Set(SELECTED[last] || []);
  const q = QUOTA[last] || {};

  const avail = new Map(
    opts.map((o) => [String(o.key ?? o.value), Number(o.count || 0)])
  );

  let total = 0;
  for (const g of selected) {
    const want = Number(q[g] || 0);
    const maxAvail = Number(avail.get(String(g)) || 0);
    total += Math.max(0, Math.min(want, maxAvail));
  }

  elCount.textContent = String(total);
}

function setupDrawer() {
  const drawer = $("drawer");
  const backdrop = $("drawerBackdrop");
  const toggle = $("drawerToggle");
  const close = $("drawerClose");
  if (!drawer || !backdrop || !toggle || !close) return;

  function openDrawer() {
    drawer.classList.add("open");
    backdrop.classList.remove("hidden");
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.add("hidden");
  }

  toggle.addEventListener("click", openDrawer);
  close.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
}

function renderUserDropdown() {
  const sel = $("userSelect");
  if (!sel) return;

  sel.innerHTML = "";
  const users = CFG.users || ["Shumail Mehmood"];
  const saved = localStorage.getItem("sampling_current_user");
  const selectedUser = users.includes(saved) ? saved : (CFG.default_user || users[0]);

  users.forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    if (u === selectedUser) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.addEventListener("change", () => {
    localStorage.setItem("sampling_current_user", sel.value);
  });

  localStorage.setItem("sampling_current_user", selectedUser);
}

function renderDepthButtons() {
  const row = $("depthButtons");
  if (!row) return;

  row.innerHTML = "";

  (CFG.levels || ["DISTRICT"]).forEach((lvl, i) => {
    const isActive = i === DEPTH.length - 1;
    const btn = el("button", { class: "pill" + (isActive ? " active" : "") }, [lvl]);
    btn.addEventListener("click", () => {
      setDepth(i);
    });
    row.appendChild(btn);
  });
}

function setDepth(i) {
  DEPTH = (CFG.levels || ["DISTRICT"]).slice(0, i + 1);

  const keep = new Set(DEPTH);
  for (const k of Object.keys(SELECTED)) {
    if (!keep.has(k)) delete SELECTED[k];
  }

  const last = DEPTH[DEPTH.length - 1];
  const oldLastQuota = QUOTA[last] || {};

  OPTIONS = {};
  QUOTA = {};
  QUOTA[last] = oldLastQuota;

  renderDepthButtons();
  renderCards();
  hydrateOptionsChain();
  updateReadyCount();
}

function clearDownstream(fromLevel) {
  const idx = DEPTH.indexOf(fromLevel);
  if (idx === -1) return;

  for (let j = idx + 1; j < DEPTH.length; j++) {
    delete SELECTED[DEPTH[j]];
    delete OPTIONS[DEPTH[j]];
  }

  const last = DEPTH[DEPTH.length - 1];
  if (fromLevel !== last) {
    delete QUOTA[last];
  }
}

function defaultQuotaValue() {
  const v = Number($("sampleCount")?.value || (CFG.defaults?.sample_count ?? 50));
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

function renderCards() {
  const grid = $("cards");
  if (!grid) return;

  grid.innerHTML = "";

  DEPTH.forEach((lvl, i) => {
    const isLast = i === DEPTH.length - 1;

    const list = el("div", { class: "list", id: `list-${lvl}` }, [
      el("div", { class: "subtext" }, ["Loading..."]),
    ]);

    const right = el("label", { class: "select-all" }, [
      el("input", { type: "checkbox", id: `selectall-${lvl}` }),
      el("span", {}, ["Select All"]),
    ]);

    right.querySelector("input").addEventListener("change", async (e) => {
      const checked = e.target.checked;
      const opts = OPTIONS[lvl] || [];
      const lastLevel = DEPTH[DEPTH.length - 1];

      if (lvl === lastLevel) {
        if (!QUOTA[lvl]) QUOTA[lvl] = {};
        const def = defaultQuotaValue();

        if (checked) {
          SELECTED[lvl] = opts.map((x) => String(x.key ?? x.value));
          opts.forEach((x) => {
            const key = String(x.key ?? x.value);
            if (!(key in QUOTA[lvl])) {
              QUOTA[lvl][key] = Math.min(def, Number(x.count || 0));
            }
          });
        } else {
          SELECTED[lvl] = [];
          QUOTA[lvl] = {};
        }

        renderOptions(lvl);
        updateReadyCount();
      } else {
        SELECTED[lvl] = checked ? opts.map((x) => String(x.value)) : [];
        clearDownstream(lvl);
        renderOptions(lvl);
        await hydrateOptionsChain();
      }
    });

    const head = el("div", { class: "hcard-head" }, [
      el("div", {}, [
        el("div", { class: "hcard-title" }, [lvl]),
        el("div", { class: "hcard-sub" }, [DEPTH.slice(0, i + 1).join(" | ")]),
      ]),
      right,
    ]);

    const card = el("div", { class: "hcard" }, [head]);

    if (isLast) {
      card.appendChild(
        el("div", { class: "quota-bar" }, [
          el("div", { class: "quota-inline" }, [
            el("div", { class: "mini-field" }, [
              el("div", { class: "mini-label" }, ["Min count"]),
              el("input", {
                id: "minCount",
                class: "mini-input",
                type: "number",
                min: "0",
                value: CFG.defaults?.min_count ?? 50,
                oninput: async () => {
                  updateReadyCount();
                  await hydrateOptionsChain();
                },
              }),
            ]),
            el("div", { class: "mini-field" }, [
              el("div", { class: "mini-label" }, ["Default quota per item"]),
              el("input", {
                id: "sampleCount",
                class: "mini-input",
                type: "number",
                min: "0",
                value: CFG.defaults?.sample_count ?? 50,
              }),
            ]),
          ]),
          el("div", { class: "quota-right" }, [
            el("div", { class: "ready-label" }, ["Ready to download"]),
            el("div", { class: "ready-count", id: "readyCount" }, ["0"]),
            el("div", { class: "ready-sub subtext" }, ["Sum of selected quotas"]),
          ]),
        ])
      );

      card.appendChild(
        el("div", { class: "level-search-wrap" }, [
          el("input", {
            id: "levelSearch",
            class: "level-search-input",
            type: "text",
            placeholder: `Search ${lvl}...`,
            autocomplete: "off",
          }),
          el("div", { id: "levelSearchResults", class: "search-results hidden" }, []),
        ])
      );
    }

    card.appendChild(list);

    if (isLast) {
      card.appendChild(
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", onclick: downloadSample }, ["Download"]),
          el("span", { id: "msg", class: "subtext" }, [""]),
        ])
      );
    }

    grid.appendChild(card);
  });
}

function updateSelections(level, value, checked) {
  const s = new Set((SELECTED[level] || []).map(String));
  checked ? s.add(String(value)) : s.delete(String(value));
  SELECTED[level] = [...s];
}

function renderOptions(level) {
  const box = $(`list-${level}`);
  const opts = OPTIONS[level] || [];
  if (!box) return;

  box.innerHTML = "";

  if (!opts.length) {
    box.appendChild(el("div", { class: "subtext" }, ["No options. Select parent values first."]));
    updateReadyCount();
    return;
  }

  const isLast = DEPTH[DEPTH.length - 1] === level;
  if (isLast && !QUOTA[level]) QUOTA[level] = {};

  const picked = new Set((SELECTED[level] || []).map(String));
  const def = defaultQuotaValue();

  opts.forEach((o) => {
    const displayValue = String(o.value);
    const groupKey = getOptionKey(level, o);
    const count = Number(o.count || 0);
    const path = String(o.path || displayValue);

    const cb = el("input", { type: "checkbox" });
    cb.checked = picked.has(groupKey);

    cb.addEventListener("change", async (e) => {
      if (isLast) {
        if (!QUOTA[level]) QUOTA[level] = {};

        if (e.target.checked) {
          if (!(groupKey in QUOTA[level])) {
            QUOTA[level][groupKey] = Math.min(def, count);
          }
        } else {
          delete QUOTA[level][groupKey];
        }

        updateSelections(level, groupKey, e.target.checked);
        renderOptions(level);
        updateReadyCount();
      } else {
        updateSelections(level, displayValue, e.target.checked);
        clearDownstream(level);

        if ((SELECTED[level] || []).length === 0) {
          renderOptions(level);
          updateReadyCount();
          return;
        }

        renderOptions(level);
        await hydrateOptionsChain();
        updateReadyCount();
      }
    });

    let rightSide;

    if (isLast) {
      if (!QUOTA[level]) QUOTA[level] = {};
      if (cb.checked && !(groupKey in QUOTA[level])) {
        QUOTA[level][groupKey] = Math.min(def, count);
      }

      const minusBtn = el("button", { class: "qbtn", type: "button" }, ["−"]);
      const plusBtn = el("button", { class: "qbtn", type: "button" }, ["+"]);
      const qVal = el("div", { class: "qval", id: `q-${cssSafe(groupKey)}` }, [
        String(QUOTA[level][groupKey] || 0),
      ]);

      minusBtn.disabled = !cb.checked;
      plusBtn.disabled = !cb.checked;

      minusBtn.addEventListener("click", () => {
        if (!cb.checked) return;
        QUOTA[level][groupKey] = Math.max(0, (QUOTA[level][groupKey] || 0) - 1);
        qVal.textContent = String(QUOTA[level][groupKey]);
        updateReadyCount();
      });

      plusBtn.addEventListener("click", () => {
        if (!cb.checked) return;
        QUOTA[level][groupKey] = Math.min(count, (QUOTA[level][groupKey] || 0) + 1);
        qVal.textContent = String(QUOTA[level][groupKey]);
        updateReadyCount();
      });

      rightSide = el("div", { class: "rightside" }, [
        el("div", { class: "quota-pill" }, [minusBtn, qVal, plusBtn]),
        el("div", { class: "count" }, [String(count)]),
      ]);
    } else {
      rightSide = el("div", { class: "count" }, [String(count)]);
    }

    box.appendChild(
      el("div", { class: "rowitem" }, [
        el("div", { class: "left" }, [
          cb,
          el("div", {}, [
            el("div", { class: "name", title: displayValue }, [displayValue]),
            el("div", { class: "rowpath" }, [path]),
          ]),
        ]),
        rightSide,
      ])
    );
  });

  const sa = document.getElementById(`selectall-${level}`);
  if (sa) sa.checked = opts.length > 0 && (SELECTED[level] || []).length === opts.length;

  if (isLast) {
    syncLevelSearchInputFromSelected();
  }
  updateReadyCount();
}

async function fetchOptions(level) {
  const minCount = Number($("minCount")?.value || (CFG.defaults?.min_count ?? 50));

  const body = {
    depth_levels: DEPTH,
    level,
    selected: SELECTED,
    min_count: minCount
  };

  const data = await getJSON("/api/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  OPTIONS[level] = data.options || [];
  renderOptions(level);
}

async function hydrateOptionsChain() {
  for (const lvl of DEPTH) {
    await fetchOptions(lvl);
  }
  updateReadyCount();
  await loadConditionalFilterInfo();   // Refresh conditional filtering info
}

/* ===========================
   Modal & Download
=========================== */

function showTestingModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById("testingModal");
    const closeBtn = document.getElementById("tmClose");
    const testingBtn = document.getElementById("tmTesting");
    const samplingBtn = document.getElementById("tmSampling");
    const backdrop = modal.querySelector(".modal-backdrop");

    function cleanup(val) {
      modal.classList.add("hidden");
      resolve(val);
    }

    closeBtn.onclick = () => cleanup(null);
    backdrop.onclick = () => cleanup(null);
    testingBtn.onclick = () => cleanup(true);
    samplingBtn.onclick = () => cleanup(false);

    modal.classList.remove("hidden");
  });
}

async function downloadSample() {
  const msg = $("msg");
  if (msg) msg.textContent = "Preparing download...";

  const minCount = Number($("minCount")?.value || 0);
  const sampleCount = Number($("sampleCount")?.value || 0);
  const addedBy = $("userSelect")?.value || CFG.default_user || "Shumail Mehmood";

  let testing = false;
  if (CFG.testing_prompt_enabled) {
    const choice = await showTestingModal();
    if (choice === null) {
      if (msg) msg.textContent = "Download cancelled.";
      return;
    }
    testing = choice;
  }

  const last = DEPTH[DEPTH.length - 1];
  const lastQuota = QUOTA[last] || {};

  const r = await fetch("/api/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      depth_levels: DEPTH,
      selected: SELECTED,
      min_count: minCount,
      sample_count: sampleCount,
      quota: lastQuota,
      added_by: addedBy,
      testing: testing,
    }),
  });

  if (!r.ok) {
    if (msg) msg.textContent = "Download failed.";
    return;
  }

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);

  let filename = "sample.xlsx";
  const disposition = r.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);

  if (match && match[1]) {
    filename = decodeURIComponent(match[1].replace(/"/g, "").trim());
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  try {
    const info = await getJSON("/api/dataset_info");
    if (info?.has_data) {
      setDatasetInfo(`Loaded ${info.rows} rows (${info.filename || "dataset"})`);
    }
  } catch {}

  OPTIONS = {};
  await hydrateOptionsChain();

  if (msg) {
    msg.textContent = testing
      ? "Downloaded (testing; not logged)."
      : "Downloaded & logged.";
  }
}

function setupUploadUI() {
  const input = $("fileInput");
  const uploadBtn = $("uploadBtn");

  async function uploadFile() {
    const f = input.files[0];
    if (!f) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";

    const fd = new FormData();
    fd.append("file", f);

    const r = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    const data = await r.json();

    uploadBtn.textContent = "Upload";
    uploadBtn.disabled = false;

    if (!data.ok) {
      setDatasetInfo(data.error || "Upload failed.");
      return;
    }

    setDatasetInfo(`Loaded ${data.rows} rows (${data.filename})`);

    SELECTED = {};
    OPTIONS = {};
    QUOTA = {};

    await hydrateOptionsChain();
    updateReadyCount();
    await loadConditionalFilterInfo();   // Added
  }

  uploadBtn.addEventListener("click", () => input.click());
  input.addEventListener("change", uploadFile);
}

/* ===========================
   Init
=========================== */

async function init() {
  try {
    CFG = await getJSON("/api/config");
    DEPTH = (CFG.levels || ["DISTRICT"]).slice(0, 1);

    setupDrawer();
    renderUserDropdown();
    renderDepthButtons();
    renderCards();
    setupUploadUI();
    setupProfileUI();
    setupProfileSearch();
    setupSearchUI();
    setupLevelSearchUI();

    await refreshProfiles();

    try {
      const info = await getJSON("/api/dataset_info");
      if (info?.has_data) {
        setDatasetInfo(`Loaded ${info.rows} rows (${info.filename || "dataset"})`);
      } else {
        setDatasetInfo("No dataset loaded yet.");
      }
    } catch {}

    await hydrateOptionsChain();
    updateReadyCount();
    await loadConditionalFilterInfo();

  } catch (err) {
    console.error(err);
    setDatasetInfo("Failed to load config or API.\nMake sure the Flask server is running.");
  }
}

init();