/**
 * Magento groups — which Simple items belong to each Grouped product,
 * exactly as Magento has them.
 *
 * Magento's API lists only a group's *enabled* items and can't say which
 * group a product is in, so the links come from a Magento product export
 * instead (System → Data Transfer → Export → Products, CSV): its
 * associated_skus column lists every Grouped product's items, disabled
 * ones included. Import groups reads that file here in the browser — it's
 * never uploaded — and saves only the links (magento_groups). Nothing is
 * sent to Magento, and nothing else in the app changes.
 *
 * The products table then takes each group's items from the import; a
 * Grouped product added in Magento since the export falls back to the
 * API's list (enabled items only). A Simple item whose SKU is a group's SKU
 * plus "-…" (T4339-WHITE/BLACK → T4339) but which isn't in that group on
 * Magento is flagged.
 */

/** groupSku → [childSku] from the last import; null until loaded (or not set up). */
let mgGroups = null;
/** childSku → groupSku. */
let mgChildGroup = new Map();
let mgGroupsImportedAt = "";
/** false when the magento_groups table isn't there yet. */
let mgGroupsTableReady = true;
/** The file read, waiting for "Update groups". */
let mgGroupsPending = null;

async function loadMagentoGroups() {
  try {
    const loaded = await loadMagentoGroupRows();
    mgGroupsTableReady = loaded !== null;
    setMagentoGroups(loaded?.groups ?? null, loaded?.importedAt ?? "");
  } catch (err) {
    showIndicator(err.message || "Couldn't load the imported groups.", "error");
  }
}

function setMagentoGroups(groups, importedAt) {
  mgGroups = groups && groups.size ? groups : null;
  mgGroupsImportedAt = importedAt;
  mgChildGroup = new Map();
  mgGroups?.forEach((children, group) => children.forEach(child => mgChildGroup.set(child, group)));
  renderMgGroupsStatus();
}

/** The longest Grouped SKU that `sku` starts with, followed by "-". */
function prefixGroupFor(sku, groups = mgGroups) {
  const parts = String(sku).split("-");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("-");
    if (groups?.has(prefix)) return prefix;
  }
  return null;
}

/**
 * A product from Magento's API, with its grouping taken from the import:
 *   Grouped  childSkus — every item, disabled ones too; groupSource says
 *            where they came from ("export", or "api" for a group newer
 *            than the import, or with no import yet)
 *   Simple   groupSku — the group it's in, or null; unlinkedGroup — the
 *            group its SKU matches when it isn't in that group on Magento
 */
function applyMgGroups(product) {
  if (!product) return product;
  product.groupSource = "api";
  product.groupSku = null;
  product.unlinkedGroup = null;
  if (!mgGroups) return product;
  if (product.type === "grouped") {
    if (mgGroups.has(product.sku)) {
      product.childSkus = [...mgGroups.get(product.sku)];
      product.groupSource = "export";
    }
  } else {
    product.groupSku = mgChildGroup.get(product.sku) ?? null;
    if (!product.groupSku) product.unlinkedGroup = prefixGroupFor(product.sku);
  }
  return product;
}

function renderMgGroupsStatus() {
  const el = document.getElementById("mgGroupsStatus");
  if (!el) return;
  el.classList.toggle("is-warning", !mgGroups);
  if (mgGroups) {
    el.textContent = `Groups: export of ${formatMdy(mgGroupsImportedAt.slice(0, 10))}`;
    el.title = `${mgGroups.size.toLocaleString()} groups, ${mgChildGroup.size.toLocaleString()} items — from the Magento export imported ${new Date(mgGroupsImportedAt).toLocaleString()}. Import a newer export after changing groups in Magento.`;
  } else {
    el.textContent = "Groups: enabled items only";
    el.title = "Magento's API leaves disabled items out of groups. Import groups from a Magento product export to see every item.";
  }
}

// ── Reading the export ───────────────────────────────────────────────────────

/**
 * CSV → rows of cells. Quoted cells may hold commas, doubled quotes and
 * line breaks (product descriptions do). Every cell stays text — SKUs are
 * never turned into numbers or dates.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * The groups in a Magento product export, plus what the file says about
 * them. Only the default rows count — a store view's rows repeat a product
 * with that view's text, not its links.
 */
function extractMagentoGroups(text) {
  const [header = [], ...rows] = parseCsv(text);
  const col = name => header.indexOf(name);
  const at = { sku: col("sku"), view: col("store_view_code"), type: col("product_type"), links: col("associated_skus"), online: col("product_online") };
  if (at.sku < 0 || at.type < 0 || at.links < 0) {
    throw new Error("That isn't a Magento product export — it needs sku, product_type and associated_skus columns (System → Data Transfer → Export → Products, CSV).");
  }

  const groups = new Map();
  const status = new Map();
  // Magento doesn't strictly stop two products sharing a SKU; the app keys
  // by SKU, so a shared one's items are combined — and the preview says so.
  const seen = new Set();
  const duplicates = new Set();
  let products = 0;
  let simples = 0;
  rows.forEach(r => {
    const sku = (r[at.sku] ?? "").trim();
    if (!sku || (at.view >= 0 && (r[at.view] ?? "").trim())) return;
    if (seen.has(sku)) duplicates.add(sku);
    else products += 1;
    seen.add(sku);
    const type = (r[at.type] ?? "").trim();
    if (at.online >= 0) status.set(sku, (r[at.online] ?? "").trim());
    if (type === "simple" && !duplicates.has(sku)) simples += 1;
    if (type !== "grouped") return;
    // "T2846-BEIGE=0.0000,T2846-NAVY=0.0000" — each item and its default qty.
    const children = (r[at.links] ?? "").split(",")
      .map(part => part.split("=")[0].trim())
      .filter(Boolean);
    groups.set(sku, [...new Set([...(groups.get(sku) ?? []), ...children])]);
  });
  if (!products) throw new Error("No products found in that file.");

  const linked = new Set([...groups.values()].flat());
  const disabledLinks = [...linked].filter(sku => status.get(sku) === "2").length;
  // Simple items whose SKU matches a group they aren't in.
  let unlinked = 0;
  status.forEach((_, sku) => {
    if (!linked.has(sku) && !groups.has(sku) && prefixGroupFor(sku, groups)) unlinked += 1;
  });
  return { groups, products, simples, links: linked.size, disabledLinks, ungrouped: simples - [...linked].filter(s => status.has(s)).length, unlinked, duplicates: [...duplicates] };
}

// ── The import window ────────────────────────────────────────────────────────

function openMgGroupsImport() {
  const input = document.getElementById("mgImportGroupsFile");
  if (!input) return;
  input.value = "";
  input.click();
}

async function readMgGroupsFile(file) {
  if (!file) return;
  setAppLoading(true, "Reading the export…");
  try {
    const result = extractMagentoGroups(await file.text());
    mgGroupsPending = { ...result, fileName: file.name };
    renderMgGroupsImport();
    document.getElementById("mgGroupsImportOverlay")?.classList.add("open");
  } catch (err) {
    showIndicator(err.message || "Couldn't read that file.", "error");
  } finally {
    setAppLoading(false);
  }
}

function closeMgGroupsImport() {
  mgGroupsPending = null;
  document.getElementById("mgGroupsImportOverlay")?.classList.remove("open");
}

/** What the file holds, and how it differs from the groups the app has now. */
function renderMgGroupsImport() {
  const p = mgGroupsPending;
  if (!p) return;
  document.getElementById("mgGroupsImportIntro").textContent =
    `${p.fileName} — ${p.products.toLocaleString()} products. Only the group links are saved; nothing else in the app or in Magento changes.`;

  const fields = [
    ["Grouped items", p.groups.size.toLocaleString()],
    ["Items in groups", `${p.links.toLocaleString()}${p.disabledLinks ? ` (${p.disabledLinks.toLocaleString()} disabled)` : ""}`],
    ["Simple items in no group", p.ungrouped.toLocaleString()],
    ["SKU matches a group, not in it", p.unlinked.toLocaleString()],
  ];
  if (p.duplicates.length) {
    fields.push(["SKUs on 2+ products", `${p.duplicates.join(", ")} — fix in Magento; their items are combined here`]);
  }
  document.getElementById("mgGroupsImportSummary").replaceChildren(...fields.flatMap(([label, value]) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    v.textContent = value;
    return [l, v];
  }));

  // Against the last import.
  const changes = document.getElementById("mgGroupsImportChanges");
  const save = document.getElementById("mgGroupsImportSaveBtn");
  if (!mgGroups) {
    changes.textContent = "First import — every group above will be saved.";
    save.disabled = false;
  } else {
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const added = [...p.groups.keys()].filter(g => !mgGroups.has(g));
    const removed = [...mgGroups.keys()].filter(g => !p.groups.has(g));
    const changed = [...p.groups.keys()].filter(g => mgGroups.has(g) && !same(mgGroups.get(g), p.groups.get(g)));
    const n = added.length + removed.length + changed.length;
    const sample = list => list.slice(0, 8).join(", ") + (list.length > 8 ? ` and ${list.length - 8} more` : "");
    const lines = [];
    if (added.length) lines.push(`New groups (${added.length}): ${sample(added)}`);
    if (changed.length) lines.push(`Changed items (${changed.length}): ${sample(changed)}`);
    if (removed.length) lines.push(`Groups no longer in Magento (${removed.length}): ${sample(removed)}`);
    changes.textContent = n
      ? lines.join("\n")
      : `Same as the groups imported ${formatMdy(mgGroupsImportedAt.slice(0, 10))} — nothing to update.`;
    save.disabled = n === 0;
  }
  document.getElementById("mgGroupsImportMessage").textContent = "";
}

async function saveMgGroupsImport() {
  const p = mgGroupsPending;
  if (!p) return;
  const save = document.getElementById("mgGroupsImportSaveBtn");
  const message = document.getElementById("mgGroupsImportMessage");
  save.disabled = true;
  message.textContent = "Saving…";
  message.className = "modal-footer-message";
  try {
    const importedAt = await replaceMagentoGroupRows(p.groups);
    mgGroupsTableReady = true;
    setMagentoGroups(p.groups, importedAt);
    closeMgGroupsImport();
    // Redraw with the new groups.
    if (getCurrentAppView() === "magento") await loadMagentoProducts();
    showIndicator(`Groups updated — ${p.groups.size.toLocaleString()} groups, ${p.links.toLocaleString()} items`, "success");
  } catch (err) {
    message.className = "modal-footer-message error";
    message.textContent = mgGroupsTableReady && !/magento_groups/.test(err.message ?? "")
      ? err.message || "Couldn't save the groups."
      : "Add the magento_groups table in Supabase first (SQL Editor — it's in supabase-schema.sql), then try again.";
    save.disabled = false;
  }
}

function initMagentoGroups() {
  document.getElementById("mgImportGroupsBtn")?.addEventListener("click", openMgGroupsImport);
  document.getElementById("mgImportGroupsFile")?.addEventListener("change", e => readMgGroupsFile(e.target.files?.[0]));
  document.getElementById("mgGroupsImportSaveBtn")?.addEventListener("click", saveMgGroupsImport);
  document.getElementById("mgGroupsImportCancelBtn")?.addEventListener("click", closeMgGroupsImport);
  document.getElementById("mgGroupsImportCloseBtn")?.addEventListener("click", closeMgGroupsImport);
  document.getElementById("mgGroupsImportOverlay")?.addEventListener("click", e => {
    if (e.target.id === "mgGroupsImportOverlay") closeMgGroupsImport();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && mgGroupsPending) closeMgGroupsImport();
  });
  renderMgGroupsStatus();
}
