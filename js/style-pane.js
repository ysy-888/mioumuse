/**
 * The style pane — click a style on Styles, Need to Shoot or POs and it
 * opens on the right: the style's details at the top (IHD and the shoot
 * buttons editable), its PO lines, then every photo of it, one under the
 * other, read from the linked image folder.
 */

let paneStyle = null; // { styleNo, color } while the pane is open
let stylePaneUrls = [];

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

  const pos = document.createElement("div");
  pos.className = "style-pane-pos";
  getStylePoLines(style.styleNo).forEach(line => {
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
    ...field("POs", pos.childElementCount ? pos : ""),
  );
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
  };
  const entries = getStyleImageEntries(style.styleNo, style.color);
  count.textContent = arePhotosKnown() ? String(entries.length) : "";
  if (styleImageState === "needs-permission") return note("Reconnect the image folder (Styles → menu ⋮) to see photos.");
  if (styleImageState !== "ready" && styleImageState !== "scanning") return note("Link the image folder (Styles → menu ⋮) to see photos.");
  if (!entries.length) return note(`No photos named "${style.styleNo} ${style.color.replace(/\//g, ".")} …" in the folder.`);

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
  document.querySelectorAll("tr.is-pane-open").forEach(tr => tr.classList.remove("is-pane-open"));
  if (!paneStyle) return;
  document.querySelectorAll("#stylesTableBody tr, #needTableBody tr, #poTableBody tr").forEach(tr => {
    if (tr.dataset.styleNo === paneStyle.styleNo && tr.dataset.color === paneStyle.color) tr.classList.add("is-pane-open");
  });
}

function openStylePane(styleNo, color) {
  const pane = document.getElementById("stylePane");
  if (!pane || !findStyle(styleNo, color)) return;
  // One pane at a time.
  closeItemPane();
  closeShootPane();
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

function initStylePane() {
  document.getElementById("stylePaneClose")?.addEventListener("click", closeStylePane);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !paneStyle) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    closeStylePane();
  });
}
