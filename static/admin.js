//static/admin.js
const $ = (id) => document.getElementById(id);

async function getJSON(url, opts = {}) {
  const response = await fetch(url, opts);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function createEl(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") {
      node.className = value;
    } else if (key === "text") {
      node.textContent = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }

  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

let CFG = {
  dataset: { uuid_col: "uuid" },
  levels: ["DISTRICT"],
  defaults: { min_count: 50, sample_count: 50 },
  mask_rules: [],
  users: ["Shumail Mehmood"],
  default_user: "Shumail Mehmood",
  testing_prompt_enabled: true,
};

function getRuleOperators() {
  return [
    { value: "isin", label: "In" },
    { value: "notin", label: "Not In" },
    { value: "eq", label: "Equals" },
    { value: "neq", label: "Not Equals" },
    { value: "contains", label: "Contains" },
    { value: "ncontains", label: "Not Contains" },
  ];
}

function buildRuleRow(rule = {}) {
  const row = createEl("div", { class: "admin-rule-row rule" });

  const columnInput = createEl("input", {
    type: "text",
    class: "mask-column",
    placeholder: "Column name",
    value: rule.col || "",
  });

  const operatorSelect = createEl("select", { class: "mask-operator" });
  getRuleOperators().forEach((op) => {
    const option = createEl("option", { value: op.value, text: op.label });
    if ((rule.op || "isin") === op.value) {
      option.selected = true;
    }
    operatorSelect.appendChild(option);
  });

  const valuesInput = createEl("input", {
    type: "text",
    class: "mask-values",
    placeholder: "Values (comma separated)",
    value: Array.isArray(rule.values) ? rule.values.join(", ") : "",
  });

  const removeBtn = createEl(
    "button",
    {
      type: "button",
      class: "admin-rule-remove rm",
      text: "×",
    }
  );

  removeBtn.addEventListener("click", () => {
    row.remove();
    syncRulesToState();
    toggleEmptyState();
  });

  row.appendChild(columnInput);
  row.appendChild(operatorSelect);
  row.appendChild(valuesInput);
  row.appendChild(removeBtn);

  return row;
}

function toggleEmptyState() {
  const container = $("maskRulesContainer");
  if (!container) return;

  const rows = container.querySelectorAll(".admin-rule-row");
  let emptyState = $("emptyRulesState");

  if (rows.length === 0) {
    if (!emptyState) {
      emptyState = createEl("div", {
        id: "emptyRulesState",
        class: "admin-empty-rules",
        text: 'No rules added yet, click “+” add rule to get started',
      });
      container.appendChild(emptyState);
    }
  } else if (emptyState) {
    emptyState.remove();
  }
}

function renderRules() {
  const container = $("maskRulesContainer");
  if (!container) return;

  container.innerHTML = "";

  const rules = Array.isArray(CFG.mask_rules) ? CFG.mask_rules : [];
  rules.forEach((rule) => {
    container.appendChild(buildRuleRow(rule));
  });

  toggleEmptyState();
}

function readRulesFromUI() {
  const container = $("maskRulesContainer");
  if (!container) return [];

  const rows = [...container.querySelectorAll(".admin-rule-row")];

  return rows
    .map((row) => {
      const col = row.querySelector(".mask-column")?.value?.trim() || "";
      const op = row.querySelector(".mask-operator")?.value?.trim() || "isin";
      const valuesRaw = row.querySelector(".mask-values")?.value || "";

      const values = valuesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      return { col, op, values };
    })
    .filter((rule) => rule.col.length > 0);
}

function syncRulesToState() {
  CFG.mask_rules = readRulesFromUI();
}

function fillFormFromConfig() {
  $("uuidColumn").value = CFG.dataset?.uuid_col || "uuid";
  $("levelsInput").value = (CFG.levels || []).join(", ");
  $("defaultMinCount").value = CFG.defaults?.min_count ?? 50;
  $("defaultSampleCount").value = CFG.defaults?.sample_count ?? 50;
  $("usersInput").value = (CFG.users || ["Shumail Mehmood"]).join(", ");
  $("defaultUser").value = CFG.default_user || "Shumail Mehmood";
  $("showModePopup").checked = !!CFG.testing_prompt_enabled;

  renderRules();
}

function readFormPayload() {
  const uuid_col = ($("uuidColumn").value || "uuid").trim() || "uuid";

  const levels = ($("levelsInput").value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const min_count = Number($("defaultMinCount").value || 50);
  const sample_count = Number($("defaultSampleCount").value || 50);

  const users = ($("usersInput").value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const default_user =
    ($("defaultUser").value || "Shumail Mehmood").trim() || "Shumail Mehmood";

  if (users.length === 0) {
    users.push(default_user);
  }
  if (!users.includes(default_user)) {
    users.unshift(default_user);
  }

  return {
    dataset: { uuid_col },
    levels: levels.length ? levels : ["DISTRICT"],
    defaults: {
      min_count,
      sample_count,
    },
    mask_rules: readRulesFromUI(),
    testing_prompt_enabled: $("showModePopup").checked,
    users,
    default_user,
  };
}

async function saveConfig() {
  const btn = $("saveConfigBtn");
  const originalText = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = "<span>Saving...</span>";

    const payload = readFormPayload();

    await getJSON("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    CFG = payload;

    btn.innerHTML = "<span>Saved</span>";
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }, 1000);
  } catch (error) {
    console.error(error);
    alert("Failed to save config.");
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function loadColumns() {
  const target = $("datasetColumnsText");
  if (!target) return;

  try {
    const data = await getJSON("/api/dataset_columns");
    const columns = Array.isArray(data.columns) ? data.columns : [];
    target.textContent = columns.length ? columns.join(", ") : "None loaded";
  } catch (error) {
    console.error(error);
    target.textContent = "None loaded";
  }
}

function bindEvents() {
  $("addMaskRuleBtn").addEventListener("click", () => {
    const container = $("maskRulesContainer");
    const emptyState = $("emptyRulesState");
    if (emptyState) emptyState.remove();

    container.appendChild(
      buildRuleRow({
        col: "",
        op: "isin",
        values: [],
      })
    );

    syncRulesToState();
    toggleEmptyState();
  });

  $("saveConfigBtn").addEventListener("click", saveConfig);

  const ruleContainer = $("maskRulesContainer");
  if (ruleContainer) {
    ruleContainer.addEventListener("input", syncRulesToState);
    ruleContainer.addEventListener("change", syncRulesToState);
  }
}

async function init() {
  try {
    CFG = await getJSON("/api/config");
    if (!Array.isArray(CFG.mask_rules)) {
      CFG.mask_rules = [];
    }

    fillFormFromConfig();
    bindEvents();
    await loadColumns();
  } catch (error) {
    console.error(error);
    alert("Failed to load admin configuration.");
  }
}

document.addEventListener("DOMContentLoaded", init);