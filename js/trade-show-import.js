/**
 * Trade Shows → Import CSV: trade shows from the Magento events export
 * (Content → Events → Export: ID, Title, Start, End, Status, …).
 *
 * Each event's trade show comes from its title ("MAGIC LAS VEGAS" → Magic
 * Las Vegas, "FLAIR CHICAGO" → Flair — guessMgEventShow in
 * js/magento-events.js); titles that aren't one of the app's shows are
 * skipped, and so are disabled events unless asked for. An event whose show
 * is already in the app on overlapping dates updates that one's dates
 * (or is left alone when they match) — importing again adds nothing twice.
 */

/** [{ id, title, start, end, enabled, show }] from the chosen file. */
let tsImportRows = [];

/** The export's rows; null when the file isn't one. */
function parseTradeShowExport(text) {
  const [header = [], ...rows] = parseCsv(text);
  const col = name => header.findIndex(h => h.trim().toLowerCase() === name);
  const at = { id: col("id"), title: col("title"), start: col("start"), end: col("end"), status: col("status") };
  if (at.title === -1 || at.start === -1) return null;
  const day = value => String(value ?? "").trim().slice(0, 10);
  return rows
    .filter(r => r.some(c => c.trim()))
    .map(r => {
      const title = String(r[at.title] ?? "").trim();
      const start = day(r[at.start]);
      return {
        id: at.id === -1 ? "" : String(r[at.id] ?? "").trim(),
        title,
        start,
        end: at.end === -1 ? start : day(r[at.end]) || start,
        enabled: at.status === -1 || !/^(disabled|0|no|inactive)$/i.test(String(r[at.status] ?? "").trim()),
        show: guessMgEventShow(title),
      };
    })
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.start));
}

/** What importing a row would do: { kind: new | update | same | skip, label, tradeShow }. */
function planTradeShowImport(row, includeDisabled) {
  if (!row.show) return { kind: "skip", label: "Not one of the app's shows" };
  if (!row.enabled && !includeDisabled) return { kind: "skip", label: "Disabled" };
  if (row.end < row.start) return { kind: "skip", label: "Ends before it starts" };
  const tradeShow = getAllTradeShows().find(t => t.show === row.show && mgEventOverlaps(row, t));
  if (!tradeShow) return { kind: "new", label: "New" };
  if (tradeShow.startDate === row.start && tradeShow.endDate === row.end) return { kind: "same", label: "Already in the app", tradeShow };
  return { kind: "update", label: `Update dates (now ${formatDateRange(tradeShow.startDate, tradeShow.endDate)})`, tradeShow };
}

function renderTradeShowImport() {
  const includeDisabled = document.getElementById("tsImportDisabled")?.checked ?? false;
  const plans = tsImportRows.map(row => ({ row, plan: planTradeShowImport(row, includeDisabled) }));
  const count = kind => plans.filter(p => p.plan.kind === kind).length;
  const [added, updated] = [count("new"), count("update")];

  document.getElementById("tsImportIntro").textContent =
    `${tsImportRows.length} event${tsImportRows.length === 1 ? "" : "s"} in the file: ${added} to add, ${updated} to update, ` +
    `${count("same")} already in the app, ${count("skip")} skipped.`;

  const table = document.createElement("table");
  table.className = "ts-import-table";
  table.innerHTML = "<thead><tr><th>Event</th><th>Trade show</th><th>Dates</th><th>Import</th></tr></thead>";
  const tbody = document.createElement("tbody");
  plans
    .sort((a, b) => a.row.start.localeCompare(b.row.start))
    .forEach(({ row, plan }) => {
      const tr = document.createElement("tr");
      if (plan.kind === "skip" || plan.kind === "same") tr.classList.add("is-skipped");
      const cell = content => {
        const td = document.createElement("td");
        if (content instanceof Node) td.appendChild(content);
        else td.textContent = content;
        tr.appendChild(td);
      };
      cell(row.title + (row.enabled ? "" : " (disabled)"));
      if (row.show) {
        const tag = document.createElement("span");
        tag.className = "mg-event-show";
        tag.dataset.show = row.show;
        tag.textContent = getTradeShowLabel(row.show);
        cell(tag);
      } else cell(EMPTY_DISPLAY);
      cell(formatDateRange(row.start, row.end));
      const result = document.createElement("span");
      result.className = "ts-import-result";
      result.dataset.kind = plan.kind;
      result.textContent = plan.label;
      cell(result);
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  document.getElementById("tsImportList").replaceChildren(table);

  const save = document.getElementById("tsImportSaveBtn");
  save.disabled = !(added + updated);
  save.textContent = added + updated ? `Import ${added + updated}` : "Nothing to import";
}

async function openTradeShowImport(file) {
  let rows;
  try {
    rows = parseTradeShowExport(await file.text());
  } catch {
    rows = null;
  }
  if (!rows) {
    showIndicator("That file isn't a Magento events export — it needs Title, Start and End columns.", "error");
    return;
  }
  tsImportRows = rows;
  Object.assign(document.getElementById("tsImportMessage"), { textContent: "", className: "modal-footer-message" });
  renderTradeShowImport();
  document.getElementById("tsImportOverlay")?.classList.add("open");
}

function closeTradeShowImport() {
  document.getElementById("tsImportOverlay")?.classList.remove("open");
  tsImportRows = [];
}

async function saveTradeShowImport() {
  const includeDisabled = document.getElementById("tsImportDisabled")?.checked ?? false;
  const todo = tsImportRows
    .map(row => ({ row, plan: planTradeShowImport(row, includeDisabled) }))
    .filter(p => p.plan.kind === "new" || p.plan.kind === "update");
  if (!todo.length) return;
  const save = document.getElementById("tsImportSaveBtn");
  const message = document.getElementById("tsImportMessage");
  save.disabled = true;
  let done = 0;
  const failed = [];
  for (const { row, plan } of todo) {
    message.textContent = `Importing ${done + 1} of ${todo.length}…`;
    const fields = { show: row.show, startDate: row.start, endDate: row.end };
    try {
      if (plan.kind === "update") await updateTradeShow(plan.tradeShow.id, fields);
      else await createTradeShow({ ...fields, notes: "" });
      done++;
    } catch (err) {
      failed.push(`${row.title} (${formatDateRange(row.start, row.end)}): ${err.message}`);
    }
  }
  refreshTaskViews();
  if (failed.length) {
    message.textContent = `${done} imported; ${failed.length} failed — ${failed[0]}`;
    message.className = "modal-footer-message error";
    renderTradeShowImport();
    return;
  }
  closeTradeShowImport();
  showIndicator(`Imported ${done} trade show${done === 1 ? "" : "s"}`, "success");
}

function initTradeShowImport() {
  const input = document.getElementById("importTradeShowsFile");
  document.getElementById("importTradeShowsBtn")?.addEventListener("click", () => input?.click());
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) openTradeShowImport(file);
  });
  document.getElementById("tsImportDisabled")?.addEventListener("change", renderTradeShowImport);
  document.getElementById("tsImportSaveBtn")?.addEventListener("click", saveTradeShowImport);
  document.getElementById("tsImportCancelBtn")?.addEventListener("click", closeTradeShowImport);
  document.getElementById("tsImportCloseBtn")?.addEventListener("click", closeTradeShowImport);
  const overlay = document.getElementById("tsImportOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeTradeShowImport();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open")) closeTradeShowImport();
  });
}
