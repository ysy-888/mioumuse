/**
 * PO detail — one PO # + Style #, filling the page: it takes the place of
 * the view in the main area, while the menu, header and footer stay.
 * Opened from a PO box on the POs page or a PO in the style pane
 * (openPoDetail); Back, Esc or going to another page closes it.
 *
 *   Header   PO #, Open / Closed, its kind, the style and description, PO
 *            date, ETA — and the other styles on the same PO # to switch to.
 *   Colors   each colour on the PO, with its Samples: Show (the Style
 *            Master's user2, a count from N41), PP1–PP3 and TOP tick boxes
 *            (on the style — the same as its style pane).
 *   Fit      fit comments by round, PP 1, PP 2 … then TOP 1, TOP 2 …; only
 *            the rounds added are shown. Each has a date, the comment (saved
 *            as you type) and pictures (dropped, pasted or picked — kept in
 *            the private fit-photos bucket).
 */

let poDetail = null; // { poNo, styleNo, comments, request } while open
let poDetailRequest = 0;

const PO_DETAIL_ROUND_LABEL = { pp: "PP", top: "TOP" };

function isPoDetailOpen() {
  return Boolean(poDetail);
}

/** An error, in the app's messages (bottom right). */
function poDetailNotice(text) {
  if (text) showIndicator(text, "error");
}

/** The PO's lines for this style (a deleted PO still opens). */
function getPoDetailLines(poNo, styleNo) {
  return [...getAllPoLines(), ...getDeletedPoLines()]
    .filter(l => l.poNo === poNo && l.styleNo === styleNo)
    .sort((a, b) => a.color.localeCompare(b.color));
}

/** The other Style #s on the same PO #. */
function getPoDetailOtherStyles(poNo, styleNo) {
  return [...new Set(getAllPoLines().filter(l => l.poNo === poNo && l.styleNo !== styleNo).map(l => l.styleNo))].sort();
}

/** A colour on the PO in the Styles database (a set's …ST lines find the style without it). */
function findPoDetailStyle(styleNo, color) {
  return findStyle(styleNo, color) ?? getPoStyleColors(styleNo).find(s => s.color.trim().toUpperCase() === color.trim().toUpperCase()) ?? null;
}

async function openPoDetail(poNo, styleNo) {
  const el = document.getElementById("poDetail");
  if (!el) return;
  const request = ++poDetailRequest;
  poDetail = { poNo, styleNo, comments: [], loading: true, error: "", request };
  el.hidden = false;
  document.body.classList.add("is-po-detail-open");
  updateAppBackButton();
  closeColumnFilterPopover();
  renderPoDetail();
  el.querySelector(".po-detail-scroll")?.scrollTo({ top: 0 });
  try {
    const data = await loadPoDetailData(poNo, styleNo);
    if (poDetail?.request !== request) return;
    Object.assign(poDetail, data, { loading: false });
  } catch (err) {
    if (poDetail?.request !== request) return;
    Object.assign(poDetail, { loading: false, error: err.message || "Couldn't load the fit comments." });
  }
  renderPoDetail();
}

function closePoDetail() {
  if (!poDetail) return;
  poDetail = null;
  poDetailRequest += 1;
  const el = document.getElementById("poDetail");
  if (el) el.hidden = true;
  document.body.classList.remove("is-po-detail-open", "has-po-detail-pane");
  updateAppBackButton();
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function renderPoDetail() {
  if (!poDetail) return;
  const { poNo, styleNo } = poDetail;
  const lines = getPoDetailLines(poNo, styleNo);
  renderPoDetailHeader(poNo, styleNo, lines);
  const body = document.getElementById("poDetailBody");
  body.replaceChildren(createPoDetailColors(lines), createPoDetailFit());
}

/** `po` in the shape the POs page uses (createPoLineChip / createPoStatus). */
function poDetailSummary(poNo, lines) {
  const first = lines[0] ?? {};
  return {
    poNo,
    poDate: first.poDate ?? "",
    eta: first.etaFinal ?? first.eta ?? "",
    colors: lines.map(l => l.color),
    kinds: new Set(lines.map(l => l.kind).filter(Boolean)),
    statuses: new Set(lines.map(l => l.status).filter(Boolean)),
  };
}

function renderPoDetailHeader(poNo, styleNo, lines) {
  const po = poDetailSummary(poNo, lines);
  const style = getPoStyleColors(styleNo)[0];
  document.getElementById("poDetailTitle").textContent = `PO # ${poNo}`;
  const tags = document.getElementById("poDetailTags");
  tags.replaceChildren(...[po.kinds.size ? createPoLineChip(po) : null, createPoStatus(po)].filter(Boolean));

  const meta = document.getElementById("poDetailMeta");
  const item = (label, value) => {
    const wrap = document.createElement("span");
    wrap.className = "po-detail-meta-item";
    const l = document.createElement("span");
    l.className = "po-detail-meta-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "po-detail-meta-value";
    if (value instanceof Node) v.appendChild(value); else v.textContent = value || EMPTY_DISPLAY;
    wrap.append(l, v);
    return wrap;
  };
  const styleLink = document.createElement("span");
  styleLink.className = "po-detail-style";
  styleLink.textContent = styleNo;
  const items = [
    item("Style", styleLink),
    item("Description", style?.description ?? (lines.length ? "Not in the Styles database" : "")),
    item("PO date", po.poDate ? formatMdy(po.poDate) : ""),
    item("ETA", formatIhd(po.eta)),
  ];
  const others = getPoDetailOtherStyles(poNo, styleNo);
  if (others.length) {
    const list = document.createElement("span");
    list.className = "po-detail-others";
    others.forEach(other => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "po-detail-other";
      b.textContent = other;
      b.title = `Open PO # ${poNo} for ${other}`;
      b.addEventListener("click", () => openPoDetail(poNo, other));
      list.appendChild(b);
    });
    items.push(item("Also on this PO", list));
  }
  meta.replaceChildren(...items);
}

function createPoDetailSection(title, count, extra = []) {
  const section = document.createElement("section");
  section.className = "po-detail-section";
  const head = document.createElement("div");
  head.className = "po-detail-section-head";
  const h = document.createElement("h3");
  h.textContent = title;
  head.appendChild(h);
  if (count != null) {
    const n = document.createElement("span");
    n.className = "po-detail-count";
    n.textContent = String(count);
    head.appendChild(n);
  }
  if (extra.length) {
    const actions = document.createElement("div");
    actions.className = "po-detail-section-actions";
    actions.append(...extra);
    head.appendChild(actions);
  }
  section.appendChild(head);
  return section;
}

// ── Colours and their samples ────────────────────────────────────────────────

function createPoDetailColors(lines) {
  const section = createPoDetailSection("Colors", lines.length);
  if (!lines.length) {
    const empty = document.createElement("p");
    empty.className = "po-detail-empty";
    empty.textContent = "No colours on this PO.";
    section.appendChild(empty);
    return section;
  }
  const table = document.createElement("table");
  table.className = "po-detail-colors";
  table.innerHTML = `<thead>
    <tr><th rowspan="2" aria-label="Photo"></th><th rowspan="2">Color</th><th rowspan="2">N41</th><th rowspan="2">Available</th>
      <th colspan="2" class="po-detail-samples-head">Samples</th></tr>
    <tr><th title="Show samples — the Style Master's user2 (Import N41 Data)">Show</th><th title="Tick each sample when it's in — PP1, PP2, PP3 in order">PP / TOP</th></tr>
  </thead>`;
  const tbody = document.createElement("tbody");
  lines.forEach(line => {
    const style = findPoDetailStyle(line.styleNo, line.color);
    const tr = document.createElement("tr");
    // A colour in the Styles database opens its style pane on the right.
    if (style) {
      tr.className = "clickable-row po-detail-color-row";
      tr.dataset.styleNo = style.styleNo;
      tr.dataset.color = style.color;
      tr.title = `Open ${style.styleNo} ${style.color}`;
    }
    const td = (cls, content) => {
      const cell = document.createElement("td");
      if (cls) cell.className = cls;
      if (content instanceof Node) cell.appendChild(content);
      else setDisplayText(cell, content || EMPTY_DISPLAY);
      tr.appendChild(cell);
      return cell;
    };
    td("po-detail-thumb", createStyleThumb(style?.styleNo ?? line.styleNo, style?.color ?? line.color));
    const color = td("po-detail-color", line.color);
    if (!style) color.title = "Not in the Styles database";
    if (line.status) {
      const s = document.createElement("span");
      s.className = "po-detail-line-status";
      s.dataset.status = line.status.toLowerCase();
      s.textContent = line.status;
      color.appendChild(s);
    }
    td("", style ? createStyleStatusPill(style.status) : "");
    td("", style ? createAvailableWithIhd(style) : "");
    // Show samples: a count from N41.
    const show = td("po-detail-show", style?.show || "");
    if (style?.show) show.classList.add("has-show");
    // PP1–PP3 and TOP: ticked here or in the style pane (on the style's colour).
    // (Which sample goes to the shoot is picked on Need to Shoot / in the shoot.)
    td("po-detail-pp-cell", findStyle(line.styleNo, line.color) ? createSampleChecks(style) : "");
    tbody.appendChild(tr);
  });
  tbody.addEventListener("click", e => {
    const tr = e.target.closest("tr.po-detail-color-row");
    if (!tr || e.target.closest("button, a, input, select, label")) return;
    openStylePane(tr.dataset.styleNo, tr.dataset.color);
    if (paneStyle) document.body.classList.add("has-po-detail-pane");
  });
  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

/** Redraw just the colours (after a sample tick), leaving the fit comments as they are. */
function renderPoDetailColors() {
  if (!poDetail) return;
  const body = document.getElementById("poDetailBody");
  const old = body?.firstElementChild;
  if (!old) return;
  old.replaceWith(createPoDetailColors(getPoDetailLines(poDetail.poNo, poDetail.styleNo)));
  syncStylePaneRows();
}

// ── Fit comments ─────────────────────────────────────────────────────────────

function createPoDetailFit() {
  const d = poDetail;
  const addBtn = type => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-sm";
    const next = nextFitRound(type);
    b.textContent = `+ ${PO_DETAIL_ROUND_LABEL[type]} ${next}`;
    b.title = `Add fit comments for ${PO_DETAIL_ROUND_LABEL[type]} ${next}`;
    b.disabled = d.loading || Boolean(d.error);
    b.addEventListener("click", () => addFitRound(type));
    return b;
  };
  const section = createPoDetailSection("Fit comments", d.loading ? null : d.comments.length, [addBtn("pp"), addBtn("top")]);
  section.classList.add("po-detail-fit");
  if (d.loading || d.error || !d.comments.length) {
    const p = document.createElement("p");
    p.className = "po-detail-empty" + (d.error ? " is-error" : "");
    p.textContent = d.loading ? "Loading…" : d.error ? d.error : "No fit comments yet — add PP 1 to start.";
    section.appendChild(p);
    return section;
  }
  const list = document.createElement("div");
  list.className = "po-fit-list";
  list.append(...d.comments.map(createFitCard));
  section.appendChild(list);
  return section;
}

function nextFitRound(type) {
  return Math.max(0, ...poDetail.comments.filter(c => c.roundType === type).map(c => c.roundNo)) + 1;
}

async function addFitRound(type) {
  const d = poDetail;
  if (!d) return;
  const c = { roundType: type, roundNo: nextFitRound(type), comment: "", commentDate: todayYmd(), images: [] };
  try {
    await saveFitComment(d.poNo, d.styleNo, c);
  } catch (err) {
    poDetailNotice(err.message || "Couldn't add the round.");
    return;
  }
  if (poDetail !== d) return;
  d.comments.push(c);
  d.comments.sort(compareFitRounds);
  renderPoDetail();
  document.querySelector(`.po-fit-card[data-round="${type}${c.roundNo}"] textarea`)?.focus();
}

/** Save one round; `quiet` skips the success-free error toast's duplicate. */
async function persistFitComment(c, status) {
  const d = poDetail;
  if (!d) return false;
  status?.classList.remove("is-saved", "is-error");
  status && (status.textContent = "Saving…");
  try {
    await saveFitComment(d.poNo, d.styleNo, c);
    if (status) {
      status.textContent = "Saved";
      status.classList.add("is-saved");
    }
    return true;
  } catch (err) {
    if (status) {
      status.textContent = "Not saved";
      status.classList.add("is-error");
    }
    poDetailNotice(err.message || "Couldn't save the fit comment.");
    return false;
  }
}

function createFitCard(c) {
  const card = document.createElement("article");
  card.className = "po-fit-card";
  card.dataset.round = `${c.roundType}${c.roundNo}`;
  card.dataset.type = c.roundType;

  const head = document.createElement("div");
  head.className = "po-fit-head";
  const label = document.createElement("span");
  label.className = "po-fit-round";
  label.textContent = `${PO_DETAIL_ROUND_LABEL[c.roundType]} ${c.roundNo}`;
  const date = document.createElement("input");
  date.type = "date";
  date.className = "form-input po-fit-date";
  date.value = c.commentDate;
  date.setAttribute("aria-label", `Date of ${label.textContent}`);
  const status = document.createElement("span");
  status.className = "po-fit-status";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "po-fit-delete";
  del.innerHTML = PO_TRASH_ICON;
  del.title = `Delete ${label.textContent}`;
  del.setAttribute("aria-label", del.title);
  head.append(label, date, status, del);

  const text = document.createElement("textarea");
  text.className = "form-input po-fit-text";
  text.rows = 4;
  text.placeholder = "Fit comments…";
  text.value = c.comment;
  text.setAttribute("aria-label", `${label.textContent} comments`);

  const photos = document.createElement("div");
  photos.className = "po-fit-photos";

  card.append(head, text, photos);

  // Saved as you type (a pause), and when you leave the box.
  let timer = 0;
  const saveText = () => {
    clearTimeout(timer);
    if (text.value === c.comment) return;
    c.comment = text.value;
    persistFitComment(c, status);
  };
  text.addEventListener("input", () => {
    clearTimeout(timer);
    status.textContent = "";
    timer = setTimeout(saveText, 900);
  });
  text.addEventListener("blur", saveText);
  date.addEventListener("change", () => {
    c.commentDate = date.value;
    persistFitComment(c, status);
  });
  del.addEventListener("click", async () => {
    const has = c.comment.trim() || c.images.length;
    if (has && !confirm(`Delete ${label.textContent} — its comments and ${c.images.length} picture${c.images.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    const d = poDetail;
    try {
      await deleteFitComment(d.poNo, d.styleNo, c);
    } catch (err) {
      poDetailNotice(err.message || "Couldn't delete it.");
      return;
    }
    if (poDetail !== d) return;
    d.comments = d.comments.filter(x => x !== c);
    renderPoDetail();
  });

  // Pictures: dropped on the card, pasted into it, or picked.
  const addFiles = files => addFitPhotos(c, [...files].filter(f => f.type.startsWith("image/")), photos, status);
  card.addEventListener("dragover", e => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault();
    card.classList.add("is-dragover");
  });
  card.addEventListener("dragleave", e => {
    if (!card.contains(e.relatedTarget)) card.classList.remove("is-dragover");
  });
  card.addEventListener("drop", e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    card.classList.remove("is-dragover");
    addFiles(e.dataTransfer.files);
  });
  card.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  renderFitPhotos(c, photos, status, addFiles);
  return card;
}

function renderFitPhotos(c, wrap, status, addFiles = files => addFitPhotos(c, [...files], wrap, status)) {
  const tiles = c.images.map(img => {
    const tile = document.createElement("figure");
    tile.className = "po-fit-photo";
    tile.dataset.path = img.path;
    const link = document.createElement("a");
    link.target = "_blank";
    link.rel = "noopener";
    link.title = `${img.name || "Picture"} — open full size`;
    const pic = document.createElement("img");
    pic.alt = img.name || "Fit picture";
    pic.loading = "lazy";
    link.appendChild(pic);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "po-fit-photo-remove";
    remove.textContent = "✕";
    remove.title = "Remove this picture";
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", async () => {
      if (!confirm("Remove this picture? This can't be undone.")) return;
      const before = c.images;
      c.images = c.images.filter(i => i !== img);
      if (await persistFitComment(c, status)) {
        removeFitPhotos([img.path]);
        renderFitPhotos(c, wrap, status, addFiles);
      } else c.images = before;
    });
    tile.append(link, remove);
    return tile;
  });

  const add = document.createElement("label");
  add.className = "po-fit-add";
  add.title = "Add pictures — or drop / paste them on this round";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.hidden = true;
  input.addEventListener("change", () => {
    addFiles(input.files ?? []);
    input.value = "";
  });
  const plus = document.createElement("span");
  plus.className = "po-fit-add-plus";
  plus.textContent = "+";
  const hint = document.createElement("span");
  hint.textContent = "Pictures";
  add.append(input, plus, hint);
  wrap.replaceChildren(...tiles, add);

  // The signed links, once — they last an hour.
  const paths = c.images.map(i => i.path);
  if (paths.length) {
    getFitPhotoUrls(paths).then(urls => {
      wrap.querySelectorAll(".po-fit-photo").forEach(tile => {
        const url = urls.get(tile.dataset.path);
        if (!url) return tile.classList.add("is-error");
        tile.querySelector("a").href = url;
        tile.querySelector("img").src = url;
      });
    }).catch(() => wrap.querySelectorAll(".po-fit-photo").forEach(t => t.classList.add("is-error")));
  }
}

async function addFitPhotos(c, files, wrap, status) {
  const d = poDetail;
  if (!d || !files.length) return;
  status.classList.remove("is-saved", "is-error");
  const uploaded = [];
  try {
    for (const [i, file] of files.entries()) {
      status.textContent = `Uploading ${i + 1} of ${files.length}…`;
      uploaded.push(await uploadFitPhoto(d.poNo, d.styleNo, c, file));
    }
  } catch (err) {
    poDetailNotice(err.message || "Couldn't upload the picture.");
  }
  if (!uploaded.length) {
    status.textContent = "";
    return;
  }
  c.images = [...c.images, ...uploaded];
  if (await persistFitComment(c, status)) renderFitPhotos(c, wrap, status);
  else {
    c.images = c.images.filter(i => !uploaded.includes(i));
    removeFitPhotos(uploaded.map(u => u.path));
  }
}

function initPoDetail() {
  // First, so Escape here doesn't also close the style pane underneath.
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !poDetail) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // A style pane opened from a colour here closes first; one from the page underneath waits for Back.
    if (document.body.classList.contains("has-po-detail-pane") && paneStyle) {
      closeStylePane();
      return;
    }
    closePoDetail();
  }, true);
  // A file dropped beside a round shouldn't open in the tab.
  const el = document.getElementById("poDetail");
  el?.addEventListener("dragover", e => e.preventDefault());
  el?.addEventListener("drop", e => e.preventDefault());
}
