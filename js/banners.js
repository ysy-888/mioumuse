/**
 * Platforms — the banners on the online stores (Faire, FashionGo, Magento).
 *
 * A table of every banner with a thumbnail, filtered by platform from the
 * toolbar — a banner on several platforms shows under each of them — and a
 * side pane (the same build as the campaign / trade show pane) with the full
 * image and its details when a row is clicked.
 */

const PLATFORM_FILTER_ALL = "";

let bannerPlatformFilter = PLATFORM_FILTER_ALL;
let bannerSortCol = null;
let bannerSortDir = 1;
let filteredBanners = [];

/** Id of the banner in the pane, or null when it's closed. */
let paneBannerId = null;

// ── Columns ──────────────────────────────────────────────────────────────────

/** "Faire, FashionGo". */
function describeBannerPlatforms(banner) {
  return banner.platforms.map(getPlatformLabel).join(", ");
}

/** "4021 · Black, 4022 · Ivory" — for search and the pane. */
function describeBannerStyles(banner) {
  return banner.styles.map(s => [s.styleNo, s.color].filter(Boolean).join(" · ")).join(", ");
}

const BANNER_COLUMNS = {
  preview: { sortable: false },
  name: { value: b => b.name },
  type: { value: b => getBannerTypeLabel(b.type), compare: (a, b) => BANNER_TYPE_KEYS.indexOf(a.type) - BANNER_TYPE_KEYS.indexOf(b.type) },
  // Sorts on the first platform a banner runs on.
  platform: { value: describeBannerPlatforms, compare: (a, b) => PLATFORM_KEYS.indexOf(a.platforms[0]) - PLATFORM_KEYS.indexOf(b.platforms[0]) },
  size: { value: formatBannerSize, compare: (a, b) => (a.width * a.height) - (b.width * b.height) },
  styles: { value: describeBannerStyles, sortable: false },
  updated: { value: b => formatLongDate(b.updatedAt.slice(0, 10)), compare: (a, b) => a.updatedAt.localeCompare(b.updatedAt) },
};

const BANNER_SEARCH_COLUMNS = ["name", "type", "platform", "size", "styles"];

function compareBannersBy(col, a, b) {
  const column = BANNER_COLUMNS[col];
  if (column.compare) return column.compare(a, b);
  return compareTextFieldValues(column.value(a), column.value(b));
}

/** Default order: by platform, then name. */
function compareBannersForSort(a, b) {
  if (bannerSortCol) {
    const primary = compareBannersBy(bannerSortCol, a, b) * bannerSortDir;
    if (primary !== 0) return primary;
  }
  return compareBannersBy("platform", a, b) || compareBannersBy("name", a, b);
}

/** Cycle: unsorted → ascending → descending → unsorted. */
function sortBannersBy(col) {
  if (BANNER_COLUMNS[col]?.sortable === false) return;
  if (bannerSortCol === col) {
    if (bannerSortDir === 1) bannerSortDir = -1;
    else { bannerSortCol = null; bannerSortDir = 1; }
  } else {
    bannerSortCol = col;
    bannerSortDir = 1;
  }
  document.querySelectorAll("#bannersTable thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (bannerSortCol && th.dataset.col === bannerSortCol) {
      th.classList.add(bannerSortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });
  applyBannerFilters();
}

// ── Filter + render ──────────────────────────────────────────────────────────

function applyBannerFilters() {
  const q = (document.getElementById("bannerSearchInput")?.value ?? "").trim().toLowerCase();
  setActiveSearchQuery(q);

  filteredBanners = getAllBanners().filter(banner => {
    if (bannerPlatformFilter && !banner.platforms.includes(bannerPlatformFilter)) return false;
    if (!q) return true;
    return BANNER_SEARCH_COLUMNS.map(col => BANNER_COLUMNS[col].value(banner)).join(" ").toLowerCase().includes(q);
  });
  filteredBanners.sort(compareBannersForSort);

  renderBannersTable();
  const counter = document.getElementById("bannersRowCounter");
  if (counter) counter.textContent = filteredBanners.length === 1 ? "1 banner" : `${filteredBanners.length} banners`;
}

function createBannerThumb(banner, className) {
  const url = getBannerImageUrl(banner);
  if (!url) {
    const empty = document.createElement("span");
    empty.className = `${className} is-empty`;
    empty.textContent = "No image";
    return empty;
  }
  const img = document.createElement("img");
  img.className = className;
  img.src = url;
  img.alt = banner.name;
  img.loading = "lazy";
  return img;
}

function createPlatformPill(platform) {
  const pill = document.createElement("span");
  pill.className = "platform-pill";
  pill.dataset.platform = platform;
  mountSearchHighlightedText(pill, getPlatformLabel(platform));
  return pill;
}

/** A pill per platform the banner runs on. */
function createPlatformPills(platforms) {
  const wrap = document.createElement("span");
  wrap.className = "platform-pills";
  wrap.append(...platforms.map(createPlatformPill));
  return wrap;
}

function createBannerTypePill(type) {
  const pill = document.createElement("span");
  pill.className = "banner-type-pill";
  pill.dataset.bannerType = type;
  mountSearchHighlightedText(pill, getBannerTypeLabel(type));
  return pill;
}

function renderBannerStylesCell(td, banner) {
  if (banner.styles.length === 0) {
    setDisplayText(td, EMPTY_DISPLAY);
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "banner-style-chips";
  banner.styles.forEach(style => {
    const chip = document.createElement("span");
    chip.className = "banner-style-chip";
    mountSearchHighlightedText(chip, [style.styleNo, style.color].filter(Boolean).join(" · "));
    // Hover for what it is, from the Styles database.
    const found = findStyle(style.styleNo, style.color);
    if (found) chip.title = [found.description, found.status].filter(Boolean).join(" · ");
    wrap.appendChild(chip);
  });
  td.replaceChildren(wrap);
}

function renderBannersTable() {
  const tbody = document.getElementById("bannersTableBody");
  if (!tbody) return;
  const cols = [...document.querySelectorAll("#bannersTable thead th[data-col]")].map(th => th.dataset.col);

  if (filteredBanners.length === 0) {
    const msg = getAllBanners().length === 0
      ? "No banners yet — use Add banner to create one."
      : "No banners match the current filters.";
    tbody.innerHTML = `<tr class="state-row"><td colspan="${cols.length}">${escapeHtml(msg)}</td></tr>`;
    return;
  }

  tbody.replaceChildren(...filteredBanners.map(banner => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row" + (banner.id === paneBannerId ? " is-pane-row" : "");
    tr.dataset.bannerId = banner.id;
    cols.forEach(col => {
      const td = document.createElement("td");
      td.dataset.col = col;
      if (col === "preview") td.appendChild(createBannerThumb(banner, "banner-thumb"));
      else if (col === "platform") td.appendChild(createPlatformPills(banner.platforms));
      else if (col === "type") td.appendChild(createBannerTypePill(banner.type));
      else if (col === "styles") renderBannerStylesCell(td, banner);
      else mountSearchHighlightedText(td, BANNER_COLUMNS[col].value(banner));
      tr.appendChild(td);
    });
    return tr;
  }));
}

function syncBannerPlatformToolbar() {
  document.querySelectorAll("#bannerPlatformFilters .filter-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.platform === bannerPlatformFilter);
  });
}

/** The platform a new banner starts on: whichever the list is filtered to. */
function getBannerPlatformFilter() {
  return bannerPlatformFilter;
}

// ── Pane ─────────────────────────────────────────────────────────────────────

function isBannerPaneOpen() {
  return paneBannerId !== null;
}

/** Warn when the uploaded image isn't the size the banner is meant to be. */
function checkPaneImageSize(img, banner) {
  const note = document.getElementById("bannerPaneSizeNote");
  if (!note) return;
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return;
  if (!banner.width || !banner.height) {
    note.textContent = `Image is ${w} × ${h}.`;
    note.className = "banner-size-note";
  } else if (w !== banner.width || h !== banner.height) {
    note.textContent = `Image is ${w} × ${h} — not the ${formatBannerSize(banner)} this banner calls for.`;
    note.className = "banner-size-note is-mismatch";
  } else {
    note.textContent = `Image matches ${formatBannerSize(banner)}.`;
    note.className = "banner-size-note is-match";
  }
}

function renderBannerPane(banner) {
  const title = document.getElementById("bannerPaneTitle");
  if (title) title.textContent = banner.name;
  const subtitle = document.getElementById("bannerPaneSubtitle");
  if (subtitle) subtitle.textContent = [getBannerTypeLabel(banner.type), describeBannerPlatforms(banner), formatBannerSize(banner)].filter(Boolean).join(" · ");

  const preview = document.getElementById("bannerPanePreview");
  if (preview) {
    const note = document.createElement("span");
    note.id = "bannerPaneSizeNote";
    note.className = "banner-size-note";
    const url = getBannerImageUrl(banner);
    if (url) {
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = "Open full size";
      const img = createBannerThumb(banner, "banner-pane-image");
      // The one image on screen that matters — no lazy loading here.
      img.loading = "eager";
      img.addEventListener("load", () => checkPaneImageSize(img, banner));
      link.appendChild(img);
      preview.replaceChildren(link, note);
      if (img.complete) checkPaneImageSize(img, banner);
    } else {
      const empty = document.createElement("div");
      empty.className = "banner-pane-empty";
      const text = document.createElement("span");
      text.textContent = "No image uploaded yet.";
      const upload = document.createElement("button");
      upload.type = "button";
      upload.className = "btn";
      upload.textContent = "Upload image";
      upload.addEventListener("click", () => openBannerForm(banner.id));
      empty.append(text, upload);
      preview.replaceChildren(empty);
    }
  }

  const summary = document.getElementById("bannerPaneSummary");
  if (summary) {
    const fields = [
      ["Type", getBannerTypeLabel(banner.type)],
      [banner.platforms.length > 1 ? "Platforms" : "Platform", describeBannerPlatforms(banner)],
      ["Size", formatBannerSize(banner) || "Not set"],
      ["Updated", banner.updatedAt ? formatLongDate(banner.updatedAt.slice(0, 10)) : EMPTY_DISPLAY],
    ];
    summary.replaceChildren(...fields.flatMap(([label, value]) => {
      const l = document.createElement("span");
      l.className = "item-pane-label";
      l.textContent = label;
      const v = document.createElement("span");
      v.className = "item-pane-value";
      v.textContent = value;
      return [l, v];
    }));
  }

  const count = document.getElementById("bannerPaneStylesCount");
  if (count) count.textContent = `${banner.styles.length} of ${MAX_BANNER_STYLES}`;
  const styles = document.getElementById("bannerPaneStyles");
  if (styles) {
    if (banner.styles.length === 0) {
      const empty = document.createElement("span");
      empty.className = "item-tasks-empty";
      empty.textContent = "No styles listed.";
      styles.replaceChildren(empty);
    } else {
      // Description and N41 status come from the Styles database, when the
      // style is in it.
      const table = document.createElement("div");
      table.className = "banner-style-table banner-style-table--db";
      const rows = banner.styles.map(s => {
        const found = findStyle(s.styleNo, s.color);
        return [s.styleNo, s.color, found?.description ?? "", found?.status ?? ""];
      });
      [["Style #", "Color", "Description", "Status"], ...rows].forEach((cells, i) => {
        cells.forEach((text, col) => {
          const cell = document.createElement("span");
          if (i === 0) cell.className = "banner-style-head";
          if (i > 0 && col === 3 && text) {
            cell.appendChild(createStyleStatusPill(text));
          } else if (i > 0 && col === 0) {
            // The style's photo beside its number, from the linked image folder.
            cell.className = "banner-style-cell";
            cell.append(createStyleThumb(cells[0], cells[1], "banner-pane-photo"), document.createTextNode(text || EMPTY_DISPLAY));
          } else {
            cell.textContent = text || EMPTY_DISPLAY;
          }
          table.appendChild(cell);
        });
      });
      styles.replaceChildren(table);
    }
  }
}

function openBannerPane(id) {
  const banner = getBannerById(id);
  const pane = document.getElementById("bannerPane");
  if (!banner || !pane) return;
  // One pane at a time.
  closeItemPane();
  paneBannerId = banner.id;
  renderBannerPane(banner);
  closeBannerPaneMenu();
  pane.hidden = false;
  pane.querySelector(".item-pane-body")?.scrollTo({ top: 0 });
  renderBannersTable();
}

function closeBannerPane() {
  if (!paneBannerId) return;
  paneBannerId = null;
  closeBannerPaneMenu();
  const pane = document.getElementById("bannerPane");
  if (pane) pane.hidden = true;
  renderBannersTable();
}

/** Re-render after a change; closes the pane if its banner is gone. */
function refreshBannerViews() {
  if (paneBannerId) {
    const banner = getBannerById(paneBannerId);
    if (banner) renderBannerPane(banner);
    else closeBannerPane();
  }
  if (getCurrentAppView() === "platforms") applyBannerFilters();
}

function closeBannerPaneMenu() {
  const menu = document.getElementById("bannerPaneMenu");
  const btn = document.getElementById("bannerPaneMenuBtn");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function initBannerPane() {
  // A style's photo opens its full gallery — in the pane and in the banner form.
  ["bannerPaneStyles", "bannerFormStyles"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => {
      const thumb = e.target.closest(".style-thumb.has-image");
      if (thumb) openStyleGallery(thumb.dataset.style, thumb.dataset.color);
    });
  });

  const btn = document.getElementById("bannerPaneMenuBtn");
  const menu = document.getElementById("bannerPaneMenu");

  btn?.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", e => {
    if (!menu || menu.hidden) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeBannerPaneMenu();
  });

  document.getElementById("bannerMenuEdit")?.addEventListener("click", () => {
    closeBannerPaneMenu();
    if (paneBannerId) openBannerForm(paneBannerId);
  });

  document.getElementById("bannerMenuDelete")?.addEventListener("click", async () => {
    closeBannerPaneMenu();
    const banner = getBannerById(paneBannerId);
    if (!banner) return;
    if (!confirm(`Delete the banner "${banner.name}" and its image? This cannot be undone.`)) return;
    try {
      await deleteBanner(banner.id);
      refreshBannerViews();
      showIndicator(`${banner.name} deleted`, "success");
    } catch (err) {
      showIndicator(err.message || "Could not delete banner.", "error");
    }
  });

  document.getElementById("bannerPaneClose")?.addEventListener("click", closeBannerPane);

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !isBannerPaneOpen()) return;
    if (document.querySelector(".modal-backdrop.open")) return;
    if (menu && !menu.hidden) {
      closeBannerPaneMenu();
      return;
    }
    closeBannerPane();
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initBannersView() {
  const group = document.getElementById("bannerPlatformFilters");
  group?.replaceChildren(...[{ key: PLATFORM_FILTER_ALL, label: "All" }, ...PLATFORMS].map(option => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.dataset.platform = option.key;
    btn.textContent = option.label;
    btn.addEventListener("click", () => {
      bannerPlatformFilter = option.key;
      syncBannerPlatformToolbar();
      applyBannerFilters();
    });
    return btn;
  }));
  syncBannerPlatformToolbar();

  document.querySelectorAll("#bannersTable thead th[data-col]").forEach(th => {
    if (BANNER_COLUMNS[th.dataset.col]?.sortable === false) th.classList.add("th-no-sort");
    th.addEventListener("click", () => sortBannersBy(th.dataset.col));
  });

  document.getElementById("bannerSearchInput")?.addEventListener("input", applyBannerFilters);

  document.getElementById("bannersTableBody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-banner-id]");
    if (tr) openBannerPane(tr.dataset.bannerId);
  });

  initBannerPane();
}
