/**
 * The style pane — click a style on Styles, Need to Shoot or POs and it
 * opens on the right: the style's details at the top (IHD and the shoot
 * buttons editable), its PO lines, then every photo of it, one under the
 * other, read from the linked image folder.
 */

let paneStyle = null; // { styleNo, color } while the pane is open
let stylePaneUrls = [];
/** The style (styleKey) whose PO list is unfolded, if any. */
let stylePanePosOpenFor = "";

function revokeStylePaneUrls() {
  stylePaneUrls.forEach(url => URL.revokeObjectURL(url));
  stylePaneUrls = [];
}

function renderStylePaneSummary(style) {
  ensureStyleMgAvailability(); // Magento Status (js/magento-availability.js)
  // Two fields to a row; `wide` takes the whole row.
  const field = (label, value, { wide = false } = {}) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value" + (wide ? " is-wide" : "");
    if (value instanceof Node) v.appendChild(value);
    else setDisplayText(v, value || EMPTY_DISPLAY);
    return [l, v];
  };

  renderStylePaneHeader(style);

  // Folded to the count; click to see every PO. Stays open across redraws of
  // the same style.
  // This colour's POs, newest first.
  const lines = getStylePoLines(style.styleNo, style.color).reverse();
  const key = styleKey(style.styleNo, style.color);
  const posBox = document.createElement("details");
  posBox.className = "style-pane-pos-box";
  posBox.open = stylePanePosOpenFor === key;
  posBox.addEventListener("toggle", () => { stylePanePosOpenFor = posBox.open ? key : ""; });
  const posSummary = document.createElement("summary");
  posSummary.className = "style-pane-pos-summary";
  posSummary.title = "Show every PO";
  const posCount = document.createElement("span");
  posCount.className = "style-pane-pos-count";
  posCount.textContent = String(lines.length);
  posSummary.appendChild(posCount);
  const pos = document.createElement("div");
  pos.className = "style-pane-pos";
  posBox.append(posSummary, pos);
  lines.forEach(line => {
    const row = document.createElement("div");
    row.className = "style-pane-po";
    // The PO # and its kind; its ETA and PO date are in the tooltip.
    const no = document.createElement("span");
    no.className = "style-pane-po-month";
    no.textContent = `PO # ${line.poNo}`;
    row.title = `ETA ${line.eta ? formatMdy(line.eta) : EMPTY_DISPLAY} · PO date ${line.poDate ? formatMdy(line.poDate) : EMPTY_DISPLAY}`;
    row.append(no, createPoLineChip(line));
    pos.appendChild(row);
  });
  // Just one: shown as it is, nothing to unfold.
  const poValue = lines.length > 1 ? posBox : lines.length === 1 ? pos.firstElementChild : "";

  document.getElementById("stylePaneSummary").replaceChildren(
    ...field("Category", createStylePaneCategory(style), { wide: true }),
    ...field("IHD", createIhdInput(style, { onSaved: () => refreshPhotoshootViews() })),
    // N41's available month (Styles CSV column D).
    ...field("Available", formatMonYY(style.availableDate)),
    ...field("PO", poValue),
    ...field("Rcvd Qty", style.receivedQty ? Number(style.receivedQty).toLocaleString() : ""),
    ...field("Memo", style.memo ? createStylePaneMemo(style) : "", { wide: true }),
    ...field("Notes", createStylePaneNotes(style), { wide: true }),
  );
}

/**
 * The memo, with each Style # in it as a pill — a set lists its pieces
 * ("J4267ST, P4268ST - SET"). A pill for a style in the database opens it
 * (the same colour if it has one); this style's own pill is just marked.
 */
function createStylePaneMemo(style) {
  const wrap = document.createElement("span");
  wrap.className = "style-pane-memo";
  const memo = String(style.memo ?? "");
  const re = /\b[A-Z]{1,4}\d{3,6}[A-Z]{0,3}\b/gi;
  let last = 0;
  for (const m of memo.matchAll(re)) {
    const styleNo = m[0].toUpperCase();
    const colors = getStyleColors(styleNo);
    // Only Style #s: one in the database, or a set piece (…ST).
    if (!colors.length && !/ST$/.test(styleNo)) continue;
    if (m.index > last) wrap.append(memo.slice(last, m.index));
    last = m.index + m[0].length;
    const own = styleNo === style.styleNo.toUpperCase();
    if (!colors.length || own) {
      const pill = document.createElement("span");
      pill.className = "style-pane-memo-style" + (own ? " is-current" : " is-missing");
      pill.textContent = m[0];
      pill.title = own ? "This style" : "Not in the Styles database";
      wrap.appendChild(pill);
      continue;
    }
    const target = colors.find(c => c.color.toUpperCase() === style.color.toUpperCase()) ?? colors[0];
    const link = document.createElement("button");
    link.type = "button";
    link.className = "style-pane-memo-style";
    link.textContent = m[0];
    link.title = `Open ${target.styleNo} · ${target.color}`;
    link.addEventListener("click", () => openStylePane(target.styleNo, target.color));
    wrap.appendChild(link);
  }
  if (last < memo.length) wrap.append(memo.slice(last));
  return wrap;
}

/** The category, with the season in a pill beside it. */
function createStylePaneCategory(style) {
  const wrap = document.createElement("span");
  wrap.className = "style-pane-category";
  const text = document.createElement("span");
  text.textContent = style.category || EMPTY_DISPLAY;
  wrap.appendChild(text);
  if (style.season) {
    const season = document.createElement("span");
    season.className = "style-pane-season";
    season.textContent = style.season;
    season.title = "Season";
    wrap.appendChild(season);
  }
  return wrap;
}

/** The header: Style # · Color (with a colour picker when there are several), the description, then N41 and Magento status. */
function renderStylePaneHeader(style) {
  const title = document.getElementById("stylePaneTitle");
  const name = document.createElement("span");
  name.className = "style-pane-name";
  const colors = getStyleColors(style.styleNo);
  if (colors.length < 2) {
    name.textContent = `${style.styleNo} · ${style.color}`;
    title.replaceChildren(name);
  } else {
    // Several colours: a dropdown to pick one (← → step through them too).
    name.textContent = `${style.styleNo} ·`;
    const pick = document.createElement("span");
    pick.className = "style-pane-color-pick";
    const select = document.createElement("select");
    select.className = "style-pane-color-select";
    select.setAttribute("aria-label", "Colour");
    select.title = `${colors.length} colours — pick one`;
    colors.forEach(c => select.add(new Option(c.color, c.color, false, c.color === style.color)));
    select.addEventListener("change", () => openStylePane(style.styleNo, select.value));
    pick.appendChild(select);
    title.replaceChildren(name, pick);
  }
  document.getElementById("stylePaneSubtitle").textContent = style.description || "";

  const status = (label, el) => {
    const wrap = document.createElement("span");
    wrap.className = "style-pane-status";
    const l = document.createElement("span");
    l.className = "style-pane-status-label";
    l.textContent = label;
    wrap.append(l, el);
    return wrap;
  };
  document.getElementById("stylePaneStatuses").replaceChildren(
    status("N41", createStyleStatusPill(style.status)),
    status("Magento", createStyleMgStatusCell(style)), // js/magento-availability.js
  );
}

const STYLE_PANE_EDIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

/** Notes: the text, with a pencil that opens the box to edit it; it folds away again after. */
function createStylePaneNotes(style) {
  const wrap = document.createElement("div");
  wrap.className = "style-pane-notes";
  const text = document.createElement("span");
  text.className = "style-pane-notes-text";
  const showText = () => {
    const note = findStyle(style.styleNo, style.color)?.notes ?? "";
    text.textContent = note || EMPTY_DISPLAY;
    text.classList.toggle("is-empty", !note);
  };
  showText();
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "item-pane-icon-btn style-pane-notes-edit";
  edit.title = "Edit the note";
  edit.setAttribute("aria-label", "Edit the note");
  edit.innerHTML = STYLE_PANE_EDIT_ICON;
  const box = createStyleNotesInput(style, {
    multiline: true,
    onSaved: () => {
      showText();
      // The Styles, Need to Shoot and POs tables show notes too.
      const view = getCurrentAppView();
      if (view === "styles") applyStyleFilters({ keepShown: true });
      else if (view === "needToShoot") renderNeedTable();
      else if (view === "pos") renderPoView();
    },
  });
  box.hidden = true;
  const fold = () => {
    box.hidden = true;
    text.hidden = false;
    edit.hidden = false;
  };
  edit.addEventListener("click", () => {
    text.hidden = true;
    edit.hidden = true;
    box.hidden = false;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  });
  // The box saves when it loses focus (Esc undoes); then it folds away.
  box.addEventListener("blur", () => setTimeout(fold, 0));
  wrap.append(text, edit, box);
  return wrap;
}

/**
 * No model photos: under the note, the sample photo — or a box to drag one
 * into (js/sample-photos.js). Dropping on a shown sample replaces it.
 */
function renderStylePaneSample(style, noteEl) {
  const wrap = document.getElementById("stylePanePhotos");
  if (samplePhotoState === "unsupported") return;
  const box = document.createElement("div");
  box.className = "style-pane-sample";
  box.dataset.sampleDrop = "";
  box.dataset.style = style.styleNo;
  box.dataset.color = style.color;
  const [sample] = getSamplePhotoEntries(style.styleNo, style.color);
  if (sample) {
    const fig = document.createElement("figure");
    fig.className = "style-pane-photo is-sample";
    const cap = document.createElement("figcaption");
    cap.textContent = `Sample photo · ${sample.path[sample.path.length - 1]}`;
    cap.title = `${sample.path.join(" / ")}${sample.linked ? " (linked by hand)" : " (named after the style)"}`;
    fig.appendChild(cap);
    box.appendChild(fig);
    const forStyle = paneStyle;
    getSamplePhotoFile(sample).then(file => {
      if (paneStyle !== forStyle) return;
      const url = URL.createObjectURL(file);
      stylePaneUrls.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open full size";
      const img = document.createElement("img");
      img.src = url;
      img.alt = cap.textContent;
      link.appendChild(img);
      fig.prepend(link);
    }).catch(() => fig.classList.add("is-error"));
  } else {
    box.classList.add("is-empty");
    const title = document.createElement("strong");
    title.textContent = "Sample photo";
    const hint = document.createElement("span");
    hint.textContent = samplePhotoState === "none"
      ? "Link the folder your sample photos are in, then pick one for this style."
      : samplePhotoState === "needs-permission"
        ? "Reconnect the sample photo folder to pick one."
        : "Browse the sample photo folder, or drag an image file here.";
    box.append(title, hint);
  }

  // Pick from the folder, or get the folder going first (the click lets the browser ask).
  const actions = document.createElement("div");
  actions.className = "style-pane-sample-actions";
  const button = (label, onClick, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "btn btn-primary" : "btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    actions.appendChild(b);
  };
  const { styleNo, color } = style;
  if (samplePhotoState === "none") button("Link Sample Photo Folder", () => linkSamplePhotoFolder(), true);
  else if (samplePhotoState === "needs-permission") button("Reconnect Sample Photo Folder", () => reconnectSamplePhotoFolder(), true);
  else {
    button(sample ? "Change…" : "Browse sample photos…", () => openSampleBrowser(styleNo, color), !sample);
    if (sample?.linked) {
      button("Unlink", async () => {
        if (await linkSamplePhoto(styleNo, color, "")) showIndicator(`Sample photo unlinked (the file stays in the folder)`, "success");
      });
    }
  }
  box.appendChild(actions);
  wrap.replaceChildren(...(noteEl ? [noteEl] : []), box);
}

/** No model photos: the shoot buttons go on top of the Photos section. */
function renderStylePanePhotos(style) {
  renderStylePanePhotoList(style);
  const shoot = document.getElementById("stylePaneShoot");
  const hasPhotos = getStyleImageEntries(style.styleNo, style.color).length > 0;
  shoot.hidden = hasPhotos;
  shoot.replaceChildren(...(hasPhotos ? [] : [createStyleShootCell(style)]));
}

function renderStylePanePhotoList(style) {
  const wrap = document.getElementById("stylePanePhotos");
  const count = document.getElementById("stylePanePhotoCount");
  revokeStylePaneUrls();
  const note = text => {
    const div = document.createElement("div");
    div.className = "style-gallery-empty";
    div.textContent = text;
    wrap.replaceChildren(div);
    return div;
  };
  const entries = getStyleImageEntries(style.styleNo, style.color);
  count.textContent = arePhotosKnown() ? String(entries.length) : "";
  if (styleImageState === "needs-permission") return renderStylePaneSample(style, note("Reconnect the image folder (Styles → menu ⋮) to see photos."));
  if (styleImageState !== "ready" && styleImageState !== "scanning") return renderStylePaneSample(style, note("Link the image folder (Styles → menu ⋮) to see photos."));
  if (!entries.length) return renderStylePaneSample(style, note(`No model photos named "${style.styleNo} ${style.color.replace(/\//g, ".")} …" yet.`));

  const forStyle = paneStyle;
  wrap.replaceChildren(...entries.map(entry => {
    const fig = document.createElement("figure");
    fig.className = "style-pane-photo";
    const cap = document.createElement("figcaption");
    cap.textContent = entry.path[entry.path.length - 1];
    cap.title = entry.path.join(" / ");
    fig.appendChild(cap);
    getStyleImageFile(entry).then(file => {
      if (paneStyle !== forStyle) return; // another style opened meanwhile
      const url = URL.createObjectURL(file);
      stylePaneUrls.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open full size";
      const img = document.createElement("img");
      img.src = url;
      img.alt = cap.textContent;
      img.loading = "lazy";
      link.appendChild(img);
      fig.prepend(link);
    }).catch(() => fig.classList.add("is-error"));
    return fig;
  }));
}

function renderStylePane() {
  const style = paneStyle && findStyle(paneStyle.styleNo, paneStyle.color);
  if (!style) return closeStylePane();
  renderStylePaneSummary(style); // the header too
  renderStylePanePhotos(style);
}

/** Mark the open style's rows in whichever table is showing. */
function syncStylePaneRows() {
  document.querySelectorAll("tr.is-pane-open, .shoot-style-row.is-pane-open").forEach(tr => tr.classList.remove("is-pane-open"));
  if (!paneStyle) return;
  document.querySelectorAll("#stylesTableBody tr, #needTableBody tr, #completeTableBody tr, #poTableBody tr, #shootPaneStyles .shoot-style-row").forEach(tr => {
    if (tr.dataset.styleNo === paneStyle.styleNo && tr.dataset.color === paneStyle.color) tr.classList.add("is-pane-open");
  });
}

function openStylePane(styleNo, color) {
  const pane = document.getElementById("stylePane");
  if (!pane || !findStyle(styleNo, color)) return;
  // One pane at a time.
  closeItemPane();
  // The Photoshoots page keeps its docked shoot open; the style pane sits over its right side.
  if (!isShootPaneDocked()) closeShootPane();
  paneStyle = { styleNo, color };
  renderStylePane();
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  syncStylePaneRows();
}

function closeStylePane() {
  if (!paneStyle) return;
  paneStyle = null;
  revokeStylePaneUrls();
  const pane = document.getElementById("stylePane");
  if (pane) pane.hidden = true;
  syncStylePaneRows();
}

/** After data or photos change: redraw the open pane, and re-mark its rows. */
function refreshStylePane() {
  if (!paneStyle) return;
  renderStylePane();
  syncStylePaneRows();
}

/** After a field edit: redraw just the details, so the photos don't reload. */
function refreshStylePaneSummary() {
  const style = paneStyle && findStyle(paneStyle.styleNo, paneStyle.color);
  if (style) renderStylePaneSummary(style);
}

// ── Keyboard: ↑ ↓ the next style in the list on screen, ← → its colours ─────

/** Each page's clickable style rows, in the order they show. */
const STYLE_PANE_ROW_LISTS = [
  "#stylesTableBody tr[data-style-no]",
  "#needTableBody tr[data-style-no]",
  "#completeTableBody tr.clickable-row[data-style-no]",
  "#poTableBody tr.po-color-row",
  "#shootPaneStyles .shoot-style-row",
];

const isStylePaneRow = (el, styleNo, color) => el.dataset.styleNo === styleNo && (color === undefined || el.dataset.color === color);

/** The rows on screen the open style belongs to (else the first list showing). */
function getStylePaneRowList() {
  const lists = STYLE_PANE_ROW_LISTS
    .map(sel => [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null))
    .filter(rows => rows.length);
  if (!paneStyle) return lists[0] ?? [];
  return lists.find(rows => rows.some(el => isStylePaneRow(el, paneStyle.styleNo, paneStyle.color)))
    ?? lists.find(rows => rows.some(el => isStylePaneRow(el, paneStyle.styleNo)))
    ?? lists[0] ?? [];
}

/** ↑ / ↓: the style above or below in the list on screen. */
function moveStylePane(dir) {
  const rows = getStylePaneRowList();
  if (!rows.length) return;
  let i = rows.findIndex(el => isStylePaneRow(el, paneStyle.styleNo, paneStyle.color));
  // Showing a colour the list doesn't have: step from its style's row.
  if (i < 0) i = rows.findIndex(el => isStylePaneRow(el, paneStyle.styleNo));
  const next = rows[i < 0 ? 0 : i + dir];
  if (!next || !findStyle(next.dataset.styleNo, next.dataset.color)) return;
  openStylePane(next.dataset.styleNo, next.dataset.color);
  next.scrollIntoView({ block: "nearest" });
  // A row picked by click (js/row-quick-select.js) moves along with it.
  if (quickRows.size === 1 && next.parentElement === quickBody) {
    setQuickRows([next]);
    quickAnchor = next;
  }
}

/** ← / →: the style's other colours, round and round. */
function cycleStylePaneColor(dir) {
  if (!paneStyle) return;
  const colors = getStyleColors(paneStyle.styleNo);
  if (colors.length < 2) return;
  const i = colors.findIndex(c => c.color === paneStyle.color);
  const next = colors[(i + dir + colors.length) % colors.length];
  openStylePane(next.styleNo, next.color);
  const row = getStylePaneRowList().find(el => isStylePaneRow(el, next.styleNo, next.color));
  row?.scrollIntoView({ block: "nearest" });
}

function initStylePane() {
  document.getElementById("stylePaneClose")?.addEventListener("click", closeStylePane);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !paneStyle) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    closeStylePane();
  });
  // Caught first, while the pane is open: ← → here step colours rather than
  // turn the table's page (js/shortcuts.js), and ↑ ↓ move the pane, not just
  // the row highlight (js/row-quick-select.js).
  document.addEventListener("keydown", e => {
    if (!paneStyle || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    // Not while typing or picking from a list.
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "ArrowUp") moveStylePane(-1);
    else if (e.key === "ArrowDown") moveStylePane(1);
    else cycleStylePaneColor(e.key === "ArrowLeft" ? -1 : 1);
  }, true);
}
