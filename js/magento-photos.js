/**
 * Magento product photos, in the product pane: every photo in the gallery,
 * side by side, and — once the full product has loaded — edited in place.
 *
 *   Add       the + tile, or drop image files onto the photos
 *   Main      ★ makes a photo the one listings show (Base, Small, Thumbnail)
 *   Hide      👁 keeps it in Magento but off the product page; again to show
 *   Delete    🗑 removes it from Magento for good (asks first)
 *   Reorder   drag a photo before or after another
 *
 * Every change saves to Magento at once, like the Enabled switch, and the
 * gallery redraws from what Magento kept. Photos over 4 MB or 3,000 px are
 * shrunk to a 3,000 px JPEG first, so they fit through the helper.
 */

const MG_PHOTO_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MG_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const MG_PHOTO_MAX_PX = 3000;

let mgPhotoBusy = false;
let mgPhotoDragId = null;

const MG_PHOTO_ICONS = {
  main: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>',
  hide: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"/></svg>',
  show: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  delete: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  add: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

/** The photo listings show: the one with the Base role, else the thumbnail's file. */
function isMgMainPhoto(photo, product) {
  return product.gallery.some(p => p.types.includes("image"))
    ? photo.types.includes("image")
    : photo.file === product.image;
}

const canEditMgPhotos = product => Array.isArray(product.gallery) && !mgPane?.loading;

function createMgPhotoButton(action, label, icon) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mg-photo-btn";
  btn.dataset.photoAction = action;
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = icon;
  return btn;
}

function createMgPhotoTile(photo, product, i, count, editable) {
  const url = getMgImageUrl({ image: photo.file });
  const tile = document.createElement("div");
  tile.className = "mg-pane-image";
  tile.dataset.id = photo.id ?? "";
  const main = editable && isMgMainPhoto(photo, product);
  tile.classList.toggle("is-main", main);
  tile.classList.toggle("is-hidden", Boolean(photo.disabled));
  if (editable) tile.draggable = !mgPhotoBusy;

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.title = "Open full size";
  link.draggable = false;
  const img = document.createElement("img");
  img.src = url;
  img.alt = photo.label || (count > 1 ? `${product.name} — photo ${i + 1}` : product.name);
  img.loading = i < 3 ? "eager" : "lazy";
  img.draggable = false;
  link.appendChild(img);
  tile.appendChild(link);
  if (!editable) return tile;

  const badges = document.createElement("div");
  badges.className = "mg-photo-badges";
  if (main) badges.appendChild(Object.assign(document.createElement("span"), { className: "mg-photo-badge is-main", textContent: "Main" }));
  if (photo.disabled) badges.appendChild(Object.assign(document.createElement("span"), { className: "mg-photo-badge", textContent: "Hidden" }));
  tile.appendChild(badges);

  const tools = document.createElement("div");
  tools.className = "mg-photo-tools";
  if (!main) tools.appendChild(createMgPhotoButton("main", "Make main photo", MG_PHOTO_ICONS.main));
  tools.appendChild(photo.disabled
    ? createMgPhotoButton("show", "Show on the product page", MG_PHOTO_ICONS.show)
    : createMgPhotoButton("hide", "Hide from the product page", MG_PHOTO_ICONS.hide));
  tools.appendChild(createMgPhotoButton("delete", "Delete from Magento", MG_PHOTO_ICONS.delete));
  tile.appendChild(tools);
  return tile;
}

/**
 * The pane's photos: the gallery once the product has loaded (editable),
 * else the list's one image. Redrawn only when something changed, so the
 * photos don't flicker.
 */
function renderMgPaneImages(product) {
  const preview = document.getElementById("mgPanePreview");
  if (!preview) return;
  // A Grouped product has no photos of its own: the storefront shows its
  // items' photos, led by the first item's (order them under Simple items).
  if (product.type === "grouped") {
    preview.hidden = true;
    preview.replaceChildren();
    delete preview.dataset.key;
    return;
  }
  const editable = canEditMgPhotos(product);
  const photos = Array.isArray(product.gallery)
    ? product.gallery.filter(p => editable || !p.disabled)
    : (product.images?.length ? product.images : [product.image])
      .filter(file => file && file !== "no_selection")
      .map(file => ({ file, types: [], disabled: false }));
  const key = JSON.stringify([product.sku, editable, mgPhotoBusy, product.image, photos]);
  if (preview.dataset.key !== key) {
    const sameProduct = preview.dataset.sku === product.sku;
    const scroll = preview.scrollLeft;
    preview.dataset.key = key;
    preview.dataset.sku = product.sku;
    const tiles = photos.map((photo, i) => createMgPhotoTile(photo, product, i, photos.length, editable));
    if (editable) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "mg-photo-add";
      add.dataset.photoAction = "add";
      add.disabled = mgPhotoBusy;
      add.innerHTML = `${MG_PHOTO_ICONS.add}<span>${photos.length ? "Add photos" : "Add a photo"}</span><small>or drop files here</small>`;
      tiles.push(add);
    }
    preview.replaceChildren(...tiles);
    preview.scrollLeft = sameProduct ? scroll : 0;
  }
  preview.classList.toggle("is-editable", editable);
  preview.classList.toggle("is-busy", mgPhotoBusy);
  preview.classList.toggle("is-single", photos.length === 1 && !editable);
  preview.hidden = !photos.length && !editable;
}

/** What Magento kept, into the pane and the table row. */
function applyMgPhotos(sku, media) {
  if (mgPane?.saved.sku === sku) {
    [mgPane.saved, mgPane.draft].forEach(p => Object.assign(p, { gallery: media.gallery, images: media.images, image: media.image }));
  }
  const row = mgPage.items.find(p => p.sku === sku);
  if (row) row.image = media.image;
  if (mgPane) renderMagentoPane();
  if (getCurrentAppView() === "magento") renderMgProducts();
}

/** One save; the gallery is locked until it's back. */
async function runMgPhotoChange(action, params, busyText) {
  const sku = mgPane?.saved.sku;
  if (!sku || mgPhotoBusy) return false;
  mgPhotoBusy = true;
  renderMagentoPane();
  setAppLoading(true, busyText);
  try {
    applyMgPhotos(sku, await callMagento(action, { sku, ...params }));
    return true;
  } catch (err) {
    showIndicator(err.message || "Couldn't change the photo.", "error");
    return false;
  } finally {
    mgPhotoBusy = false;
    setAppLoading(false);
    if (mgPane) renderMagentoPane();
  }
}

// ── Adding ───────────────────────────────────────────────────────────────────

function readFileAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

/** The photo as { mime, data }: as it is, or shrunk to a JPEG when it's big. */
async function prepareMgPhoto(file) {
  let mime = file.type;
  let blob = file;
  if (mime !== "image/gif") {
    const bitmap = await createImageBitmap(file).catch(() => null);
    const longest = bitmap ? Math.max(bitmap.width, bitmap.height) : 0;
    if (bitmap && (file.size > MG_PHOTO_MAX_BYTES || longest > MG_PHOTO_MAX_PX)) {
      const scale = Math.min(1, MG_PHOTO_MAX_PX / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // a see-through PNG gets white behind it
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
      mime = "image/jpeg";
    }
    bitmap?.close?.();
  }
  const dataUrl = await readFileAsDataUrl(blob);
  return { mime, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

/** Each file in turn, so they land in the order picked. */
async function addMgPhotos(files) {
  const list = [...files];
  const photos = list.filter(f => MG_PHOTO_TYPES.includes(f.type));
  if (photos.length < list.length) showIndicator("Only JPG, PNG, GIF and WebP photos can go to Magento — the rest were skipped.", "error");
  let added = 0;
  for (const [i, file] of photos.entries()) {
    let prepared;
    try {
      prepared = await prepareMgPhoto(file);
    } catch (err) {
      showIndicator(`${file.name}: ${err.message}`, "error");
      continue;
    }
    const label = photos.length > 1 ? `Uploading photo ${i + 1} of ${photos.length}...` : "Uploading photo...";
    if (!await runMgPhotoChange("photoAdd", { name: file.name, ...prepared }, label)) break;
    added += 1;
  }
  if (added) showIndicator(added === 1 ? "Photo added to Magento" : `${added} photos added to Magento`, "success");
}

// ── Reordering ───────────────────────────────────────────────────────────────

function clearMgPhotoDropMarks() {
  document.querySelectorAll("#mgPanePreview .is-drop-before, #mgPanePreview .is-drop-after")
    .forEach(el => el.classList.remove("is-drop-before", "is-drop-after"));
}

/** Where a dragged photo would land: before or after the tile it's over. */
function mgPhotoDropSide(tile, e) {
  const box = tile.getBoundingClientRect();
  return e.clientX < box.left + box.width / 2 ? "before" : "after";
}

async function dropMgPhoto(targetId, side) {
  const order = (mgPane?.saved.gallery ?? []).map(p => p.id).filter(id => id !== mgPhotoDragId);
  const at = order.indexOf(targetId);
  if (at < 0) return;
  order.splice(side === "before" ? at : at + 1, 0, mgPhotoDragId);
  const now = mgPane.saved.gallery.map(p => p.id);
  if (order.join() === now.join()) return;
  if (await runMgPhotoChange("photoReorder", { ids: order }, "Saving the order...")) showIndicator("Photo order saved", "success");
}

// ── Wiring ───────────────────────────────────────────────────────────────────

async function onMgPhotoAction(action, tile) {
  const id = tile?.dataset.id;
  if (action === "add") return document.getElementById("mgPhotoFile")?.click();
  if (!id) return;
  if (action === "main") {
    if (await runMgPhotoChange("photoUpdate", { id, main: true }, "Saving...")) showIndicator("Main photo set", "success");
  } else if (action === "hide" || action === "show") {
    if (await runMgPhotoChange("photoUpdate", { id, disabled: action === "hide" }, "Saving...")) {
      showIndicator(action === "hide" ? "Photo hidden from the product page" : "Photo showing on the product page", "success");
    }
  } else if (action === "delete") {
    if (!confirm("Delete this photo from Magento? It can't be undone.")) return;
    if (await runMgPhotoChange("photoDelete", { id }, "Deleting...")) showIndicator("Photo deleted from Magento", "success");
  }
}

function initMgPhotos() {
  const preview = document.getElementById("mgPanePreview");
  if (!preview) return;

  const input = document.createElement("input");
  input.type = "file";
  input.id = "mgPhotoFile";
  input.accept = MG_PHOTO_TYPES.join(",");
  input.multiple = true;
  input.hidden = true;
  preview.after(input);
  input.addEventListener("change", () => {
    const files = [...input.files];
    input.value = "";
    if (files.length) addMgPhotos(files);
  });

  preview.addEventListener("click", e => {
    const btn = e.target.closest("[data-photo-action]");
    if (!btn || mgPhotoBusy) return;
    e.preventDefault();
    onMgPhotoAction(btn.dataset.photoAction, btn.closest(".mg-pane-image"));
  });

  // Dragging a photo to reorder, or files in from the desktop.
  preview.addEventListener("dragstart", e => {
    const tile = e.target.closest?.(".mg-pane-image");
    if (!tile?.draggable || mgPhotoBusy) return;
    mgPhotoDragId = tile.dataset.id;
    tile.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", mgPhotoDragId);
  });
  preview.addEventListener("dragend", () => {
    mgPhotoDragId = null;
    preview.querySelector(".is-dragging")?.classList.remove("is-dragging");
    clearMgPhotoDropMarks();
  });
  preview.addEventListener("dragover", e => {
    if (!preview.classList.contains("is-editable") || mgPhotoBusy) return;
    const hasFiles = [...(e.dataTransfer?.types ?? [])].includes("Files");
    if (!hasFiles && !mgPhotoDragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
    preview.classList.toggle("is-file-over", hasFiles);
    clearMgPhotoDropMarks();
    const tile = e.target.closest?.(".mg-pane-image");
    if (mgPhotoDragId && tile && tile.dataset.id !== mgPhotoDragId) tile.classList.add(`is-drop-${mgPhotoDropSide(tile, e)}`);
  });
  preview.addEventListener("dragleave", e => {
    if (preview.contains(e.relatedTarget)) return;
    preview.classList.remove("is-file-over");
    clearMgPhotoDropMarks();
  });
  preview.addEventListener("drop", e => {
    if (!preview.classList.contains("is-editable") || mgPhotoBusy) return;
    e.preventDefault();
    preview.classList.remove("is-file-over");
    clearMgPhotoDropMarks();
    if (e.dataTransfer.files?.length) {
      addMgPhotos(e.dataTransfer.files);
      return;
    }
    const tile = e.target.closest?.(".mg-pane-image");
    if (mgPhotoDragId && tile && tile.dataset.id !== mgPhotoDragId) dropMgPhoto(tile.dataset.id, mgPhotoDropSide(tile, e));
  });
}
