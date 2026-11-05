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

/** The cost sheet's lines for a style, newest month first. */
function getStylePoLines(styleNo) {
  const key = styleNo.toUpperCase();
  return getAllPoLines()
    .filter(l => l.styleNo === key || l.styleNo === `${key}ST`)
    .sort((a, b) => b.month.localeCompare(a.month) || a.rowNo - b.rowNo);
}

function renderStylePaneSummary(style) {
  const field = (label, value) => {
    const l = document.createElement("span");
    l.className = "item-pane-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "item-pane-value";
    if (value instanceof Node) v.appendChild(value);
    else setDisplayText(v, value || EMPTY_DISPLAY);
    return [l, v];
  };

  // Folded to a one-line count; click to see every line. Stays open across
  // redraws of the same style.
  const lines = getStylePoLines(style.styleNo);
  const key = styleKey(style.styleNo, style.color);
  const posBox = document.createElement("details");
  posBox.className = "style-pane-pos-box";
  posBox.open = stylePanePosOpenFor === key;
  posBox.addEventListener("toggle", () => { stylePanePosOpenFor = posBox.open ? key : ""; });
  const posSummary = document.createElement("summary");
  posSummary.className = "style-pane-pos-summary";
  posSummary.textContent = `${lines.length} ${lines.length === 1 ? "PO" : "POs"}` +
    (lines.length ? ` · latest ${formatPoMonth(lines[0].month)}` : "");
  const pos = document.createElement("div");
  pos.className = "style-pane-pos";
  posBox.append(posSummary, pos);
  lines.forEach(line => {
    const row = document.createElement("div");
    row.className = "style-pane-po";
    const month = document.createElement("span");
    month.className = "style-pane-po-month";
    month.textContent = formatPoMonth(line.month);
    const store = document.createElement("span");
    store.className = "style-pane-po-store";
    store.textContent = `Store In ${line.storeIn ? formatMdy(line.storeIn) : EMPTY_DISPLAY}`;
    row.append(createPoLineChip(line), month, store);
    pos.appendChild(row);
  });

  document.getElementById("stylePaneSummary").replaceChildren(
    ...field("Description", style.description),
    ...field("Category", style.category),
    ...field("Season", style.season),
    ...field("N41 Status", style.status ? createStyleStatusPill(style.status) : ""),
    ...field("IHD", createIhdInput(style, { onSaved: () => refreshPhotoshootViews() })),
    ...field("Shoot", createStyleShootCell(style)),
    ...field("POs", lines.length ? posBox : ""),
    ...field("Notes", createStyleNotesInput(style, {
      multiline: true,
      // The Styles, Need to Shoot and POs tables show notes too.
      onSaved: () => {
        const view = getCurrentAppView();
        if (view === "styles") applyStyleFilters({ keepShown: true });
        else if (view === "needToShoot") renderNeedTable();
        else if (view === "pos") renderPoView();
      },
    })),
  );
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

function renderStylePanePhotos(style) {
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
  document.getElementById("stylePaneTitle").textContent = `${style.styleNo} · ${style.color}`;
  document.getElementById("stylePaneSubtitle").textContent = style.description || "";
  renderStylePaneSummary(style);
  renderStylePanePhotos(style);
}

/** Mark the open style's rows in whichever table is showing. */
function syncStylePaneRows() {
  document.querySelectorAll("tr.is-pane-open, .shoot-style-row.is-pane-open").forEach(tr => tr.classList.remove("is-pane-open"));
  if (!paneStyle) return;
  document.querySelectorAll("#stylesTableBody tr, #needTableBody tr, #poTableBody tr, #shootPaneStyles .shoot-style-row").forEach(tr => {
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

function initStylePane() {
  document.getElementById("stylePaneClose")?.addEventListener("click", closeStylePane);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !paneStyle) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    closeStylePane();
  });
}
