/**
 * Style photos, read straight from a folder on the network.
 *
 * The app is a website, so it can't open \\server\folder by path. Instead,
 * Chrome and Edge let a page read a folder the user picks (the File System
 * Access API): pick it once and the app keeps a handle to it in this
 * browser. Nothing is uploaded — images are read from the folder on this
 * computer when they're shown, the same as opening the files.
 *
 * File names say what each photo is:
 *
 *   STYLE COLOR NUMBER.ext       D1898 WHITE.BROWN 4.jpg
 *
 * separated by spaces; a "/" in the colour is written "." (file names can't
 * hold "/"), so WHITE.BROWN is WHITE/BROWN. Colours can have spaces
 * ("2 TONE GREY"); the number is optional. Subfolders are searched too.
 *
 * The list of file names is cached in the browser, so a later visit shows
 * photos straight away and re-checks the folder in the background.
 */

const STYLE_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
const STYLE_IMAGE_DB = "mioumuse-style-images";
const STYLE_THUMB_PX = 96;

/** Folder state: "unsupported" | "none" | "needs-permission" | "scanning" | "ready". */
let styleImageState = typeof window.showDirectoryPicker === "function" ? "none" : "unsupported";
let styleImageRoot = null;
/** "STYLE|COLOR" (normalised) → [{ num, path: [..dirs, file] }], sorted by num. */
let styleImageIndex = new Map();
let styleImageMeta = { folderName: "", fileCount: 0, scannedAt: "" };
let styleImageScanProgress = 0;

// ── Name matching ────────────────────────────────────────────────────────────

/** Colours compare with "/" and "." as the same thing, case-insensitive. */
function normalizeImageColor(color) {
  return String(color ?? "").toUpperCase().replace(/\./g, "/").replace(/\s+/g, " ").trim();
}

function styleImageKey(styleNo, color) {
  return `${String(styleNo ?? "").trim().toUpperCase()}|${normalizeImageColor(color)}`;
}

/**
 * "D1898 WHITE.BROWN 4.jpg" → { style: "D1898", color: "WHITE/BROWN", num: 4 }.
 * The style is normally the first word; when the Styles database knows a
 * style with spaces in it, the longer match wins.
 */
function parseStyleImageName(fileName) {
  const m = /^(.*)\.([a-z0-9]+)$/i.exec(fileName);
  if (!m || !STYLE_IMAGE_EXTENSIONS.includes(m[2].toLowerCase())) return null;
  const tokens = m[1].trim().split(/\s+/);
  let num = 0;
  if (tokens.length >= 3 && /^\d+$/.test(tokens[tokens.length - 1])) num = Number(tokens.pop());
  if (tokens.length < 2) return null;

  let styleWords = 1;
  for (let k = Math.min(3, tokens.length - 1); k > 1; k--) {
    if (getStyleColors(tokens.slice(0, k).join(" ")).length) { styleWords = k; break; }
  }
  return {
    style: tokens.slice(0, styleWords).join(" "),
    color: tokens.slice(styleWords).join(" "),
    num,
  };
}

function hasStyleImages(styleNo, color) {
  return styleImageState === "ready" || styleImageState === "scanning"
    ? (styleImageIndex.get(styleImageKey(styleNo, color))?.length ?? 0) > 0
    : false;
}

function getStyleImageEntries(styleNo, color) {
  return styleImageIndex.get(styleImageKey(styleNo, color)) ?? [];
}

// ── Remembering the folder (IndexedDB) ───────────────────────────────────────
//
// Folder handles can only be kept in IndexedDB; localStorage can't hold them.

function openStyleImageDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STYLE_IMAGE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await openStyleImageDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("kv").objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openStyleImageDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      if (value === undefined) tx.objectStore("kv").delete(key);
      else tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* best effort — the folder just has to be picked again */
  }
}

// ── Scanning ─────────────────────────────────────────────────────────────────

/** Walk the folder and its subfolders, listing image names only. */
async function scanStyleImageFolder(root) {
  const entries = [];
  let seen = 0;
  async function walk(dir, path) {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "directory") {
        await walk(handle, [...path, name]);
      } else {
        seen += 1;
        if (seen % 250 === 0) {
          styleImageScanProgress = seen;
          renderStyleImageStatus();
        }
        const parsed = parseStyleImageName(name);
        if (parsed) entries.push({ ...parsed, path: [...path, name] });
      }
    }
  }
  await walk(root, []);
  return entries;
}

function buildStyleImageIndex(entries) {
  const index = new Map();
  entries.forEach(e => {
    const key = styleImageKey(e.style, e.color);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ num: e.num, path: e.path });
  });
  index.forEach(list => list.sort((a, b) => a.num - b.num || a.path.join("/").localeCompare(b.path.join("/"))));
  return index;
}

/** Re-read the folder's file names, then refresh whatever shows photos. */
async function rescanStyleImages() {
  if (!styleImageRoot) return;
  styleImageState = "scanning";
  styleImageScanProgress = 0;
  renderStyleImageStatus();
  try {
    const entries = await scanStyleImageFolder(styleImageRoot);
    styleImageIndex = buildStyleImageIndex(entries);
    styleImageMeta = { folderName: styleImageRoot.name, fileCount: entries.length, scannedAt: new Date().toISOString() };
    await idbSet("index", { meta: styleImageMeta, entries });
    styleImageState = "ready";
  } catch (err) {
    // Usually the server went away or permission was withdrawn.
    styleImageState = (await styleImageRoot.queryPermission?.({ mode: "read" })) === "granted" ? "ready" : "needs-permission";
    showIndicator(`Couldn't read the image folder: ${err.message}`, "error");
  }
  clearStyleThumbCache();
  renderStyleImageStatus();
  refreshStyleImageViews();
}

// ── Linking ──────────────────────────────────────────────────────────────────

async function linkStyleImageFolder() {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "style-images", mode: "read" });
  } catch {
    return; // picker closed
  }
  styleImageRoot = handle;
  await idbSet("root", handle);
  await idbSet("index", undefined);
  await rescanStyleImages();
}

/** After a browser restart: ask for read access again (needs a click). */
async function reconnectStyleImageFolder() {
  if (!styleImageRoot) return;
  const result = await styleImageRoot.requestPermission({ mode: "read" });
  if (result !== "granted") return;
  styleImageState = "ready";
  renderStyleImageStatus();
  refreshStyleImageViews();
  rescanStyleImages();
}

async function unlinkStyleImageFolder() {
  if (!confirm("Stop showing photos from this folder? The folder itself isn't touched.")) return;
  styleImageRoot = null;
  styleImageIndex = new Map();
  styleImageState = "none";
  await idbSet("root", undefined);
  await idbSet("index", undefined);
  clearStyleThumbCache();
  renderStyleImageStatus();
  refreshStyleImageViews();
}

/** On load: reuse the remembered folder and its cached file list. */
async function restoreStyleImageFolder() {
  if (styleImageState === "unsupported") {
    renderStyleImageStatus();
    return;
  }
  const root = await idbGet("root");
  if (!root) {
    renderStyleImageStatus();
    return;
  }
  styleImageRoot = root;
  const cached = await idbGet("index");
  if (cached?.entries) {
    styleImageIndex = buildStyleImageIndex(cached.entries);
    styleImageMeta = cached.meta ?? styleImageMeta;
  }
  const permission = await root.queryPermission({ mode: "read" });
  if (permission === "granted") {
    styleImageState = "ready";
    renderStyleImageStatus();
    refreshStyleImageViews();
    rescanStyleImages(); // pick up new or renamed files quietly
  } else {
    styleImageState = "needs-permission";
    renderStyleImageStatus();
  }
}

// ── Reading images ───────────────────────────────────────────────────────────

async function getStyleImageFile(entry) {
  let dir = styleImageRoot;
  for (const part of entry.path.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const fileHandle = await dir.getFileHandle(entry.path[entry.path.length - 1]);
  return fileHandle.getFile();
}

/** Small thumbnails, made once and kept in memory — photos can be large. */
const styleThumbCache = new Map();

function clearStyleThumbCache() {
  styleThumbCache.forEach(p => p.then(url => url && URL.revokeObjectURL(url)).catch(() => {}));
  styleThumbCache.clear();
}

function getStyleThumbUrl(styleNo, color) {
  const key = styleImageKey(styleNo, color);
  if (!styleThumbCache.has(key)) {
    styleThumbCache.set(key, (async () => {
      const [first] = getStyleImageEntries(styleNo, color);
      if (!first || styleImageState !== "ready" && styleImageState !== "scanning") return "";
      const file = await getStyleImageFile(first);
      const bitmap = await createImageBitmap(file, { resizeWidth: STYLE_THUMB_PX * 2, resizeQuality: "medium" });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.82));
      return blob ? URL.createObjectURL(blob) : "";
    })().catch(() => ""));
  }
  return styleThumbCache.get(key);
}

/**
 * A thumbnail element for a style + colour that fills itself in once it
 * scrolls into view — only what's on screen gets read from the server.
 */
const styleThumbObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        styleThumbObserver.unobserve(entry.target);
        loadStyleThumbInto(entry.target);
      });
    }, { rootMargin: "200px" })
  : null;

async function loadStyleThumbInto(el) {
  const url = await getStyleThumbUrl(el.dataset.style, el.dataset.color);
  if (!url || !el.isConnected) return;
  const img = document.createElement("img");
  img.src = url;
  img.alt = "";
  el.replaceChildren(img);
  el.classList.add("has-image");
}

function createStyleThumb(styleNo, color, extraClass = "") {
  const el = document.createElement("span");
  el.className = "style-thumb" + (extraClass ? ` ${extraClass}` : "");
  el.dataset.style = styleNo;
  el.dataset.color = color;
  const count = getStyleImageEntries(styleNo, color).length;
  if (!count || !hasStyleImages(styleNo, color)) {
    el.classList.add("is-empty");
    return el;
  }
  if (count > 1) el.dataset.count = String(count);
  if (styleThumbObserver) styleThumbObserver.observe(el);
  else loadStyleThumbInto(el);
  return el;
}

// ── Gallery ──────────────────────────────────────────────────────────────────

let galleryUrls = [];

async function openStyleGallery(styleNo, color) {
  const overlay = document.getElementById("styleGalleryOverlay");
  if (!overlay) return;
  const style = findStyle(styleNo, color);
  document.getElementById("styleGalleryTitle").textContent = `${styleNo} · ${color}`;
  document.getElementById("styleGallerySub").textContent =
    style ? [style.description, style.category, style.season, style.status].filter(Boolean).join(" · ") : "";

  const grid = document.getElementById("styleGalleryGrid");
  const entries = getStyleImageEntries(styleNo, color);
  closeStyleGalleryUrls();
  overlay.classList.add("open");

  if (styleImageState === "needs-permission") {
    grid.replaceChildren(Object.assign(document.createElement("div"), { className: "style-gallery-empty", textContent: "Reconnect the image folder to see photos." }));
    return;
  }
  if (!entries.length) {
    grid.replaceChildren(Object.assign(document.createElement("div"), {
      className: "style-gallery-empty",
      textContent: styleImageRoot ? `No photos named "${styleNo} ${color.replace(/\//g, ".")} …" in the folder.` : "Link the image folder to see photos.",
    }));
    return;
  }

  grid.replaceChildren(...entries.map(entry => {
    const fig = document.createElement("figure");
    fig.className = "style-gallery-item";
    const cap = document.createElement("figcaption");
    cap.textContent = entry.path[entry.path.length - 1];
    cap.title = entry.path.join(" / ");
    fig.appendChild(cap);
    getStyleImageFile(entry).then(file => {
      const url = URL.createObjectURL(file);
      galleryUrls.push(url);
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
    return fig;
  }));
}

function closeStyleGalleryUrls() {
  galleryUrls.forEach(url => URL.revokeObjectURL(url));
  galleryUrls = [];
}

function closeStyleGallery() {
  document.getElementById("styleGalleryOverlay")?.classList.remove("open");
  closeStyleGalleryUrls();
}

// ── Status in the Styles toolbar ─────────────────────────────────────────────

function renderStyleImageStatus() {
  const wrap = document.getElementById("styleImageStatus");
  if (!wrap) return;

  const btn = (label, onClick, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn" + (primary ? " btn-primary" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };
  const text = (t, title = "") => {
    const s = document.createElement("span");
    s.className = "style-image-text";
    s.textContent = t;
    if (title) s.title = title;
    return s;
  };

  switch (styleImageState) {
    case "unsupported":
      wrap.replaceChildren(text("Photos need Chrome or Edge", "This browser can't read folders."));
      break;
    case "none":
      wrap.replaceChildren(btn("Link image folder", linkStyleImageFolder));
      break;
    case "needs-permission":
      wrap.replaceChildren(btn("Reconnect image folder", reconnectStyleImageFolder, true));
      break;
    case "scanning":
      wrap.replaceChildren(text(styleImageScanProgress
        ? `Reading folder… ${styleImageScanProgress.toLocaleString()} files`
        : "Reading folder…"));
      break;
    default: {
      const when = styleImageMeta.scannedAt ? new Date(styleImageMeta.scannedAt).toLocaleString() : "";
      wrap.replaceChildren(
        text(`📁 ${styleImageMeta.folderName} · ${styleImageMeta.fileCount.toLocaleString()} photos`, when ? `Checked ${when}` : ""),
        btn("Rescan", rescanStyleImages),
        btn("Unlink", unlinkStyleImageFolder),
      );
    }
  }
}

/** Redraw what shows photos — the Styles table, and banner style rows. */
function refreshStyleImageViews() {
  if (getCurrentAppView() === "styles" && typeof applyStyleFilters === "function") applyStyleFilters({ keepShown: true });
  if (typeof refreshBannerViews === "function") refreshBannerViews();
  document.querySelectorAll("#bannerFormStyles .banner-style-row").forEach(row => {
    if (typeof updateBannerStyleMatch === "function") updateBannerStyleMatch(row);
  });
}

function initStyleImages() {
  document.getElementById("styleGalleryCloseBtn")?.addEventListener("click", closeStyleGallery);
  const overlay = document.getElementById("styleGalleryOverlay");
  overlay?.addEventListener("click", e => {
    if (e.target === overlay) closeStyleGallery();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay?.classList.contains("open")) closeStyleGallery();
  });
  renderStyleImageStatus();
  // The folder itself is restored after sign-in (main.js) — matching names
  // uses the Styles database, which has to be loaded first.
}
