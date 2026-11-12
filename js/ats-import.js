/**
 * Import ATS: N41's ATS report (.xls / .xlsx) → each style's stock figures.
 *
 * Row 1 holds the headings. F (style) and G (color) find the Style # + Color
 * in the Styles database; K onhand, L wip, M onorder and N ats are saved as
 * OH / WIP / OO / ATS, and total_inv_qty as Inv Qty (js/store.js
 * saveStyleAts). The ATS report is where all the stock figures come from;
 * style information is the Style Master's (js/style-import.js). Columns are
 * found by their headings, with F, G, K–N as the fallback (Inv Qty has none:
 * without its heading, Inv Qty is left as it is). Colours are compared on letters
 * and digits only (DK.OLIVE = DK OLIVE). Rows for styles that aren't in the
 * database are skipped; styles not in the report keep what they had.
 *
 * Shown on Magento → Products beside each item (js/magento.js).
 */

const ATS_HEADINGS = { style: ["style"], color: ["color"], oh: ["onhand", "oh"], wip: ["wip"], oo: ["onorder", "oo"], ats: ["ats"] };
const ATS_FALLBACK = { style: "F", color: "G", oh: "K", wip: "L", oo: "M", ats: "N" };

const atsKey = s => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** [{ styleNo, color, oh, wip, oo, ats }] from the report's first sheet. */
function parseAtsReport(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: "A", raw: true, defval: "" });
  const head = rows[0] ?? {};
  const cols = {};
  Object.entries(ATS_HEADINGS).forEach(([field, names]) => {
    cols[field] = Object.keys(head).find(c => names.includes(String(head[c]).trim().toLowerCase())) ?? ATS_FALLBACK[field];
  });
  if (String(head[cols.style] ?? "").trim().toLowerCase() !== "style" || String(head[cols.ats] ?? "").trim().toLowerCase() !== "ats") {
    throw new Error("That isn't N41's ATS report — expected style, color, onhand, wip, onorder and ats headings in row 1.");
  }
  const invCol = Object.keys(head).find(c => String(head[c]).trim().toLowerCase() === "total_inv_qty");
  const num = v => (v === "" || v === null || isNaN(Number(v)) ? null : Number(v));
  return rows.slice(1).map(r => ({
    styleNo: String(r[cols.style] ?? "").trim().toUpperCase(),
    color: String(r[cols.color] ?? "").trim().toUpperCase(),
    oh: num(r[cols.oh]), wip: num(r[cols.wip]), oo: num(r[cols.oo]), ats: num(r[cols.ats]),
    ...(invCol ? { invQty: num(r[invCol]) } : {}),
  })).filter(r => r.styleNo);
}

/** A style's Inv Qty is kept as text ("" = none); the report's as a number. */
const atsInvChanged = r => "invQty" in r && (r.style.invQty ?? "") !== (r.invQty == null ? "" : String(r.invQty));

/** Which rows match a style, which don't, and how many figures change. */
function planAtsImport(rows) {
  const matched = new Map();
  const unmatched = [];
  rows.forEach(r => {
    const want = atsKey(r.color);
    const style = findStyle(r.styleNo, r.color) ?? getStyleColors(r.styleNo).find(s => atsKey(s.color) === want);
    if (!style) { unmatched.push(r); return; }
    matched.set(styleKey(style.styleNo, style.color), { ...r, styleNo: style.styleNo, color: style.color, style });
  });
  const list = [...matched.values()];
  const changed = list.filter(r => ["oh", "wip", "oo", "ats"].some(k => r.style[k] !== r[k]) || atsInvChanged(r));
  return { rows: rows.length, list, changed, unmatched };
}

async function importAtsFile(file) {
  if (!file) return;
  try {
    showIndicator(`Reading ${file.name}…`);
    await loadSheetJs(); // js/style-import.js
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const plan = planAtsImport(parseAtsReport(workbook));
    clearIndicator();
    if (!plan.list.length) throw new Error("None of the report's Style # + Colors are in the Styles database.");
    const missing = plan.unmatched.length
      ? `\n${plan.unmatched.length.toLocaleString()} rows aren't in the Styles database and are skipped (e.g. ${plan.unmatched.slice(0, 3).map(r => `${r.styleNo} ${r.color}`).join(", ")}).`
      : "";
    const fields = plan.list.length && "invQty" in plan.list[0] ? "OH / WIP / OO / ATS / Inv Qty" : "OH / WIP / OO / ATS";
    if (!confirm(`${plan.rows.toLocaleString()} rows read. ${plan.list.length.toLocaleString()} colours match, ${plan.changed.length.toLocaleString()} with new figures.${missing}\n\nSave ${fields} for the ${plan.list.length.toLocaleString()} matched colours?`)) return;
    await saveStyleAts(plan.list, (n, total) => showIndicator(`Saving ATS… ${n.toLocaleString()} of ${total.toLocaleString()}`));
    showIndicator(`ATS saved for ${plan.list.length.toLocaleString()} colours`, "success");
    if (getCurrentAppView() === "magento" && typeof renderMgProducts === "function") renderMgProducts();
  } catch (err) {
    showIndicator(err.message || "Couldn't import the ATS report.", "error");
  }
}

function initAtsImport() {
  document.getElementById("headerMenuImportAts")?.addEventListener("click", () => {
    closeHeaderMenu();
    const input = document.getElementById("atsImportFile");
    if (!input) return;
    input.value = "";
    input.click();
  });
  document.getElementById("atsImportFile")?.addEventListener("change", e => importAtsFile(e.target.files?.[0]));
}
