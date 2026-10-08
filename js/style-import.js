/**
 * Import the N41 ATS export (.xlsx) into the Styles database.
 *
 * The file is read here in the browser — it's never uploaded; only the
 * cleaned-up fields are saved. The export is a printed report rather than a
 * clean table, so the rules are:
 *
 *   - start at row 8 (headings and page furniture sit above it)
 *   - a row counts only if it has a Style # — the size-breakdown rows
 *     between styles, and blank rows, have none and are skipped
 *   - repeated heading rows ("Style" in the Style # column) are skipped
 *
 *   Column B        N41 Status
 *   Column D (+E)   Season       merged — the value sits in D
 *   Column F        Category
 *   Column H        Style #
 *   Column I        Color
 *   Columns L–N     Description  merged — the value sits in L
 *
 * A Style # + Color is one record. Before anything is saved, a preview shows
 * what's new, what changed and what's the same; confirming saves only the
 * new and changed ones. Styles missing from the file are left as they are.
 */

const STYLE_IMPORT_FIRST_ROW = 8;

/** SheetJS, loaded only when an import is started — it's a large library. */
const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
let sheetJsLoading = null;

function loadSheetJs() {
  if (typeof XLSX !== "undefined") return Promise.resolve();
  if (!sheetJsLoading) {
    sheetJsLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SHEETJS_URL;
      script.onload = () => resolve();
      script.onerror = () => {
        sheetJsLoading = null;
        reject(new Error("Couldn't load the Excel reader — check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return sheetJsLoading;
}

/** Trimmed, with runs of spaces collapsed — report exports pad generously. */
function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Pull clean style records out of the workbook. Returns the records (one per
 * Style # + Color — a later row wins if the file repeats one) and how many
 * rows were skipped.
 */
function extractStyles(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("That file has no sheets.");

  // Keyed by column letter, from row 8 down; formatted text, not raw values.
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: "A",
    range: STYLE_IMPORT_FIRST_ROW - 1,
    defval: "",
    raw: false,
    blankrows: true,
  });

  const byKey = new Map();
  let skipped = 0;
  rows.forEach(row => {
    const styleNo = cleanCell(row.H);
    if (!styleNo || styleNo.toLowerCase() === "style") {
      skipped += 1;
      return;
    }
    const color = cleanCell(row.I);
    // Merged cells keep their value in the first cell; the others are read
    // too, in case a future export splits them.
    const description = [row.L, row.M, row.N].map(cleanCell).filter(Boolean)
      .filter((v, i, all) => all.indexOf(v) === i).join(" ");
    byKey.set(styleKey(styleNo, color), {
      styleNo,
      color,
      status: cleanCell(row.B),
      season: cleanCell(row.D) || cleanCell(row.E),
      category: cleanCell(row.F),
      description,
    });
  });

  return { styles: [...byKey.values()], skipped };
}

const STYLE_FIELDS = [
  { key: "status", label: "Status" },
  { key: "season", label: "Season" },
  { key: "category", label: "Category" },
  { key: "description", label: "Description" },
];

/** Sort the file's records against the database: new, changed, unchanged. */
function diffStyles(incoming) {
  const existing = new Map(getAllStyles().map(s => [styleKey(s.styleNo, s.color), s]));
  const added = [];
  const changed = [];
  let unchanged = 0;
  incoming.forEach(style => {
    const current = existing.get(styleKey(style.styleNo, style.color));
    if (!current) {
      added.push(style);
      return;
    }
    const diffs = STYLE_FIELDS
      .filter(f => current[f.key] !== style[f.key])
      .map(f => ({ ...f, from: current[f.key], to: style[f.key] }));
    if (diffs.length) changed.push({ style, diffs });
    else unchanged += 1;
  });
  return { added, changed, unchanged };
}

// ── Dialog ───────────────────────────────────────────────────────────────────

/** What the preview is showing and would save on confirm. */
let styleImportPlan = null;

const STYLE_IMPORT_PREVIEW_ROWS = 60;

function setStyleImportMessage(text, type = "") {
  const el = document.getElementById("styleImportMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function openStyleImport() {
  styleImportPlan = null;
  const input = document.getElementById("styleImportFile");
  if (input) input.value = "";
  document.getElementById("styleImportSummary").replaceChildren();
  document.getElementById("styleImportPreview").replaceChildren();
  document.getElementById("styleImportPick").hidden = false;
  document.getElementById("styleImportConfirmBtn").disabled = true;
  setStyleImportMessage("");
  document.getElementById("styleImportOverlay")?.classList.add("open");
}

function closeStyleImport() {
  document.getElementById("styleImportOverlay")?.classList.remove("open");
  styleImportPlan = null;
}

async function readStyleFile(file) {
  if (!file) return;
  setStyleImportMessage(`Reading ${file.name}…`);
  document.getElementById("styleImportConfirmBtn").disabled = true;
  try {
    await loadSheetJs();
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const { styles, skipped } = extractStyles(workbook);
    if (styles.length === 0) {
      throw new Error("No styles found — expected Style # in column H from row 8 down.");
    }
    const diff = diffStyles(styles);
    styleImportPlan = { fileName: file.name, total: styles.length, skipped, ...diff };
    renderStyleImportPreview();
    const toSave = diff.added.length + diff.changed.length;
    document.getElementById("styleImportConfirmBtn").disabled = toSave === 0;
    document.getElementById("styleImportConfirmBtn").textContent = toSave
      ? `Import ${toSave.toLocaleString()} ${toSave === 1 ? "style" : "styles"}`
      : "Nothing to import";
    setStyleImportMessage(toSave ? "" : "Everything in this file is already up to date.");
  } catch (err) {
    styleImportPlan = null;
    setStyleImportMessage(err.message || "Couldn't read that file.", "error");
  }
}

function renderStyleImportPreview() {
  const plan = styleImportPlan;
  const summary = document.getElementById("styleImportSummary");
  const preview = document.getElementById("styleImportPreview");
  if (!plan || !summary || !preview) return;

  const stat = (n, label, tone) => {
    const el = document.createElement("div");
    el.className = "style-import-stat";
    if (tone) el.dataset.tone = tone;
    const num = document.createElement("strong");
    num.textContent = n.toLocaleString();
    const text = document.createElement("span");
    text.textContent = label;
    el.append(num, text);
    return el;
  };
  const file = document.createElement("div");
  file.className = "style-import-file";
  file.textContent = `${plan.fileName} · ${plan.total.toLocaleString()} styles found · ${plan.skipped.toLocaleString()} blank / size rows skipped`;
  const stats = document.createElement("div");
  stats.className = "style-import-stats";
  stats.append(
    stat(plan.added.length, "new", "new"),
    stat(plan.changed.length, "updated", "changed"),
    stat(plan.unchanged, "unchanged"),
  );
  summary.replaceChildren(file, stats);

  // A sample of what's about to change — updates first, they're the ones to check.
  const rows = [
    ...plan.changed.map(c => ({ kind: "changed", style: c.style, diffs: c.diffs })),
    ...plan.added.map(style => ({ kind: "new", style })),
  ];
  if (rows.length === 0) {
    preview.replaceChildren();
    return;
  }
  const table = document.createElement("table");
  table.className = "style-import-table";
  const head = document.createElement("tr");
  ["", "Style #", "Color", "What changes"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    head.appendChild(th);
  });
  table.appendChild(head);
  rows.slice(0, STYLE_IMPORT_PREVIEW_ROWS).forEach(r => {
    const tr = document.createElement("tr");
    const tag = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "style-import-kind";
    pill.dataset.kind = r.kind;
    pill.textContent = r.kind === "new" ? "New" : "Updated";
    tag.appendChild(pill);
    const no = document.createElement("td");
    no.textContent = r.style.styleNo;
    const color = document.createElement("td");
    color.textContent = r.style.color;
    const what = document.createElement("td");
    what.textContent = r.kind === "new"
      ? [r.style.status, r.style.season, r.style.category, r.style.description].filter(Boolean).join(" · ")
      : r.diffs.map(d => `${d.label}: ${d.from || "—"} → ${d.to || "—"}`).join("; ");
    tr.append(tag, no, color, what);
    table.appendChild(tr);
  });
  const more = rows.length - STYLE_IMPORT_PREVIEW_ROWS;
  const note = document.createElement("div");
  note.className = "style-import-more";
  note.textContent = more > 0 ? `…and ${more.toLocaleString()} more.` : "";
  preview.replaceChildren(table, note);
}

async function confirmStyleImport() {
  const plan = styleImportPlan;
  if (!plan) return;
  const toSave = [...plan.changed.map(c => c.style), ...plan.added];
  const btn = document.getElementById("styleImportConfirmBtn");
  btn.disabled = true;
  try {
    await saveStyles(toSave, (saved, total) => {
      setStyleImportMessage(`Saving ${saved.toLocaleString()} of ${total.toLocaleString()}…`);
    });
    closeStyleImport();
    if (typeof applyStyleFilters === "function") applyStyleFilters();
    showIndicator(`Imported: ${plan.added.length.toLocaleString()} new, ${plan.changed.length.toLocaleString()} updated`, "success");
  } catch (err) {
    setStyleImportMessage(`${err.message || "Couldn't save."} Styles saved before this point are kept — import the file again to finish.`, "error");
    btn.disabled = false;
    if (typeof applyStyleFilters === "function") applyStyleFilters();
  }
}

function initStyleImport() {
  document.getElementById("importStylesBtn")?.addEventListener("click", openStyleImport);
  document.getElementById("styleImportCloseBtn")?.addEventListener("click", closeStyleImport);
  document.getElementById("styleImportCancelBtn")?.addEventListener("click", closeStyleImport);
  document.getElementById("styleImportConfirmBtn")?.addEventListener("click", confirmStyleImport);
  const input = document.getElementById("styleImportFile");
  input?.addEventListener("change", () => readStyleFile(input.files?.[0]));

  // Drop the file onto the dialog.
  const drop = document.getElementById("styleImportPick");
  drop?.addEventListener("dragover", e => {
    e.preventDefault();
    drop.classList.add("is-dragover");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
  drop?.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("is-dragover");
    readStyleFile(e.dataTransfer?.files?.[0]);
  });

  const overlay = document.getElementById("styleImportOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeStyleImport();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open")) closeStyleImport();
  });
}
