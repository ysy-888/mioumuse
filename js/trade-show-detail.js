/**
 * Trade show detail — a full-page view, not a modal.
 *
 * Header with the show and its dates, the email tasks as checkable rows, and
 * free-form notes that save as you type.
 */

let currentTradeShowId = null;

// ── Header ───────────────────────────────────────────────────────────────────

function renderTradeShowHeader(tradeShow) {
  const title = document.getElementById("tradeShowDetailTitle");
  if (title) {
    const dot = document.createElement("span");
    dot.className = "trade-show-dot trade-show-dot--lg";
    dot.dataset.show = tradeShow.show;
    dot.setAttribute("aria-hidden", "true");
    title.replaceChildren(dot, document.createTextNode(getTradeShowTitle(tradeShow)));
  }

  const subtitle = document.getElementById("tradeShowDetailSubtitle");
  if (subtitle) {
    const days = daysBetween(tradeShow.startDate, tradeShow.endDate) + 1;
    const parts = [
      formatDateRange(tradeShow.startDate, tradeShow.endDate),
      days === 1 ? "1 day" : `${days} days`,
    ];
    subtitle.replaceChildren();
    parts.forEach((part, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "•";
        subtitle.appendChild(sep);
      }
      subtitle.appendChild(document.createTextNode(part));
    });
  }

  const status = document.getElementById("tradeShowDetailStatus");
  if (status) {
    const timing = getTradeShowTiming(tradeShow);
    status.dataset.timing = timing;
    status.textContent = TRADE_SHOW_TIMING_LABELS[timing];
  }
}

// ── Tasks ────────────────────────────────────────────────────────────────────

function renderTradeShowTasks(tradeShow) {
  const body = document.getElementById("tradeShowTasksBody");
  if (!body) return;

  const { done, total } = getTradeShowEmailProgress(tradeShow);
  const count = document.getElementById("tradeShowTasksCount");
  if (count) count.textContent = `${done} of ${total} done`;

  const list = document.createElement("div");
  list.className = "trade-show-task-list";
  buildTradeShowEmailTasks(tradeShow).forEach(task => {
    const row = createTaskCheckbox(task);
    const relative = document.createElement("span");
    relative.className = "trade-show-task-relative";
    relative.textContent = describeDaysUntil(task.dueDate);
    row.appendChild(relative);
    list.appendChild(row);
  });
  body.replaceChildren(list);
}

/** "in 12 days", "today", "3 days ago". */
function describeDaysUntil(dueYmd) {
  const n = daysBetween(todayYmd(), dueYmd);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// ── Notes ────────────────────────────────────────────────────────────────────
//
// Edited in place rather than behind the Edit dialog, so it saves itself as
// you type.

const TRADE_SHOW_NOTES_AUTOSAVE_MS = 700;

let notesSaveTimer = null;
let notesSavedTimer = null;

function setNotesStatus(text, state = "") {
  const el = document.getElementById("tradeShowNotesStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "company-notes-status" + (state ? ` ${state}` : "");
}

/** Write the box's current contents through to the store. */
async function flushTradeShowNotes() {
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;

  const box = document.getElementById("tradeShowNotesInput");
  const tradeShow = currentTradeShowId ? getTradeShowById(currentTradeShowId) : null;
  if (!box || !tradeShow || box.value === tradeShow.notes) return;

  try {
    await setTradeShowNotes(tradeShow.id, box.value);
    setNotesStatus("Saved", "is-saved");
    clearTimeout(notesSavedTimer);
    notesSavedTimer = setTimeout(() => setNotesStatus(""), 1800);
  } catch (err) {
    setNotesStatus("Not saved", "is-error");
    showIndicator(err.message || "Could not save notes.", "error");
  }
}

function renderTradeShowNotes(tradeShow) {
  const box = document.getElementById("tradeShowNotesInput");
  if (!box) return;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = null;
  box.value = tradeShow?.notes ?? "";
  setNotesStatus("");
}

function initTradeShowNotes() {
  const box = document.getElementById("tradeShowNotesInput");
  if (!box) return;

  box.addEventListener("input", () => {
    setNotesStatus("Saving…");
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(flushTradeShowNotes, TRADE_SHOW_NOTES_AUTOSAVE_MS);
  });

  // Leaving the box shouldn't wait out the debounce, and neither should
  // leaving the page.
  box.addEventListener("blur", flushTradeShowNotes);
  window.addEventListener("beforeunload", flushTradeShowNotes);
}

// ── Open / close ─────────────────────────────────────────────────────────────

function renderTradeShowDetail(tradeShow) {
  renderTradeShowHeader(tradeShow);
  renderTradeShowTasks(tradeShow);
}

function openTradeShowDetail(tradeShowId) {
  const tradeShow = getTradeShowById(tradeShowId);
  if (!tradeShow) return;

  // Moving straight from one show to another shouldn't drop a pending note.
  if (currentTradeShowId && currentTradeShowId !== tradeShow.id) flushTradeShowNotes();
  currentTradeShowId = tradeShow.id;

  renderTradeShowDetail(tradeShow);
  renderTradeShowNotes(tradeShow);

  switchAppView("tradeShow");
  document.getElementById("tradeShowDetailView")?.scrollTo({ top: 0 });
}

/** Cheap no-op unless a show's page is the active view. */
function refreshTradeShowDetailIfActive() {
  if (getCurrentAppView() !== "tradeShow") return;
  const tradeShow = getTradeShowById(currentTradeShowId);
  if (tradeShow) renderTradeShowDetail(tradeShow);
}

function closeTradeShowDetail() {
  // Flush before dropping the id the flush needs to resolve the show.
  flushTradeShowNotes();
  currentTradeShowId = null;
  // Back to wherever the show was opened from, not always the list.
  goBackAppView("tradeShows");
}

// ── Detail-page menu ─────────────────────────────────────────────────────────

function closeTradeShowDetailMenu() {
  const menu = document.getElementById("tradeShowDetailMenu");
  const btn = document.getElementById("tradeShowDetailMenuBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function initTradeShowDetailMenu() {
  const btn = document.getElementById("tradeShowDetailMenuBtn");
  const menu = document.getElementById("tradeShowDetailMenu");
  if (!btn || !menu) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", e => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeTradeShowDetailMenu();
  });

  document.getElementById("tradeShowMenuEdit")?.addEventListener("click", () => {
    closeTradeShowDetailMenu();
    if (currentTradeShowId) openTradeShowForm(currentTradeShowId);
  });

  document.getElementById("tradeShowMenuDelete")?.addEventListener("click", async () => {
    closeTradeShowDetailMenu();
    const tradeShow = getTradeShowById(currentTradeShowId);
    if (!tradeShow) return;
    const title = getTradeShowTitle(tradeShow);
    if (!confirm(`Delete ${title} and its email tasks? This cannot be undone.`)) return;
    try {
      // Drop any pending note first — the record it would save to is going.
      clearTimeout(notesSaveTimer);
      notesSaveTimer = null;
      await deleteTradeShow(tradeShow.id);
      currentTradeShowId = null;
      goBackAppView("tradeShows");
      refreshTaskViews();
      showIndicator(`${title} deleted`, "success");
    } catch (err) {
      showIndicator(err.message || "Could not delete trade show.", "error");
    }
  });
}

function initTradeShowDetail() {
  initTradeShowNotes();
  initTradeShowDetailMenu();

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (getCurrentAppView() !== "tradeShow") return;
    // Let an open modal or menu take Escape first.
    if (isTradeShowFormOpen()) return;
    if (!document.getElementById("tradeShowDetailMenu")?.hidden) {
      closeTradeShowDetailMenu();
      return;
    }
    closeTradeShowDetail();
  });
}
