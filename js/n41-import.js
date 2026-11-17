/**
 * Import N41 Data (header menu ⋮): one window with a drop box for each of
 * N41's three exports — the Style Master (js/style-import.js), the PO detail
 * (js/purchase-orders.js) and the ATS report (js/ats-import.js). Any of them
 * can be given; Import saves them in that order, so styles the Style Master
 * adds get their POs and stock figures.
 *
 * The Style Master's changes are reviewed in its own window first; cancelling
 * there comes back here with the files still in place. The PO detail and ATS
 * report are read as soon as they're picked, so a wrong file shows at once.
 */

const N41_KINDS = ["style", "po", "ats"];
const N41_LABELS = { style: "Style Master", po: "PO detail", ats: "ATS report" };

/** Per box: { file, data, info, error } — data is the parsed PO lines / ATS rows. */
let n41Picked = {};
let n41Busy = false;

const n41Box = kind => document.querySelector(`#n41ImportOverlay .n41-import-box[data-kind="${kind}"]`);

function setN41Message(text, type = "") {
  const el = document.getElementById("n41ImportMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

function renderN41Boxes() {
  N41_KINDS.forEach(kind => {
    const box = n41Box(kind);
    if (!box) return;
    const p = n41Picked[kind];
    box.classList.toggle("has-file", !!p?.file && !p.error);
    box.classList.toggle("has-error", !!p?.error);
    const line = box.querySelector(".n41-import-box-file");
    line.textContent = !p ? "Drop here or click to browse" : p.error ? p.error : p.info ? `${p.file.name} · ${p.info}` : p.file.name;
    line.title = line.textContent;
    box.querySelector(".n41-import-box-clear").hidden = !p;
  });
  const ready = N41_KINDS.some(k => n41Picked[k]?.file && !n41Picked[k].error && !n41Picked[k].reading);
  const reading = N41_KINDS.some(k => n41Picked[k]?.reading);
  document.getElementById("n41ImportConfirmBtn").disabled = n41Busy || reading || !ready;
}

async function pickN41File(kind, file) {
  if (!file || n41Busy) return;
  const entry = { file, reading: kind !== "style" };
  n41Picked[kind] = entry;
  setN41Message("");
  renderN41Boxes();
  if (kind === "style") return; // read and reviewed in its own window on Import
  try {
    if (kind === "po") {
      entry.data = await readN41PoFile(file);
      const pos = new Set(entry.data.map(l => l.poNo)).size;
      entry.info = `${pos.toLocaleString()} POs, ${entry.data.length.toLocaleString()} lines`;
    } else {
      entry.data = await readAtsFile(file);
      entry.info = `${entry.data.length.toLocaleString()} rows`;
    }
  } catch (err) {
    entry.error = `${file.name}: ${err.message || "couldn't read it."}`;
  }
  entry.reading = false;
  if (n41Picked[kind] === entry) renderN41Boxes();
}

function openN41Import() {
  n41Picked = {};
  n41Busy = false;
  document.querySelectorAll("#n41ImportOverlay .n41-import-box input[type=file]").forEach(i => { i.value = ""; });
  setN41Message("");
  renderN41Boxes();
  document.getElementById("n41ImportOverlay")?.classList.add("open");
}

function closeN41Import() {
  if (n41Busy) return;
  document.getElementById("n41ImportOverlay")?.classList.remove("open");
  n41Picked = {};
}

async function confirmN41Import() {
  if (n41Busy) return;
  const style = n41Picked.style;
  if (style?.file && !style.error) {
    // Its review window takes over; back here afterwards for the rest.
    document.getElementById("n41ImportOverlay")?.classList.remove("open");
    openStyleImport(style.file, result => {
      document.getElementById("n41ImportOverlay")?.classList.add("open");
      if (!result.saved) {
        setN41Message("Style Master not imported — nothing was saved.");
        return;
      }
      delete n41Picked.style;
      renderN41Boxes();
      saveN41Rest([{ text: result.summary, error: result.type === "error" }]);
    });
    return;
  }
  saveN41Rest([]);
}

/** The PO detail, then the ATS report; `done` holds the Style Master's summary. */
async function saveN41Rest(done) {
  n41Busy = true;
  renderN41Boxes();
  const steps = [
    ["po", data => saveN41PoLines(data, (n, total) => setN41Message(`Saving POs… ${Math.round((n / total) * 100)}%`))],
    ["ats", data => saveAtsRows(data, (n, total) => setN41Message(`Saving ATS… ${n.toLocaleString()} of ${total.toLocaleString()}`))],
  ];
  for (const [kind, save] of steps) {
    const p = n41Picked[kind];
    if (!p?.data || p.error) continue;
    try {
      setN41Message(`Saving the ${N41_LABELS[kind]}…`);
      done.push({ text: await save(p.data) });
      delete n41Picked[kind];
      renderN41Boxes();
    } catch (err) {
      // Stop here: what's saved stays saved, and what's left stays in its box.
      n41Busy = false;
      renderN41Boxes();
      const before = done.length ? `${done.map(d => d.text).join(" · ")}. ` : "";
      setN41Message(`${before}${N41_LABELS[kind]}: ${err.message || "couldn't save."}`, "error");
      return;
    }
  }
  n41Busy = false;
  closeN41Import();
  if (done.length) showIndicator(done.map(d => d.text).join(" · "), done.some(d => d.error) ? "error" : "success");
}

function initN41Import() {
  document.getElementById("headerMenuImportN41Data")?.addEventListener("click", () => {
    closeHeaderMenu();
    openN41Import();
  });

  N41_KINDS.forEach(kind => {
    const box = n41Box(kind);
    if (!box) return;
    const input = box.querySelector("input[type=file]");
    const browse = () => {
      if (n41Busy) return;
      input.value = "";
      input.click();
    };
    box.addEventListener("click", e => {
      if (e.target.closest(".n41-import-box-clear") || e.target === input) return;
      browse();
    });
    box.addEventListener("keydown", e => {
      if (e.target !== box || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      browse();
    });
    input.addEventListener("change", () => pickN41File(kind, input.files?.[0]));
    box.querySelector(".n41-import-box-clear").addEventListener("click", () => {
      if (n41Busy) return;
      delete n41Picked[kind];
      setN41Message("");
      renderN41Boxes();
    });
    box.addEventListener("dragover", e => {
      e.preventDefault();
      box.classList.add("is-dragover");
    });
    box.addEventListener("dragleave", () => box.classList.remove("is-dragover"));
    box.addEventListener("drop", e => {
      e.preventDefault();
      box.classList.remove("is-dragover");
      pickN41File(kind, e.dataTransfer?.files?.[0]);
    });
  });

  document.getElementById("n41ImportCloseBtn")?.addEventListener("click", closeN41Import);
  document.getElementById("n41ImportCancelBtn")?.addEventListener("click", closeN41Import);
  document.getElementById("n41ImportConfirmBtn")?.addEventListener("click", confirmN41Import);
  const overlay = document.getElementById("n41ImportOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeN41Import();
  });
  // A file dropped beside a box shouldn't open in the tab.
  overlay?.addEventListener("dragover", e => e.preventDefault());
  overlay?.addEventListener("drop", e => e.preventDefault());
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open")) closeN41Import();
  });
}
