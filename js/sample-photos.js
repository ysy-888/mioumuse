/**
 * Sample photos — a stand-in picture for styles whose studio / CG photos
 * aren't in the model photo folder yet.
 *
 * They live in their own folder on the network (e.g. SAMPLE PHOTOS), linked
 * like the model photo folder (js/style-images.js) but with permission to
 * write. Keep it outside the model photo folder, or its photos would be
 * read as model photos.
 *
 * A style's sample is, in order:
 *   1. the photo linked to it by hand — Browse in the style pane opens the
 *      folder, pick any photo whatever it's called (sample_photo_links in
 *      Supabase, js/store.js);
 *   2. otherwise a file named like the model photos, STYLE COLOR.ext.
 *
 * Dragging an image file onto a style's empty photo box (a table, a
 * shoot, the style pane) saves it into the folder as STYLE COLOR.ext and
 * links it.
 *
 * Once the style has model photos those show instead; the sample is left
 * alone.
 */

/** Folder state: "unsupported" | "none" | "needs-permission" | "scanning" | "ready". */
let samplePhotoState = typeof window.showDirectoryPicker === "function" ? "none" : "unsupported";
let samplePhotoRoot = null;
/** Every image in the folder, as paths: [..folders, file name]. */
let samplePhotoFiles = [];
/** Files named STYLE COLOR.ext: "STYLE|COLOR" → [{ num, path }] */
let samplePhotoIndex = new Map();
/** styleImageKey → thumbnail URL promise, per style. */
const sampleThumbCache = new Map();

function isSamplePhotoReadable() {
  return samplePhotoState === "ready" || samplePhotoState === "scanning";
}

/** The style's sample: its linked photo, else one named after it. [] if none. */
function getSamplePhotoEntries(styleNo, color) {
  if (!isSamplePhotoReadable()) return [];
  const link = getSamplePhotoLink(styleNo, color);
  if (link) return [{ num: 0, path: link.split("/"), linked: true }];
  return samplePhotoIndex.get(styleImageKey(styleNo, color)) ?? [];
}

function hasSamplePhoto(styleNo, color) {
  return getSamplePhotoEntries(styleNo, color).length > 0;
}

// ── Folder ───────────────────────────────────────────────────────────────────

/** The image files directly in the folder — subfolders are skipped. */
async function scanSamplePhotoFolder(root) {
  const files = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "file" && STYLE_IMAGE_EXTENSIONS.includes(/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase())) files.push([name]);
  }
  return files;
}

function setSamplePhotoFiles(files) {
  // Top level only — also drops subfolder paths from a list cached by an older scan.
  samplePhotoFiles = files.filter(p => p.length === 1);
  samplePhotoIndex = buildStyleImageIndex(files.flatMap(path => {
    const parsed = parseStyleImageName(path[path.length - 1]);
    return parsed ? [{ ...parsed, path }] : [];
  }));
}

async function rescanSamplePhotos() {
  if (!samplePhotoRoot) return;
  samplePhotoState = "scanning";
  try {
    setSamplePhotoFiles(await scanSamplePhotoFolder(samplePhotoRoot));
    await idbSet("sampleFiles", samplePhotoFiles);
    samplePhotoState = "ready";
  } catch (err) {
    samplePhotoState = (await samplePhotoRoot.queryPermission?.({ mode: "readwrite" })) === "granted" ? "ready" : "needs-permission";
    showIndicator(`Couldn't read the sample photo folder: ${err.message}`, "error");
  }
  clearSampleThumbCache();
  refreshSamplePhotoViews();
  if (sampleBrowser) renderSampleBrowser();
}

async function linkSamplePhotoFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "sample-photos", mode: "readwrite" });
  } catch {
    return; // picker closed
  }
  if (styleImageRoot && await handle.isSameEntry(styleImageRoot)) {
    showIndicator("That's the model photo folder — pick a separate folder for sample photos", "error");
    return;
  }
  samplePhotoRoot = handle;
  await idbSet("sampleRoot", handle);
  await idbSet("sampleFiles", undefined);
  await rescanSamplePhotos();
  showIndicator(`Sample photos: ${handle.name} linked`, "success");
}

/** After a browser restart: ask for access again (needs a click). */
async function reconnectSamplePhotoFolder() {
  if (!samplePhotoRoot) return false;
  const result = await samplePhotoRoot.requestPermission({ mode: "readwrite" }).catch(() => "denied");
  if (result !== "granted") return false;
  samplePhotoState = "ready";
  refreshSamplePhotoViews();
  rescanSamplePhotos();
  return true;
}

async function unlinkSamplePhotoFolder() {
  if (!confirm("Stop using this sample photo folder? The folder and its photos aren't touched, and the styles keep their links.")) return;
  samplePhotoRoot = null;
  setSamplePhotoFiles([]);
  samplePhotoState = "none";
  await idbSet("sampleRoot", undefined);
  await idbSet("sampleFiles", undefined);
  clearSampleThumbCache();
  refreshSamplePhotoViews();
}

/** On sign-in: reuse the remembered folder and its cached file list. */
async function restoreSamplePhotoFolder() {
  if (samplePhotoState === "unsupported") return;
  const root = await idbGet("sampleRoot");
  if (!root) return;
  samplePhotoRoot = root;
  const cached = await idbGet("sampleFiles");
  if (Array.isArray(cached)) setSamplePhotoFiles(cached);
  if ((await root.queryPermission({ mode: "readwrite" })) === "granted") {
    samplePhotoState = "ready";
    refreshSamplePhotoViews();
    rescanSamplePhotos();
  } else {
    samplePhotoState = "needs-permission";
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

async function getSamplePhotoFile(entry) {
  const path = Array.isArray(entry) ? entry : entry.path;
  let dir = samplePhotoRoot;
  for (const part of path.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return (await dir.getFileHandle(path[path.length - 1])).getFile();
}

/** A small JPEG of an image file, as an object URL. */
async function makeSampleThumb(file, width) {
  const bitmap = await createImageBitmap(file, { resizeWidth: width, resizeQuality: "medium" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.82));
  return blob ? URL.createObjectURL(blob) : "";
}

function clearSampleThumbCache(key) {
  const drop = k => {
    sampleThumbCache.get(k)?.then(url => url && URL.revokeObjectURL(url)).catch(() => {});
    sampleThumbCache.delete(k);
  };
  if (key) drop(key);
  else [...sampleThumbCache.keys()].forEach(drop);
}

function getSampleThumbUrl(styleNo, color) {
  const key = styleImageKey(styleNo, color);
  if (!sampleThumbCache.has(key)) {
    sampleThumbCache.set(key, (async () => {
      const [first] = getSamplePhotoEntries(styleNo, color);
      return first ? makeSampleThumb(await getSamplePhotoFile(first), STYLE_THUMB_PX * 2) : "";
    })().catch(() => ""));
  }
  return sampleThumbCache.get(key);
}

// ── Linking a photo ──────────────────────────────────────────────────────────

/** Link (or with "" unlink) a photo, then redraw that style's photo boxes. */
async function linkSamplePhoto(styleNo, color, path) {
  try {
    await setSamplePhotoLink(styleNo, color, path);
  } catch (err) {
    showIndicator(err.message, "error");
    return false;
  }
  clearSampleThumbCache(styleImageKey(styleNo, color));
  refreshSamplePhotoViews(styleNo, color);
  return true;
}

// ── Saving a dropped image ───────────────────────────────────────────────────

/** Characters Windows won't take in a file name ("/" is already "."). */
function sampleFileBase(styleNo, color) {
  return `${styleNo} ${String(color).replace(/\//g, ".")}`.replace(/[\\:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

function sampleFileExtension(file) {
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (fromName && STYLE_IMAGE_EXTENSIONS.includes(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[file.type] ?? "";
}

/** Folder access for writing, asking again if it's lapsed. */
async function ensureSampleFolderWritable() {
  if (samplePhotoState === "unsupported") {
    showIndicator("Sample photos need Chrome or Edge", "error");
    return false;
  }
  if (!samplePhotoRoot) {
    showIndicator("Link a sample photo folder first: Styles → menu ⋮ → Link Sample Photo Folder", "error");
    return false;
  }
  if ((await samplePhotoRoot.queryPermission({ mode: "readwrite" })) !== "granted" && !(await reconnectSamplePhotoFolder())) {
    showIndicator("Reconnect the sample photo folder first: Styles → menu ⋮ → Reconnect Sample Photo Folder", "error");
    return false;
  }
  return true;
}

/** Save a dropped image as STYLE COLOR.ext in the folder, and link it. */
async function saveSamplePhoto(styleNo, color, file) {
  const ext = file ? sampleFileExtension(file) : "";
  if (!ext) {
    showIndicator("Drop an image file (JPG, PNG, WEBP or GIF)", "error");
    return;
  }
  if (!(await ensureSampleFolderWritable())) return;
  const name = `${sampleFileBase(styleNo, color)}.${ext}`;
  const exists = samplePhotoFiles.some(p => p.length === 1 && p[0].toLowerCase() === name.toLowerCase());
  if (hasSamplePhoto(styleNo, color) && !confirm(`Replace the sample photo for ${styleNo} ${color}?`)) return;
  if (exists && !hasSamplePhoto(styleNo, color) && !confirm(`${name} is already in the folder. Replace it?`)) return;

  showIndicator(`Saving the sample photo for ${styleNo} ${color}…`);
  try {
    const handle = await samplePhotoRoot.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(file);
    await writable.close();
  } catch (err) {
    showIndicator(`Couldn't save the sample photo: ${err.message}`, "error");
    return;
  }
  if (!exists) setSamplePhotoFiles([...samplePhotoFiles, [name]]);
  idbSet("sampleFiles", samplePhotoFiles);
  sampleBrowserThumbs.get(name)?.then(url => url && URL.revokeObjectURL(url)).catch(() => {});
  sampleBrowserThumbs.delete(name);
  if (await linkSamplePhoto(styleNo, color, name)) showIndicator(`Sample photo saved: ${name}`, "success");
}

// ── Browsing the folder ──────────────────────────────────────────────────────
//
// Style pane → Browse: the folder's photos, folder by folder, or searched
// by name. Click one to see it larger, then "Use for …" links it.

/** While open: { styleNo, color, dir: [..folders], query, selected: "a/b.jpg", hideLinked } */
let sampleBrowser = null;
/** Remembered between opens: you usually link several from one folder. */
let sampleBrowserLastDir = [];
const sampleBrowserThumbs = new Map(); // "a/b.jpg" → URL promise
let sampleBrowserPreviewUrl = "";
let sampleBrowserQueue = [];
let sampleBrowserActive = 0;

const SAMPLE_BROWSER_THUMB_PX = 240;
const SAMPLE_BROWSER_MAX = 400; // search results shown at once

function openSampleBrowser(styleNo, color) {
  if (!isSamplePhotoReadable()) {
    showIndicator(samplePhotoRoot ? "Reconnect the sample photo folder first (Styles → menu ⋮)" : "Link a sample photo folder first (Styles → menu ⋮)", "error");
    return;
  }
  const link = getSamplePhotoLink(styleNo, color);
  const dir = link ? link.split("/").slice(0, -1) : sampleBrowserLastDir;
  // Opens already searching for the style number (not the colour); clear the box to see everything.
  sampleBrowser = { styleNo, color, dir: sampleFolderExists(dir) ? dir : [], query: styleNo, selected: link, hideLinked: false };
  document.getElementById("sampleBrowserTitle").textContent = `Sample photo for ${styleNo} · ${color}`;
  document.getElementById("sampleBrowserSearch").value = styleNo;
  document.getElementById("sampleBrowserHideLinked").checked = false;
  document.getElementById("sampleBrowserOverlay").classList.add("open");
  renderSampleBrowser();
  document.getElementById("sampleBrowserSearch").focus();
}

function closeSampleBrowser() {
  if (!sampleBrowser) return;
  sampleBrowserLastDir = sampleBrowser.dir;
  sampleBrowser = null;
  sampleBrowserQueue = [];
  setSampleBrowserPreview("");
  document.getElementById("sampleBrowserOverlay").classList.remove("open");
}

function sampleFolderExists(dir) {
  return !dir.length || samplePhotoFiles.some(p => p.length > dir.length && dir.every((d, i) => p[i] === d));
}

/** What the grid shows: subfolders (with photo counts) and photos. */
function getSampleBrowserItems() {
  const { dir, query, hideLinked } = sampleBrowser;
  const linked = getSamplePhotoLinksByPath();
  const keep = p => !hideLinked || !linked.has(p.join("/"));
  if (query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const photos = samplePhotoFiles.filter(p => keep(p) && words.every(w => p.join("/").toLowerCase().includes(w)));
    return { folders: [], photos, linked };
  }
  const folders = new Map();
  const photos = [];
  samplePhotoFiles.forEach(p => {
    if (p.length <= dir.length || !dir.every((d, i) => p[i] === d)) return;
    if (p.length === dir.length + 1) {
      if (keep(p)) photos.push(p);
    } else {
      const name = p[dir.length];
      folders.set(name, (folders.get(name) ?? 0) + (keep(p) ? 1 : 0));
    }
  });
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return {
    folders: [...folders].sort((a, b) => byName(a[0], b[0])),
    photos: photos.sort((a, b) => byName(a[a.length - 1], b[b.length - 1])),
    linked,
  };
}

function renderSampleBrowser() {
  if (!sampleBrowser) return;
  const { dir, query } = sampleBrowser;

  // Where you are: the folder's name, then each subfolder — click to go back up.
  const crumbs = document.getElementById("sampleBrowserCrumbs");
  const crumb = (label, to) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sample-browser-crumb";
    b.textContent = label;
    b.addEventListener("click", () => {
      sampleBrowser.dir = to;
      sampleBrowser.query = "";
      document.getElementById("sampleBrowserSearch").value = "";
      renderSampleBrowser();
    });
    return b;
  };
  crumbs.replaceChildren(
    crumb(`📁 ${samplePhotoRoot?.name ?? "Sample photos"}`, []),
    ...dir.flatMap((name, i) => [Object.assign(document.createElement("span"), { className: "sample-browser-sep", textContent: "›" }), crumb(name, dir.slice(0, i + 1))]),
  );
  crumbs.classList.toggle("is-searching", Boolean(query));

  const { folders, photos, linked } = getSampleBrowserItems();
  const grid = document.getElementById("sampleBrowserGrid");
  sampleBrowserQueue = [];
  const tiles = [];
  folders.forEach(([name, count]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sample-browser-folder";
    b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
    const label = document.createElement("span");
    label.className = "sample-browser-name";
    label.textContent = name;
    const n = document.createElement("span");
    n.className = "sample-browser-count";
    n.textContent = `${count} photo${count === 1 ? "" : "s"}`;
    b.append(label, n);
    b.addEventListener("click", () => {
      sampleBrowser.dir = [...dir, name];
      renderSampleBrowser();
      grid.scrollTop = 0;
    });
    tiles.push(b);
  });
  photos.slice(0, SAMPLE_BROWSER_MAX).forEach(p => tiles.push(createSampleBrowserTile(p, linked.get(p.join("/")) ?? [])));
  if (!tiles.length) {
    tiles.push(Object.assign(document.createElement("div"), {
      className: "sample-browser-empty",
      textContent: query ? `No photos match "${query}".` : sampleBrowser.hideLinked ? "Every photo here is linked." : "No photos in this folder.",
    }));
  }
  grid.replaceChildren(...tiles);

  const shown = Math.min(photos.length, SAMPLE_BROWSER_MAX);
  document.getElementById("sampleBrowserSummary").textContent = query
    ? `${photos.length.toLocaleString()} match${photos.length === 1 ? "" : "es"}${photos.length > shown ? ` · first ${shown} shown` : ""}`
    : `${folders.length ? `${folders.length} folder${folders.length === 1 ? "" : "s"} · ` : ""}${photos.length.toLocaleString()} photo${photos.length === 1 ? "" : "s"}`;
  renderSampleBrowserPreview();
}

function createSampleBrowserTile(path, linkedTo) {
  const key = path.join("/");
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "sample-browser-photo";
  tile.dataset.path = key;
  tile.title = key;
  if (key === sampleBrowser.selected) tile.classList.add("is-selected");
  const isThis = linkedTo.some(([s, c]) => s === sampleBrowser.styleNo && c === sampleBrowser.color);
  if (isThis) tile.classList.add("is-current");
  const img = document.createElement("span");
  img.className = "sample-browser-img";
  const name = document.createElement("span");
  name.className = "sample-browser-name";
  name.textContent = sampleBrowser.query ? key : path[path.length - 1];
  tile.append(img, name);
  if (linkedTo.length) {
    const tag = document.createElement("span");
    tag.className = "sample-browser-linked";
    tag.textContent = isThis ? "This style" : linkedTo.map(([s, c]) => `${s} ${c}`).join(", ");
    tile.appendChild(tag);
  }
  tile.addEventListener("click", () => {
    sampleBrowser.selected = key;
    document.querySelectorAll("#sampleBrowserGrid .sample-browser-photo.is-selected").forEach(t => t.classList.remove("is-selected"));
    tile.classList.add("is-selected");
    renderSampleBrowserPreview();
  });
  tile.addEventListener("dblclick", useSelectedSamplePhoto);
  sampleBrowserObserver?.observe(img);
  return tile;
}

/** Thumbnails load as they scroll into view, a few at a time (the folder is on the network). */
const sampleBrowserObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        sampleBrowserObserver.unobserve(entry.target);
        sampleBrowserQueue.push(entry.target);
      });
      pumpSampleBrowserThumbs();
    }, { rootMargin: "300px" })
  : null;

function pumpSampleBrowserThumbs() {
  while (sampleBrowserActive < 4 && sampleBrowserQueue.length) {
    const el = sampleBrowserQueue.shift();
    if (!el.isConnected) continue;
    const key = el.parentElement.dataset.path;
    if (!sampleBrowserThumbs.has(key)) {
      sampleBrowserThumbs.set(key, getSamplePhotoFile(key.split("/"))
        .then(file => makeSampleThumb(file, SAMPLE_BROWSER_THUMB_PX))
        .catch(() => ""));
    }
    sampleBrowserActive++;
    sampleBrowserThumbs.get(key).then(url => {
      if (url && el.isConnected) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        el.replaceChildren(img);
      } else if (!url) el.classList.add("is-error");
    }).finally(() => {
      sampleBrowserActive--;
      pumpSampleBrowserThumbs();
    });
  }
}

function setSampleBrowserPreview(url) {
  if (sampleBrowserPreviewUrl) URL.revokeObjectURL(sampleBrowserPreviewUrl);
  sampleBrowserPreviewUrl = url;
}

/** The picked photo, larger, with the button that links it. */
function renderSampleBrowserPreview() {
  const pane = document.getElementById("sampleBrowserPreview");
  const useBtn = document.getElementById("sampleBrowserUse");
  const { styleNo, color, selected } = sampleBrowser;
  const current = getSamplePhotoLink(styleNo, color);
  useBtn.textContent = `Use for ${styleNo} · ${color}`;
  useBtn.disabled = !selected || selected === current;
  if (selected && selected === current) useBtn.textContent = "Linked to this style";
  document.getElementById("sampleBrowserUnlink").hidden = !current;

  if (!selected) {
    setSampleBrowserPreview("");
    pane.replaceChildren(Object.assign(document.createElement("div"), { className: "sample-browser-empty", textContent: "Click a photo to see it larger." }));
    return;
  }
  if (pane.dataset.path === selected && pane.querySelector("img")) return;
  pane.dataset.path = selected;
  const cap = document.createElement("div");
  cap.className = "sample-browser-preview-cap";
  cap.textContent = selected;
  const others = (getSamplePhotoLinksByPath().get(selected) ?? []).filter(([s, c]) => !(s === styleNo && c === color));
  const note = others.length
    ? Object.assign(document.createElement("div"), { className: "sample-browser-preview-note", textContent: `Also the sample for ${others.map(([s, c]) => `${s} ${c}`).join(", ")}` })
    : null;
  const frame = document.createElement("div");
  frame.className = "sample-browser-preview-img";
  pane.replaceChildren(frame, cap, ...(note ? [note] : []));
  getSamplePhotoFile(selected.split("/")).then(file => {
    if (sampleBrowser?.selected !== selected) return;
    setSampleBrowserPreview(URL.createObjectURL(file));
    const img = document.createElement("img");
    img.src = sampleBrowserPreviewUrl;
    img.alt = selected;
    frame.replaceChildren(img);
  }).catch(() => frame.classList.add("is-error"));
}

async function useSelectedSamplePhoto() {
  if (!sampleBrowser?.selected) return;
  const { styleNo, color, selected } = sampleBrowser;
  if (selected === getSamplePhotoLink(styleNo, color)) return closeSampleBrowser();
  const btn = document.getElementById("sampleBrowserUse");
  btn.disabled = true;
  if (await linkSamplePhoto(styleNo, color, selected)) {
    closeSampleBrowser();
    showIndicator(`Sample photo linked: ${styleNo} ${color}`, "success");
  } else {
    btn.disabled = false;
  }
}

async function unlinkSamplePhotoFromBrowser() {
  if (!sampleBrowser) return;
  const { styleNo, color } = sampleBrowser;
  if (await linkSamplePhoto(styleNo, color, "")) {
    closeSampleBrowser();
    showIndicator(`Sample photo unlinked: ${styleNo} ${color} (the file stays in the folder)`, "success");
  }
}

// ── Showing ──────────────────────────────────────────────────────────────────

/** Redraw the photo boxes — every one on screen, or one style's — and the style pane. */
function refreshSamplePhotoViews(styleNo, color) {
  const key = styleNo ? styleImageKey(styleNo, color) : "";
  document.querySelectorAll(".style-thumb[data-style]").forEach(el => {
    if (key && styleImageKey(el.dataset.style, el.dataset.color) !== key) return;
    fillStyleThumb(el);
  });
  if (typeof refreshStylePane === "function") refreshStylePane();
}

/** Header menu (Styles): Link / Reconnect / Rescan, and Unlink. */
function getSamplePhotoMenuState() {
  switch (samplePhotoState) {
    case "none": return { label: "Link Sample Photo Folder", canUnlink: false };
    case "needs-permission": return { label: "Reconnect Sample Photo Folder", canUnlink: true };
    case "ready": return { label: "Rescan Sample Photo Folder", canUnlink: true };
    default: return { label: "", canUnlink: false };
  }
}

function runSamplePhotoMenuAction() {
  if (samplePhotoState === "none") linkSamplePhotoFolder();
  else if (samplePhotoState === "needs-permission") reconnectSamplePhotoFolder();
  else if (samplePhotoState === "ready") rescanSamplePhotos();
}

// ── Drag and drop ────────────────────────────────────────────────────────────

/** The photo box (or style pane box) a file is being dragged over, if it takes samples. */
function sampleDropTarget(e) {
  if (!e.dataTransfer?.types?.includes("Files")) return null;
  return e.target instanceof Element ? e.target.closest("[data-sample-drop]") : null;
}

let sampleDragTimer = 0;

function initSamplePhotos() {
  // Clicking an empty photo box (a style with no model or sample photo) opens
  // Browse sample photos for that style — linking or reconnecting the folder
  // first if needed. Capture phase, so the row's own click (style pane) doesn't fire.
  document.addEventListener("click", async e => {
    const box = e.target.closest?.(".style-thumb.is-sample-slot[data-style]");
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const { style: styleNo, color } = box.dataset;
    if (samplePhotoState === "none") {
      await linkSamplePhotoFolder();
    } else if (samplePhotoState === "needs-permission") {
      await reconnectSamplePhotoFolder();
    }
    if (isSamplePhotoReadable() && !hasStyleImages(styleNo, color)) openSampleBrowser(styleNo, color);
  }, true);

  document.getElementById("headerMenuSampleFolder")?.addEventListener("click", () => {
    closeHeaderMenu();
    runSamplePhotoMenuAction();
  });
  document.getElementById("headerMenuSampleFolderUnlink")?.addEventListener("click", () => {
    closeHeaderMenu();
    unlinkSamplePhotoFolder();
  });

  // The browser window.
  const overlay = document.getElementById("sampleBrowserOverlay");
  document.getElementById("sampleBrowserCloseBtn")?.addEventListener("click", closeSampleBrowser);
  overlay?.addEventListener("click", e => { if (e.target === overlay) closeSampleBrowser(); });
  document.addEventListener("keydown", e => {
    if (!sampleBrowser) return;
    if (e.key === "Escape") { e.stopPropagation(); closeSampleBrowser(); }
    else if (e.key === "Enter" && !e.target.closest?.("input")) useSelectedSamplePhoto();
  }, true);
  let searchTimer = 0;
  document.getElementById("sampleBrowserSearch")?.addEventListener("input", e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!sampleBrowser) return;
      sampleBrowser.query = e.target.value.trim();
      renderSampleBrowser();
    }, 150);
  });
  document.getElementById("sampleBrowserHideLinked")?.addEventListener("change", e => {
    if (!sampleBrowser) return;
    sampleBrowser.hideLinked = e.target.checked;
    renderSampleBrowser();
  });
  document.getElementById("sampleBrowserUse")?.addEventListener("click", useSelectedSamplePhoto);
  document.getElementById("sampleBrowserUnlink")?.addEventListener("click", unlinkSamplePhotoFromBrowser);

  // Dropping an image file on a style's photo box.
  document.addEventListener("dragover", e => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    // While a file is over the window, the boxes that take it light up.
    document.body.classList.add("is-dragging-file");
    clearTimeout(sampleDragTimer);
    sampleDragTimer = setTimeout(() => document.body.classList.remove("is-dragging-file"), 200);
    const target = sampleDropTarget(e);
    document.querySelectorAll("[data-sample-drop].is-dragover").forEach(el => el !== target && el.classList.remove("is-dragover"));
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    target.classList.add("is-dragover");
  });
  document.addEventListener("drop", e => {
    const target = sampleDropTarget(e);
    document.body.classList.remove("is-dragging-file");
    document.querySelectorAll("[data-sample-drop].is-dragover").forEach(el => el.classList.remove("is-dragover"));
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    saveSamplePhoto(target.dataset.style, target.dataset.color, e.dataTransfer.files[0]);
  }, true);
}
