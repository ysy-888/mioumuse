/**
 * Add / edit banner modal.
 *
 * Type, platform(s), name, pixel size, the image currently on display, and
 * the styles it features — Style # and Color, one row to start, up to
 * MAX_BANNER_STYLES.
 *
 * Platforms pick one at a time by default; ticking "Multiple platforms"
 * turns the same buttons into toggles so a banner can run on several.
 *
 * Picking an image reads its real size: an empty size fills in from it, and a
 * size that doesn't match gets a warning (not a block — a banner can be
 * scaled on purpose).
 */

let bannerFormMode = "create";
let bannerFormId = null;

/** A newly picked image waiting to upload on save, or null. */
let bannerFormFile = null;
/** True when the existing image has been removed in this edit. */
let bannerFormRemoveImage = false;
/** Object URL previewing `bannerFormFile`, revoked when replaced or closed. */
let bannerFormPreviewUrl = "";
/** The picked image's real pixel size, once it has loaded. */
let bannerFormImageSize = null;

// ── Type picker ──────────────────────────────────────────────────────────────

function fillBannerTypePicker() {
  const row = document.getElementById("bannerFormType");
  if (!row) return;
  row.replaceChildren(...BANNER_TYPES.map(type => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn";
    btn.dataset.value = type.key;
    btn.textContent = type.label;
    btn.setAttribute("aria-pressed", "false");
    // Always exactly one type — clicking the active one keeps it.
    btn.addEventListener("click", () => setBannerTypeValue(type.key));
    return btn;
  }));
}

function setBannerTypeValue(value) {
  document.querySelectorAll("#bannerFormType .form-toggle-btn").forEach(btn => {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getBannerTypeValue() {
  return document.querySelector("#bannerFormType .form-toggle-btn.is-active")?.dataset.value ?? BANNER_TYPE_KEYS[0];
}

// ── Platform picker ──────────────────────────────────────────────────────────

function isMultiPlatformOn() {
  return document.getElementById("bannerFormMultiPlatform")?.checked === true;
}

function fillBannerPlatformPicker() {
  const row = document.getElementById("bannerFormPlatform");
  if (!row) return;
  row.replaceChildren(...PLATFORMS.map(platform => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "form-toggle-btn item-toggle";
    btn.dataset.value = platform.key;
    btn.dataset.platform = platform.key;
    btn.textContent = platform.label;
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      if (isMultiPlatformOn()) {
        setPlatformButton(btn, !btn.classList.contains("is-active"));
      } else {
        setBannerPlatformValues([platform.key]);
      }
      row.classList.remove("is-invalid");
    });
    return btn;
  }));
}

function setPlatformButton(btn, on) {
  btn.classList.toggle("is-active", on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function setBannerPlatformValues(values) {
  const set = new Set(values);
  document.querySelectorAll("#bannerFormPlatform .form-toggle-btn").forEach(btn => {
    setPlatformButton(btn, set.has(btn.dataset.value));
  });
}

function getBannerPlatformValues() {
  return [...document.querySelectorAll("#bannerFormPlatform .form-toggle-btn.is-active")]
    .map(btn => btn.dataset.value);
}

/**
 * Switching back to one platform keeps the first one picked, so the form
 * never claims a single platform while showing several lit.
 */
function syncMultiPlatformMode() {
  if (!isMultiPlatformOn()) {
    const [first] = getBannerPlatformValues();
    setBannerPlatformValues(first ? [first] : []);
  }
  const hint = document.getElementById("bannerFormPlatformHint");
  if (hint) hint.textContent = isMultiPlatformOn() ? "Pick every platform this banner runs on." : "";
}

// ── Styles ───────────────────────────────────────────────────────────────────

// ── Styles database lookups ──────────────────────────────────────────────────
//
// Style # suggests numbers from the Styles database as you type; once it
// matches, Color offers that style's colours, and a line under the row shows
// the description and N41 status. Both stay free text — a style that isn't
// in the database (yet) can still be entered.

let bannerColorListSeq = 0;

/** The shared Style # suggestions, refreshed whenever the database grew. */
function fillStyleNumberList() {
  const list = document.getElementById("styleNumberList");
  if (!list) return;
  const numbers = getStyleNumbers();
  if (list.childElementCount === numbers.length) return;
  list.replaceChildren(...numbers.map(n => new Option(n)));
}

function updateBannerStyleMatch(row) {
  const styleNo = row.querySelector(".banner-style-no").value.trim();
  const color = row.querySelector(".banner-style-color").value.trim();
  const colorList = document.getElementById(row.querySelector(".banner-style-color").getAttribute("list"));
  const note = row.querySelector(".banner-style-match");

  const colors = styleNo ? getStyleColors(styleNo) : [];
  colorList?.replaceChildren(...colors.map(s => new Option(s.color)));

  // The photo for this Style # + Color, from the linked image folder.
  const thumb = row.querySelector(".style-thumb");
  if (thumb && typeof createStyleThumb === "function") {
    thumb.replaceWith(createStyleThumb(styleNo, color, "banner-style-photo"));
  }

  note.className = "banner-style-match";
  if (!styleNo || getAllStyles().length === 0) {
    note.textContent = "";
    return;
  }
  if (colors.length === 0) {
    note.textContent = "Not in the Styles database.";
    note.classList.add("is-unknown");
    return;
  }
  const match = color ? findStyle(styleNo, color) : null;
  if (match) {
    note.textContent = [match.description, match.category, match.season, match.status].filter(Boolean).join(" · ");
    note.classList.add("is-match");
  } else if (color) {
    note.textContent = `${colors[0].description} — color not listed for this style (has ${colors.map(s => s.color).join(", ")}).`;
    note.classList.add("is-unknown");
  } else {
    note.textContent = `${colors[0].description} — ${colors.length === 1 ? "1 color" : `${colors.length} colors`}: ${colors.map(s => s.color).join(", ")}.`;
  }
}

function createBannerStyleRow(style = {}) {
  const row = document.createElement("div");
  row.className = "banner-style-row";

  const styleNo = document.createElement("input");
  styleNo.type = "text";
  styleNo.className = "form-input banner-style-no";
  styleNo.placeholder = "Style #";
  styleNo.autocomplete = "off";
  styleNo.value = style.styleNo ?? "";
  styleNo.setAttribute("aria-label", "Style #");
  styleNo.setAttribute("list", "styleNumberList");

  const colorListId = `bannerColorList-${++bannerColorListSeq}`;
  const colorList = document.createElement("datalist");
  colorList.id = colorListId;

  const color = document.createElement("input");
  color.type = "text";
  color.className = "form-input banner-style-color";
  color.placeholder = "Color";
  color.autocomplete = "off";
  color.value = style.color ?? "";
  color.setAttribute("aria-label", "Color");
  color.setAttribute("list", colorListId);

  const note = document.createElement("span");
  note.className = "banner-style-match";

  // A style # with only one colour fills it in.
  styleNo.addEventListener("input", () => updateBannerStyleMatch(row));
  styleNo.addEventListener("change", () => {
    const colors = getStyleColors(styleNo.value);
    if (colors.length === 1 && !color.value.trim()) color.value = colors[0].color;
    updateBannerStyleMatch(row);
  });
  color.addEventListener("input", () => updateBannerStyleMatch(row));

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn-close banner-style-remove";
  remove.textContent = "✕";
  remove.title = "Remove style";
  remove.setAttribute("aria-label", "Remove style");
  remove.addEventListener("click", () => {
    row.remove();
    syncBannerStyleRows();
  });

  const photo = document.createElement("span");
  photo.className = "style-thumb banner-style-photo is-empty";

  row.append(photo, styleNo, color, remove, colorList, note);
  updateBannerStyleMatch(row);
  return row;
}

/** One row minimum (no ✕ on it), MAX_BANNER_STYLES maximum (no + past it). */
function syncBannerStyleRows() {
  const list = document.getElementById("bannerFormStyles");
  if (!list) return;
  if (list.children.length === 0) list.appendChild(createBannerStyleRow());
  const rows = list.querySelectorAll(".banner-style-row");
  rows.forEach(row => {
    row.querySelector(".banner-style-remove").hidden = rows.length === 1;
  });
  const add = document.getElementById("bannerFormAddStyle");
  if (add) {
    add.disabled = rows.length >= MAX_BANNER_STYLES;
    add.textContent = rows.length >= MAX_BANNER_STYLES
      ? `Up to ${MAX_BANNER_STYLES} styles`
      : "+ Add style";
  }
}

function setBannerFormStyles(styles) {
  const list = document.getElementById("bannerFormStyles");
  if (!list) return;
  list.replaceChildren(...(styles.length ? styles : [{}]).map(createBannerStyleRow));
  syncBannerStyleRows();
}

function getBannerFormStyles() {
  return [...document.querySelectorAll("#bannerFormStyles .banner-style-row")].map(row => ({
    styleNo: row.querySelector(".banner-style-no").value,
    color: row.querySelector(".banner-style-color").value,
  }));
}

// ── Image ────────────────────────────────────────────────────────────────────

function revokeBannerPreview() {
  if (bannerFormPreviewUrl) URL.revokeObjectURL(bannerFormPreviewUrl);
  bannerFormPreviewUrl = "";
}

/** The image the form is showing: a new pick, the saved one, or none. */
function renderBannerFormImage() {
  const wrap = document.getElementById("bannerFormImage");
  if (!wrap) return;

  const banner = bannerFormId ? getBannerById(bannerFormId) : null;
  const savedUrl = banner && !bannerFormRemoveImage ? getBannerImageUrl(banner) : "";
  const url = bannerFormPreviewUrl || savedUrl;

  const remove = document.getElementById("bannerFormRemoveImage");
  const pickLabel = document.getElementById("bannerFormPickLabel");
  if (remove) remove.hidden = !url;
  if (pickLabel) pickLabel.textContent = url ? "Replace image" : "Choose image";

  if (!url) {
    const empty = document.createElement("div");
    empty.className = "banner-drop-empty";
    empty.textContent = "Drop an image here, or choose one below.";
    wrap.replaceChildren(empty);
    updateBannerSizeHint();
    return;
  }

  const img = document.createElement("img");
  img.className = "banner-form-preview";
  img.alt = "Banner preview";
  img.src = url;
  img.addEventListener("load", () => {
    bannerFormImageSize = { width: img.naturalWidth, height: img.naturalHeight };
    // An empty size fills in from a newly picked image.
    const w = document.getElementById("bannerFormWidth");
    const h = document.getElementById("bannerFormHeight");
    if (bannerFormFile && w && h && !w.value && !h.value) {
      w.value = String(img.naturalWidth);
      h.value = String(img.naturalHeight);
    }
    updateBannerSizeHint();
  });
  wrap.replaceChildren(img);
}

function updateBannerSizeHint() {
  const hint = document.getElementById("bannerFormSizeHint");
  if (!hint) return;
  const w = Number(document.getElementById("bannerFormWidth")?.value) || 0;
  const h = Number(document.getElementById("bannerFormHeight")?.value) || 0;
  const hasImage = Boolean(bannerFormPreviewUrl) ||
    (bannerFormId && !bannerFormRemoveImage && getBannerById(bannerFormId)?.imagePath);
  const size = hasImage ? bannerFormImageSize : null;

  hint.classList.remove("is-mismatch");
  if (!size) {
    hint.textContent = "";
  } else if (w && h && (w !== size.width || h !== size.height)) {
    hint.textContent = `The image is ${size.width} × ${size.height}, not ${w} × ${h}.`;
    hint.classList.add("is-mismatch");
  } else {
    hint.textContent = `Image is ${size.width} × ${size.height}.`;
  }
}

function pickBannerFile(file) {
  if (!file) return;
  try {
    checkBannerFile(file);
  } catch (err) {
    setBannerFormMessage(err.message, "error");
    return;
  }
  setBannerFormMessage("");
  revokeBannerPreview();
  bannerFormFile = file;
  bannerFormRemoveImage = false;
  bannerFormImageSize = null;
  bannerFormPreviewUrl = URL.createObjectURL(file);
  renderBannerFormImage();
}

function removeBannerFormImage() {
  revokeBannerPreview();
  bannerFormFile = null;
  bannerFormImageSize = null;
  // Only an image that's already saved needs removing on save.
  bannerFormRemoveImage = Boolean(bannerFormId && getBannerById(bannerFormId)?.imagePath);
  const input = document.getElementById("bannerFormFile");
  if (input) input.value = "";
  renderBannerFormImage();
}

// ── Open / close ─────────────────────────────────────────────────────────────

function setBannerFormMessage(text, type = "") {
  const el = document.getElementById("bannerFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

/** Pass an id to edit; omit it to create. */
function openBannerForm(bannerId = null) {
  const overlay = document.getElementById("bannerFormOverlay");
  if (!overlay) return;

  const banner = bannerId ? getBannerById(bannerId) : null;
  bannerFormMode = banner ? "edit" : "create";
  bannerFormId = banner?.id ?? null;
  bannerFormFile = null;
  bannerFormRemoveImage = false;
  bannerFormImageSize = null;
  revokeBannerPreview();

  const title = document.getElementById("bannerFormTitle");
  if (title) title.textContent = banner ? "Edit banner" : "Add banner";

  setBannerTypeValue(banner?.type ?? BANNER_TYPE_KEYS[0]);
  // A new banner starts on whichever platform the list is filtered to.
  const platforms = banner?.platforms ?? [getBannerPlatformFilter() || PLATFORM_KEYS[0]];
  document.getElementById("bannerFormMultiPlatform").checked = platforms.length > 1;
  setBannerPlatformValues(platforms);
  syncMultiPlatformMode();
  document.getElementById("bannerFormName").value = banner?.name ?? "";
  document.getElementById("bannerFormWidth").value = banner?.width || "";
  document.getElementById("bannerFormHeight").value = banner?.height || "";
  document.getElementById("bannerFormFile").value = "";
  fillStyleNumberList();
  setBannerFormStyles(banner?.styles ?? []);
  renderBannerFormImage();

  document.querySelectorAll("#bannerForm .is-invalid").forEach(el => el.classList.remove("is-invalid"));
  setBannerFormMessage("");
  overlay.classList.add("open");
  requestAnimationFrame(() => document.getElementById("bannerFormName")?.focus());
}

function closeBannerForm() {
  document.getElementById("bannerFormOverlay")?.classList.remove("open");
  revokeBannerPreview();
  bannerFormId = null;
  bannerFormFile = null;
}

function isBannerFormOpen() {
  return document.getElementById("bannerFormOverlay")?.classList.contains("open") === true;
}

// ── Save ─────────────────────────────────────────────────────────────────────

async function saveBannerForm() {
  document.querySelectorAll("#bannerForm .is-invalid").forEach(el => el.classList.remove("is-invalid"));
  setBannerFormMessage("");

  const fields = {
    type: getBannerTypeValue(),
    platforms: getBannerPlatformValues(),
    name: (document.getElementById("bannerFormName")?.value ?? "").trim(),
    width: document.getElementById("bannerFormWidth")?.value ?? "",
    height: document.getElementById("bannerFormHeight")?.value ?? "",
    styles: getBannerFormStyles(),
  };

  if (fields.platforms.length === 0) {
    document.getElementById("bannerFormPlatform")?.classList.add("is-invalid");
    setBannerFormMessage(isMultiPlatformOn() ? "Pick at least one platform." : "Pick a platform.", "error");
    return;
  }
  if (!fields.name) {
    document.getElementById("bannerFormName")?.classList.add("is-invalid");
    document.getElementById("bannerFormName")?.focus();
    setBannerFormMessage("Give the banner a name.", "error");
    return;
  }
  // Both or neither — half a size is a typo.
  if (Boolean(Number(fields.width)) !== Boolean(Number(fields.height))) {
    document.getElementById(Number(fields.width) ? "bannerFormHeight" : "bannerFormWidth")?.classList.add("is-invalid");
    setBannerFormMessage("Enter both the width and the height.", "error");
    return;
  }

  const saveBtn = document.getElementById("bannerFormSaveBtn");
  if (saveBtn) saveBtn.disabled = true;
  setBannerFormMessage(bannerFormFile ? "Uploading…" : "Saving…");

  try {
    if (bannerFormMode === "edit") {
      const image = bannerFormFile ?? (bannerFormRemoveImage ? false : null);
      const updated = await updateBanner(bannerFormId, fields, image);
      closeBannerForm();
      refreshBannerViews();
      showIndicator(`${updated.name} updated`, "success");
    } else {
      const created = await createBanner(fields, bannerFormFile);
      closeBannerForm();
      refreshBannerViews();
      showIndicator(`${created.name} added`, "success");
      openBannerPane(created.id);
    }
  } catch (err) {
    setBannerFormMessage(err.message || "Could not save.", "error");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initBannerForm() {
  fillBannerTypePicker();
  fillBannerPlatformPicker();
  document.getElementById("bannerFormMultiPlatform")?.addEventListener("change", syncMultiPlatformMode);

  document.getElementById("addBannerBtn")?.addEventListener("click", () => openBannerForm());
  document.getElementById("bannerFormSaveBtn")?.addEventListener("click", saveBannerForm);
  document.getElementById("bannerFormCancelBtn")?.addEventListener("click", closeBannerForm);
  document.getElementById("bannerFormCloseBtn")?.addEventListener("click", closeBannerForm);

  document.getElementById("bannerFormAddStyle")?.addEventListener("click", () => {
    const list = document.getElementById("bannerFormStyles");
    if (!list || list.children.length >= MAX_BANNER_STYLES) return;
    const row = createBannerStyleRow();
    list.appendChild(row);
    syncBannerStyleRows();
    row.querySelector("input")?.focus();
  });

  const fileInput = document.getElementById("bannerFormFile");
  fileInput?.addEventListener("change", () => pickBannerFile(fileInput.files?.[0]));
  document.getElementById("bannerFormRemoveImage")?.addEventListener("click", removeBannerFormImage);

  // Drag an image straight onto the preview.
  const drop = document.getElementById("bannerFormImage");
  drop?.addEventListener("dragover", e => {
    e.preventDefault();
    drop.classList.add("is-dragover");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
  drop?.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("is-dragover");
    pickBannerFile(e.dataTransfer?.files?.[0]);
  });

  ["bannerFormWidth", "bannerFormHeight"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      document.getElementById(id).classList.remove("is-invalid");
      updateBannerSizeHint();
    });
  });
  document.getElementById("bannerFormName")?.addEventListener("input", e => e.target.classList.remove("is-invalid"));

  // Enter saves from any single-line field.
  document.getElementById("bannerForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.type === "file" || e.target.type === "checkbox") return;
    e.preventDefault();
    saveBannerForm();
  });

  const overlay = document.getElementById("bannerFormOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeBannerForm();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && isBannerFormOpen()) closeBannerForm();
  });
}
