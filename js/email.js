/**
 * Marketing → E-Mail: the email templates, a live preview, and an edit panel
 * for the links and products on each one.
 *
 * A template is a plain HTML file under email-templates/, designed by hand.
 * The CRM reads a few tags from it (all stripped from the exported HTML):
 *   data-mm-group="…"       a section name for the edit panel
 *   data-mm-link="key"      an editable link; data-mm-label="…" names it.
 *                           Links sharing a key are edited together. A link
 *                           with no key is still listed, by its text.
 *   data-mm-products="key"  a product grid; data-mm-columns="2" per row,
 *                           data-mm-label="…" names it
 *   data-mm-card            a product card inside it — the first one is
 *                           repeated once per style picked
 *   data-mm-field="…"       inside a card, filled from Magento:
 *                           url (href), image (src + alt), style, color,
 *                           label ("STYLE · COLOUR"), name (text). A
 *                           colour links to its style's page.
 *   data-mm-image="key"     on an <img>: a picture you can swap (upload or
 *                           URL); data-mm-label="…" names it. Its Outlook
 *                           copy in an <!--[if mso]> comment, with the same
 *                           src, is swapped along with it.
 * Mailchimp merge-tag links (*|UNSUB|* …) are left alone.
 *
 * This is the template editor: Save updates the template. What you change
 * (text/HTML, links, images, products, its name) is saved per template in
 * Supabase (email_settings, js/store.js) and from then on is the template —
 * the file in the repo is only where it started. Save copy makes a new
 * template (a row of its own, "copy-…") from what's on screen; its relative
 * images still come from the folder of the file it was copied from.
 */

/** The templates that start from a file in the repo. */
const EMAIL_TEMPLATES = [
  { id: "end-of-year-sale", name: "End of Year Sale", file: "email-templates/end-of-year-sale/template.html" },
  { id: "sample-sale-week-2", name: "Sample Sale · Week 2", file: "email-templates/sample-sale-week-2/template.html" },
];

/** A file template's folder ("email-templates/x/"), where its relative images are. */
function emailFileFolder(file) {
  return String(file ?? "").replace(/[^/]+$/, "");
}

/**
 * Every template in the list: the file ones (under the name you gave them,
 * if any), then your copies, oldest first.
 * Each: { id, name, file?, folder, isCopy }.
 */
function getEmailTemplates() {
  const files = EMAIL_TEMPLATES.map(t => ({
    ...t,
    name: emailSaved.get(t.id)?.name || t.name,
    folder: emailFileFolder(t.file),
    isCopy: false,
  }));
  const fileIds = new Set(EMAIL_TEMPLATES.map(t => t.id));
  const copies = [...emailSaved.entries()]
    .filter(([id, s]) => !fileIds.has(id) && s.html)
    .sort((a, b) => String(a[1].createdAt).localeCompare(String(b[1].createdAt)))
    .map(([id, s]) => ({ id, name: s.name || "Untitled", folder: s.folder || "", isCopy: true }));
  return [...files, ...copies];
}

/**
 * Where the template folders are online, for the exported HTML's own images
 * (a logo bar, a hero) — GitHub Pages serves this repo, so a pushed image is
 * public there.
 */
const EMAIL_PUBLIC_BASE = "https://ysy-888.github.io/mioumuse/";

let emailTemplateId = EMAIL_TEMPLATES[0]?.id ?? "";
/** Template HTML by id, fetched once. */
const emailSources = new Map();
/** What a template's file holds: its links and product grids, by id. */
const emailInfo = new Map();
/** Saved settings by template id ({ links, products }), and the edit on screen. */
let emailSaved = new Map();
let emailDraft = null;
let emailSettingsLoaded = false;
let emailRenderTimer = 0;
/** The preview's colours: "light" (the default) or "dark", as a reader on dark mode sees it. */
let emailScheme = "light";

// ── Reading a template ───────────────────────────────────────────────────────

function parseEmailDoc(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

function isEmailMergeTag(href) {
  return href.includes("*|");
}

/** The links that can be edited, in page order: [{ a, key }]. */
function emailLinkElements(doc) {
  const out = [];
  let auto = 0;
  doc.querySelectorAll("a[href]").forEach(a => {
    if (a.closest("[data-mm-products]")) return;
    const href = a.getAttribute("href") ?? "";
    if (isEmailMergeTag(href)) return;
    out.push({ a, key: a.dataset.mmLink || `auto${++auto}` });
  });
  return out;
}

function emailFields(card, field) {
  return [...card.querySelectorAll("[data-mm-field]")].filter(el => el.dataset.mmField.split(/\s+/).includes(field));
}

/** A card's product as the template has it: { style, name, url, image }. */
function readEmailCard(card) {
  const url = emailFields(card, "url")[0]?.getAttribute("href") ?? "";
  const image = emailFields(card, "image")[0]?.getAttribute("src") ?? "";
  const style = (emailFields(card, "style")[0] ?? emailFields(card, "label")[0])?.textContent.trim() ?? "";
  const name = emailFields(card, "name")[0]?.textContent.trim() ?? "";
  return { sku: style, style, name, url, image };
}

/** The template's links and grids — the edit panel's rows and their defaults. */
function readEmailInfo(html) {
  const doc = parseEmailDoc(html);
  const links = new Map();
  emailLinkElements(doc).forEach(({ a, key }) => {
    if (links.has(key)) return;
    const text = a.textContent.replace(/\s+/g, " ").trim();
    const alt = a.querySelector("img[alt]")?.getAttribute("alt") ?? "";
    links.set(key, {
      key,
      label: a.dataset.mmLabel || text || alt || "Link",
      group: a.closest("[data-mm-group]")?.dataset.mmGroup || "Other links",
      href: a.getAttribute("href") ?? "",
    });
  });
  const grids = [...doc.querySelectorAll("[data-mm-products]")].map((grid, i) => {
    const cards = [...grid.querySelectorAll("[data-mm-card]")];
    const firstRow = cards[0]?.closest("tr");
    const perRow = firstRow ? firstRow.querySelectorAll("[data-mm-card]").length : 1;
    return {
      key: grid.dataset.mmProducts || `grid${i + 1}`,
      label: grid.dataset.mmLabel || "Products",
      columns: Number(grid.dataset.mmColumns) || perRow || 1,
      products: cards.map(readEmailCard),
    };
  });
  const images = new Map();
  doc.querySelectorAll("img[data-mm-image]").forEach(img => {
    const key = img.dataset.mmImage;
    if (!key || images.has(key)) return;
    images.set(key, {
      key,
      label: img.dataset.mmLabel || img.getAttribute("alt") || "Image",
      group: img.closest("[data-mm-group]")?.dataset.mmGroup || "Images",
      src: img.getAttribute("src") ?? "",
    });
  });
  return { links: [...links.values()], images: [...images.values()], grids };
}

// ── Building the email ───────────────────────────────────────────────────────

/** The link and product values in force: the draft's, else the template's. */
function emailValues(info, settings) {
  const links = {};
  info.links.forEach(l => { links[l.key] = settings?.links?.[l.key] ?? l.href; });
  const images = {};
  info.images.forEach(i => { images[i.key] = settings?.images?.[i.key] || i.src; });
  const products = {};
  info.grids.forEach(g => { products[g.key] = settings?.products?.[g.key] ?? g.products; });
  return { links, images, products };
}

function fillEmailCard(card, product, width) {
  if (width) card.setAttribute("width", width);
  emailFields(card, "url").forEach(el => el.setAttribute("href", product.url || "#"));
  emailFields(card, "image").forEach(el => {
    el.setAttribute("src", product.image || "");
    el.setAttribute("alt", product.style ? `Style ${product.style}${product.color ? ` in ${product.color}` : ""}` : product.name || "");
  });
  emailFields(card, "style").forEach(el => { el.textContent = product.style || ""; });
  emailFields(card, "color").forEach(el => { el.textContent = product.color || ""; });
  // Two lines on every card — style # over colour — so the buttons are all one height.
  emailFields(card, "label").forEach(el => {
    const doc = el.ownerDocument;
    el.replaceChildren(
      doc.createTextNode(product.style || product.sku || ""),
      doc.createElement("br"),
      doc.createTextNode(product.color || " "),
    );
  });
  emailFields(card, "name").forEach(el => { el.textContent = product.name || ""; });
  return card;
}

/**
 * One grid with these products: the first card repeated, `columns` to a row.
 * A short last row is centered — its cards sit in a narrower table of their
 * own, so they keep the full rows' width.
 */
function fillEmailGrid(grid, products, columns) {
  const cards = [...grid.querySelectorAll("[data-mm-card]")];
  if (!cards.length) return;
  const proto = cards[0].cloneNode(true);
  const rows = [...new Set(cards.map(c => c.closest("tr")))];
  const rowProto = rows[0].cloneNode(false);
  const anchor = rows[0];
  const doc = grid.ownerDocument;

  for (let i = 0; i < products.length; i += columns) {
    const chunk = products.slice(i, i + columns);
    const tr = rowProto.cloneNode(false);
    if (chunk.length === columns) {
      chunk.forEach(p => tr.appendChild(fillEmailCard(proto.cloneNode(true), p)));
    } else {
      const td = doc.createElement("td");
      td.setAttribute("colspan", String(columns));
      td.setAttribute("align", "center");
      const inner = doc.createElement("table");
      ["border", "cellpadding", "cellspacing"].forEach(a => inner.setAttribute(a, "0"));
      inner.setAttribute("role", "presentation");
      inner.setAttribute("width", `${Math.round(chunk.length / columns * 100)}%`);
      inner.setAttribute("style", "table-layout:fixed;");
      const innerTr = doc.createElement("tr");
      const width = `${Math.round(100 / chunk.length)}%`;
      chunk.forEach(p => innerTr.appendChild(fillEmailCard(proto.cloneNode(true), p, width)));
      inner.appendChild(innerTr);
      td.appendChild(inner);
      tr.appendChild(td);
    }
    anchor.before(tr);
  }
  rows.forEach(r => r.remove());
}

function serializeEmailDoc(doc) {
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

/** The template with these values put in. `forExport` strips the CRM's tags. */
function buildEmailHtml(template, settings, { forExport = false } = {}) {
  const html = emailSourceFor(template.id, settings);
  const info = emailInfoFor(template.id, settings);
  const doc = parseEmailDoc(html);
  const values = emailValues(info, settings);

  emailLinkElements(doc).forEach(({ a, key }) => {
    if (values.links[key] !== undefined) a.setAttribute("href", values.links[key]);
  });
  [...doc.querySelectorAll("[data-mm-products]")].forEach((grid, i) => {
    const g = info.grids[i];
    if (g) fillEmailGrid(grid, values.products[g.key] ?? [], g.columns);
  });

  // Swapped images, and the same picture in Outlook's copy (inside comments).
  const folder = new URL(template.folder, EMAIL_PUBLIC_BASE);
  const isRelative = src => src && !/^[a-z]+:|^\/\/|^\*\|/i.test(src);
  const absolute = src => (isRelative(src) ? new URL(src, folder).href : src);
  const swaps = new Map();
  info.images.forEach(i => {
    const v = values.images[i.key];
    if (v && v !== i.src) swaps.set(absolute(i.src), v);
  });
  doc.querySelectorAll("img[data-mm-image]").forEach(img => {
    const v = values.images[img.dataset.mmImage];
    if (v) img.setAttribute("src", v);
  });
  const commentWalker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode;
    if (!c.data.includes("src=")) continue;
    c.data = c.data.replace(/(<img\b[^>]*?\bsrc=")([^"]*)"/gi, (m, pre, src) => {
      const swapped = swaps.get(absolute(src));
      if (swapped) return `${pre}${swapped}"`;
      return forExport && isRelative(src) ? `${pre}${absolute(src)}"` : m;
    });
  }

  if (forExport) {
    // Its own images (a logo bar, a hero) from where the repo is online.
    doc.querySelectorAll("img[src]").forEach(img => {
      const src = img.getAttribute("src");
      if (isRelative(src)) img.setAttribute("src", absolute(src));
    });
    doc.querySelectorAll("*").forEach(el => {
      [...el.attributes].forEach(attr => { if (attr.name.startsWith("data-mm-")) el.removeAttribute(attr.name); });
    });
    // The note on the tags at the top of the file.
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
    const notes = [];
    while (walker.nextNode()) if (walker.currentNode.data.includes("data-mm-")) notes.push(walker.currentNode);
    notes.forEach(n => n.remove());
  }
  return serializeEmailDoc(doc);
}

// ── State ────────────────────────────────────────────────────────────────────

function getEmailTemplate(id = emailTemplateId) {
  return getEmailTemplates().find(t => t.id === id) ?? null;
}

function cloneEmailSettings(s) {
  return {
    html: s?.html ?? "",
    links: { ...(s?.links ?? {}) },
    images: { ...(s?.images ?? {}) },
    products: JSON.parse(JSON.stringify(s?.products ?? {})),
  };
}

/** The HTML in use: edited in the HTML window, else the template file's. */
function emailSourceFor(id, settings) {
  return settings?.html || emailSources.get(id) || "";
}

/** Links, images and grids of edited HTML, by the HTML itself (a few kept). */
const emailEditedInfo = new Map();

function emailInfoFor(id, settings) {
  if (!settings?.html) return emailInfo.get(id);
  let info = emailEditedInfo.get(settings.html);
  if (!info) {
    if (emailEditedInfo.size > 6) emailEditedInfo.clear();
    info = readEmailInfo(settings.html);
    emailEditedInfo.set(settings.html, info);
  }
  return info;
}

/** Values that match the template's own aren't kept — the file may change. */
function compactEmailSettings(info, draft, fileHtml) {
  const html = draft.html && draft.html !== fileHtml ? draft.html : "";
  const links = {};
  info.links.forEach(l => {
    const v = draft.links[l.key];
    if (v !== undefined && v !== l.href) links[l.key] = v;
  });
  const images = {};
  info.images.forEach(i => {
    const v = draft.images?.[i.key];
    if (v && v !== i.src) images[i.key] = v;
  });
  const products = {};
  info.grids.forEach(g => {
    const v = draft.products[g.key];
    if (v && JSON.stringify(v) !== JSON.stringify(g.products)) products[g.key] = v;
  });
  return { html, links, images, products };
}

function compactEmailSettingsFor(id, settings) {
  const s = cloneEmailSettings(settings);
  const out = compactEmailSettings(emailInfoFor(id, s), s, emailSources.get(id));
  // A copy has no file: its HTML is always kept.
  if (getEmailTemplate(id)?.isCopy) out.html = s.html || emailSources.get(id) || "";
  return out;
}

function isEmailDirty() {
  if (!emailInfo.get(emailTemplateId) || !emailDraft) return false;
  const a = compactEmailSettingsFor(emailTemplateId, emailDraft);
  const b = compactEmailSettingsFor(emailTemplateId, emailSaved.get(emailTemplateId));
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** A link still holding a design-time placeholder, or nothing usable. */
function emailLinkProblem(href) {
  const v = String(href ?? "").trim();
  if (!v || v === "#") return "No link yet";
  if (/YOUR-|PLACEHOLDER|example\.com/i.test(v)) return "Still the placeholder";
  if (!/^(https?:\/\/|mailto:|tel:|\*\|)/i.test(v)) return "Should start with https://";
  return "";
}

function emailProblemCount(template) {
  if (!emailInfo.get(template.id)) return 0;
  const settings = template.id === emailTemplateId && emailDraft ? emailDraft : emailSaved.get(template.id);
  const info = emailInfoFor(template.id, settings);
  const values = emailValues(info, settings);
  return info.links.filter(l => emailLinkProblem(values.links[l.key])).length;
}

async function loadEmailTemplateSource(template) {
  if (emailSources.has(template.id)) return;
  let html;
  if (template.isCopy) {
    html = emailSaved.get(template.id)?.html ?? "";
  } else {
    const res = await fetch(`${template.file}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Couldn't load ${template.name} (${res.status}).`);
    html = await res.text();
  }
  emailSources.set(template.id, html);
  emailInfo.set(template.id, readEmailInfo(html));
}

/** Saved templates (and copies), loaded once. */
async function ensureEmailSettings() {
  if (emailSettingsLoaded) return;
  emailSettingsLoaded = true;
  try {
    emailSaved = await loadEmailSettings();
  } catch (err) {
    showEmailNotice(err.message, err.sql);
  }
}

// ── The page ─────────────────────────────────────────────────────────────────

async function renderEmailView() {
  renderEmailList();
  await ensureEmailSettings();
  if (!getEmailTemplate(emailTemplateId)) emailTemplateId = getEmailTemplates()[0]?.id ?? "";
  await openEmailTemplate(emailTemplateId);
}

/** A note above the preview; `sql`, when given, gets a Copy SQL button. */
function showEmailNotice(message, sql = "") {
  const el = document.getElementById("emailNotice");
  if (!el) return;
  el.hidden = !message;
  el.classList.remove("is-success");
  const text = document.createElement("span");
  text.textContent = message || "";
  el.replaceChildren(text);
  if (sql) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "btn";
    copy.textContent = "Copy SQL";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(sql);
        showIndicator("SQL copied", "success");
      } catch {
        showIndicator("Couldn't copy — it's at the end of supabase-schema.sql.", "error");
      }
    });
    el.append(copy);
  }
}

async function openEmailTemplate(id, { askFirst = false } = {}) {
  const template = getEmailTemplate(id);
  if (!template) {
    renderEmailEmpty();
    return;
  }
  if (askFirst && id !== emailTemplateId && isEmailDirty()
      && !confirm("You have unsaved changes on this email. Leave without saving?")) return;
  emailTemplateId = id;
  renderEmailList();
  try {
    await loadEmailTemplateSource(template);
  } catch (err) {
    showEmailNotice(err.message);
    return;
  }
  emailDraft = cloneEmailSettings(emailSaved.get(id));
  applyEmailPendingAdd(id);
  renderEmailList();
  renderEmailPanel();
  renderEmailPreview();
  syncEmailHtmlWindow();
}

function renderEmailEmpty() {
  document.getElementById("emailEditBody")?.replaceChildren();
  emailPreviewFrames().forEach(frame => { frame.srcdoc = ""; });
}

/** The template being renamed in the list, and a copy waiting for its name. */
let emailRenamingId = "";
let emailCopyPending = null;

const EMAIL_ICON_PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const EMAIL_ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

/** Another template already has this name (any case)? */
function isEmailNameTaken(name, exceptId = "") {
  const n = name.trim().toLowerCase();
  return getEmailTemplates().some(t => t.id !== exceptId && t.name.trim().toLowerCase() === n);
}

/** The name box: in place of a template's name (rename), or a new copy's. */
function createEmailNameInput(value, { onCommit, onCancel, label }) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "email-list-name-input";
  input.value = value;
  input.setAttribute("aria-label", label);
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const ok = await onCommit(input.value.trim());
    if (ok === false) {
      done = false;
      input.focus();
      input.select();
    }
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      done = true;
      onCancel();
    }
  });
  input.addEventListener("blur", () => {
    // Clicking away: keep a changed name, drop an unchanged one.
    if (done) return;
    if (input.value.trim() === value.trim()) {
      done = true;
      onCancel();
    } else {
      commit();
    }
  });
  return input;
}

function focusEmailNameInput() {
  const input = document.querySelector("#emailTemplateList .email-list-name-input");
  input?.focus();
  input?.select();
}

function startEmailRename(id) {
  emailCopyPending = null;
  emailRenamingId = id;
  renderEmailList();
  focusEmailNameInput();
}

async function commitEmailRename(id, name) {
  const template = getEmailTemplate(id);
  if (!template) return true;
  if (!name || name === template.name) {
    emailRenamingId = "";
    renderEmailList();
    return true;
  }
  if (isEmailNameTaken(name, id)) {
    showIndicator("Another template already has that name", "error");
    return false;
  }
  try {
    await renameEmailTemplate(id, name);
  } catch (err) {
    showIndicator(err.message || "Couldn't rename the template.", "error");
    return false;
  }
  emailSaved.set(id, { ...cloneEmailSettings(emailSaved.get(id)), ...emailSaved.get(id), name });
  emailRenamingId = "";
  renderEmailList();
  syncEmailHtmlWindow();
  showIndicator("Template renamed", "success");
  return true;
}

/** Save copy: a new entry at the end of the list, its name to change first. */
function startEmailCopy() {
  const template = getEmailTemplate();
  if (!template || !emailDraft) return;
  emailRenamingId = "";
  emailCopyPending = { fromId: template.id, name: template.name };
  renderEmailList();
  focusEmailNameInput();
  showIndicator("Give the copy its own name, then press Enter", "success");
}

async function commitEmailCopy(name) {
  const pending = emailCopyPending;
  const from = getEmailTemplate(pending?.fromId);
  if (!pending || !from || !emailDraft) return true;
  if (!name || isEmailNameTaken(name)) {
    showIndicator(name ? "Change the name — another template already has it" : "Give the copy a name", "error");
    return false;
  }
  // What's on screen, unsaved changes too, as a template of its own.
  const settings = compactEmailSettingsFor(from.id, emailDraft);
  settings.html = emailSourceFor(from.id, emailDraft);
  const id = `copy-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const extra = { name, folder: from.folder };
  setAppLoading(true, "Saving copy…");
  try {
    await saveEmailSettings(id, settings, extra);
  } catch (err) {
    showIndicator(err.message || "Couldn't save the copy.", "error");
    return false;
  } finally {
    setAppLoading(false);
  }
  emailSaved.set(id, { ...settings, ...extra, createdAt: new Date().toISOString() });
  emailCopyPending = null;
  showIndicator(`Saved as “${name}”`, "success");
  await openEmailTemplate(id);
  return true;
}

async function deleteEmailCopy(id) {
  const template = getEmailTemplate(id);
  if (!template?.isCopy) return;
  if (!confirm(`Delete the template “${template.name}”? This can't be undone.`)) return;
  try {
    await deleteEmailTemplate(id);
  } catch (err) {
    showIndicator(err.message || "Couldn't delete the template.", "error");
    return;
  }
  emailSaved.delete(id);
  emailSources.delete(id);
  emailInfo.delete(id);
  showIndicator("Template deleted", "success");
  if (id === emailTemplateId) await openEmailTemplate(getEmailTemplates()[0]?.id ?? "");
  else renderEmailList();
}

function createEmailListIcon(svg, label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "email-list-icon";
  b.innerHTML = svg;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", e => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function renderEmailList() {
  const list = document.getElementById("emailTemplateList");
  if (!list) return;
  const items = getEmailTemplates().map(t => {
    const item = document.createElement("div");
    item.className = "po-month po-month--top email-list-item" + (t.id === emailTemplateId ? " is-active" : "");
    if (t.id === emailRenamingId) {
      item.classList.add("is-naming");
      item.append(createEmailNameInput(t.name, {
        label: `Rename ${t.name}`,
        onCommit: name => commitEmailRename(t.id, name),
        onCancel: () => {
          emailRenamingId = "";
          renderEmailList();
        },
      }));
      return item;
    }
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "po-month-pick";
    pick.setAttribute("aria-current", String(t.id === emailTemplateId));
    const name = document.createElement("span");
    name.className = "po-month-name";
    name.textContent = t.name;
    const count = document.createElement("span");
    count.className = "po-month-count";
    const problems = emailProblemCount(t);
    if (problems) {
      count.textContent = problems.toLocaleString();
      count.classList.add("email-list-problems");
      count.title = `${problems} ${problems === 1 ? "link needs" : "links need"} a URL`;
    }
    pick.append(name, count);
    pick.addEventListener("click", () => openEmailTemplate(t.id, { askFirst: true }));
    // Shown on hover: rename, and delete for a copy.
    const tools = document.createElement("span");
    tools.className = "email-list-tools";
    tools.append(createEmailListIcon(EMAIL_ICON_PENCIL, `Rename ${t.name}`, () => startEmailRename(t.id)));
    if (t.isCopy) tools.append(createEmailListIcon(EMAIL_ICON_TRASH, `Delete ${t.name}`, () => deleteEmailCopy(t.id)));
    item.append(pick, tools);
    return item;
  });
  if (emailCopyPending) {
    const item = document.createElement("div");
    item.className = "po-month po-month--top email-list-item is-naming is-new";
    const note = document.createElement("span");
    note.className = "email-list-new-note";
    note.textContent = "New copy — change the name";
    item.append(note, createEmailNameInput(emailCopyPending.name, {
      label: "Name of the copy",
      onCommit: name => commitEmailCopy(name),
      onCancel: () => {
        emailCopyPending = null;
        renderEmailList();
      },
    }));
    items.push(item);
  }
  list.replaceChildren(...items);
}

/** Redraw the preview, a moment after typing stops. */
function scheduleEmailPreview() {
  clearTimeout(emailRenderTimer);
  emailRenderTimer = setTimeout(renderEmailPreview, 250);
}

function emailPreviewFrames() {
  return [...document.querySelectorAll("#emailPreviewPair .email-preview-frame")];
}

/** Both previews, desktop and mobile, from the draft. */
function renderEmailPreview() {
  const template = getEmailTemplate();
  const frames = emailPreviewFrames();
  if (!template || !frames.length || !emailSources.has(template.id)) return;
  let html = buildEmailHtml(template, emailDraft);
  // Its own images load from its folder.
  const base = new URL(template.folder, location.href).href;
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}" target="_blank">`);
  html = forceEmailColorScheme(html, emailScheme);
  // The surrounding preview panel owns scrolling; frames expand to their content.
  html = html.replace(/<\/head>/i, '<style>html,body{overflow:hidden!important;}</style></head>');
  frames.forEach(frame => {
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      sizeEmailFrame(frame);
      // Click a link in either preview to edit it — or, with the HTML
      // window open, any text to find it in the HTML.
      doc.addEventListener("click", e => {
        if (isEmailHtmlWindowOpen()) {
          e.preventDefault();
          findEmailHtmlFor(e.target);
          return;
        }
        const a = e.target.closest?.("a[href]");
        if (!a) return;
        e.preventDefault();
        focusEmailLinkFor(a);
      });
      doc.querySelectorAll("img").forEach(img => {
        img.addEventListener("load", () => sizeEmailFrame(frame), { once: true });
        img.addEventListener("error", () => sizeEmailFrame(frame), { once: true });
      });
      doc.fonts?.ready.then(() => {
        if (frame.contentDocument === doc) sizeEmailFrame(frame);
      });
    };
    frame.srcdoc = html;
  });
}

/**
 * The preview in light or dark whatever this computer is set to: the
 * template's prefers-color-scheme rules are switched on or off outright.
 * Only the preview — the exported HTML keeps them, so each reader's own
 * mail app still picks.
 */
function forceEmailColorScheme(html, scheme) {
  const dark = scheme === "dark";
  html = html
    .replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, dark ? "@media all" : "@media not all")
    .replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, dark ? "@media not all" : "@media all");
  const pin = `<style>:root{color-scheme:${scheme} !important;}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${pin}</head>`) : pin + html;
}

function syncEmailSchemeButtons() {
  document.querySelectorAll("#emailSchemeButtons .filter-btn").forEach(btn => {
    const on = btn.dataset.scheme === emailScheme;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

/** A frame as tall as its email, so the page scrolls, not the frame. */
function sizeEmailFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc?.documentElement) return;
  frame.style.height = "100px"; // let it shrink: scrollHeight is never less than the frame
  const height = Math.max(400, doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0);
  frame.style.height = `${Math.ceil(height) + 2}px`;
  fitEmailPreview();
}

/** Scale the pair down together until it fits beside the list and panel. */
function fitEmailPreview() {
  const stage = document.getElementById("emailPreviewStage");
  const fit = document.getElementById("emailPreviewFit");
  const pair = document.getElementById("emailPreviewPair");
  if (!stage || !fit || !pair || !stage.clientWidth) return;
  const style = getComputedStyle(stage);
  const room = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const scale = Math.min(1, room / pair.offsetWidth);
  pair.style.transform = scale < 1 ? `scale(${scale})` : "";
  fit.style.width = `${pair.offsetWidth * scale}px`;
  fit.style.height = `${pair.offsetHeight * scale}px`;
}

/** The edit panel's row for a link clicked in the preview. */
function focusEmailLinkFor(a) {
  const card = a.closest("[data-mm-card]");
  if (card) {
    const grid = a.closest("[data-mm-products]");
    const cards = [...grid.querySelectorAll("[data-mm-card]")];
    const key = grid.dataset.mmProducts;
    const index = cards.indexOf(card);
    const row = document.querySelector(`.email-product[data-grid="${CSS.escape(key)}"][data-index="${index}"]`);
    flashEmailRow(row);
    return;
  }
  const { links } = emailLinkKeysIn(a.ownerDocument);
  const key = links.get(a);
  if (!key) return;
  const input = document.querySelector(`.email-link input[data-key="${CSS.escape(key)}"]`);
  flashEmailRow(input?.closest(".email-link"), input);
}

function emailLinkKeysIn(doc) {
  const links = new Map();
  emailLinkElements(doc).forEach(({ a, key }) => links.set(a, key));
  return { links };
}

function flashEmailRow(row, input) {
  if (!row) return;
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  row.classList.remove("is-flash");
  void row.offsetWidth;
  row.classList.add("is-flash");
  input?.focus({ preventScroll: true });
  input?.select?.();
}

// ── Edit panel ───────────────────────────────────────────────────────────────

function renderEmailPanel() {
  const body = document.getElementById("emailEditBody");
  const info = emailInfoFor(emailTemplateId, emailDraft);
  if (!body || !info) return;
  const values = emailValues(info, emailDraft);
  const sections = [];

  info.grids.forEach(g => sections.push(createEmailGridSection(g, values.products[g.key] ?? [])));

  // Images and links together, by section, in template order (images first in a section).
  const groups = new Map();
  const groupOf = name => {
    if (!groups.has(name)) groups.set(name, { images: [], links: [] });
    return groups.get(name);
  };
  const order = [...parseEmailDoc(emailSourceFor(emailTemplateId, emailDraft)).querySelectorAll("[data-mm-group]")]
    .map(el => el.dataset.mmGroup);
  order.forEach(name => groupOf(name));
  info.images.forEach(i => groupOf(i.group).images.push(i));
  info.links.forEach(l => groupOf(l.group).links.push(l));
  groups.forEach(({ images, links }, group) => {
    if (!images.length && !links.length) return;
    const section = createEmailSection(group);
    images.forEach(i => section.body.appendChild(createEmailImageRow(i, values.images[i.key])));
    links.forEach(l => section.body.appendChild(createEmailLinkRow(l, values.links[l.key])));
    sections.push(section.el);
  });

  body.replaceChildren(...sections);
  syncEmailFooter();
}

function createEmailSection(title, extra) {
  const el = document.createElement("section");
  el.className = "email-section";
  const head = document.createElement("div");
  head.className = "email-section-head";
  const h = document.createElement("h3");
  h.textContent = title;
  head.append(h);
  if (extra) head.append(extra);
  const body = document.createElement("div");
  body.className = "email-section-body";
  el.append(head, body);
  return { el, body };
}

function createEmailLinkRow(link, href) {
  const row = document.createElement("label");
  row.className = "email-link";
  const label = document.createElement("span");
  label.className = "form-label";
  label.textContent = link.label;
  const input = document.createElement("input");
  input.type = "url";
  input.className = "form-input";
  input.dataset.key = link.key;
  input.value = href ?? "";
  input.spellcheck = false;
  const open = createOpenIcon("", `Open ${link.label}`);
  const field = document.createElement("div");
  field.className = "email-link-field";
  field.append(input, open);
  const problem = document.createElement("span");
  problem.className = "email-link-problem";
  const syncProblem = () => {
    const p = emailLinkProblem(input.value);
    problem.textContent = p;
    problem.hidden = !p;
    input.classList.toggle("is-invalid", Boolean(p));
    const url = input.value.trim();
    open.href = url;
    open.hidden = !/^(https?:\/\/|mailto:)\S+$/i.test(url);
  };
  syncProblem();
  input.addEventListener("input", () => {
    emailDraft.links[link.key] = input.value.trim();
    syncProblem();
    syncEmailFooter();
    renderEmailList();
    scheduleEmailPreview();
  });
  row.append(label, field, problem);
  return row;
}

/** A swappable picture: its thumbnail, its URL, and Upload / back to the template's. */
function createEmailImageRow(image, src) {
  const template = getEmailTemplate();
  const folder = new URL(template.folder, location.href);
  const row = document.createElement("div");
  row.className = "email-image";
  row.dataset.key = image.key;

  const thumb = document.createElement("img");
  thumb.className = "email-image-thumb";
  thumb.alt = "";
  thumb.src = new URL(src, folder).href;

  const main = document.createElement("div");
  main.className = "email-image-main";
  const label = document.createElement("span");
  label.className = "form-label";
  label.textContent = image.label;
  const input = document.createElement("input");
  input.type = "url";
  input.className = "form-input";
  input.spellcheck = false;
  input.placeholder = "Image URL — or Upload";
  input.value = src;
  input.addEventListener("input", () => {
    const v = input.value.trim();
    emailDraft.images[image.key] = v;
    thumb.src = v ? new URL(v, folder).href : new URL(image.src, folder).href;
    syncEmailFooter();
    scheduleEmailPreview();
  });

  const tools = document.createElement("div");
  tools.className = "email-image-tools";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/gif,image/webp";
  file.hidden = true;
  const upload = document.createElement("button");
  upload.type = "button";
  upload.className = "btn";
  upload.textContent = "Upload…";
  upload.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    file.value = "";
    if (!picked) return;
    upload.disabled = true;
    upload.textContent = "Uploading…";
    try {
      const url = await uploadEmailImage(emailTemplateId, image.key, await shrinkEmailImage(picked));
      emailDraft.images[image.key] = url;
      renderEmailPanel();
      renderEmailPreview();
      showIndicator(`${image.label} uploaded — Save to keep`, "success");
    } catch (err) {
      showIndicator(err.message || "Couldn't upload the image.", "error");
      upload.disabled = false;
      upload.textContent = "Upload…";
    }
  });
  tools.append(upload, file);

  main.append(label, input, tools);
  row.append(thumb, main);
  return row;
}

/** Emails show images 660px wide: anything bigger is scaled to 1320px (sharp on retina) and re-saved. */
const EMAIL_IMAGE_MAX_WIDTH = 1320;

async function shrinkEmailImage(file) {
  if (!String(file.type).startsWith("image/")) throw new Error("That isn't an image file.");
  if (file.type === "image/gif") return file; // keep animation
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  if (bitmap.width <= EMAIL_IMAGE_MAX_WIDTH && file.size <= 600 * 1024) return file;
  const scale = Math.min(1, EMAIL_IMAGE_MAX_WIDTH / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise(res => canvas.toBlob(res, type, 0.85));
  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, "") + (type === "image/png" ? ".png" : ".jpg");
  return new File([blob], name, { type });
}

function setEmailProducts(gridKey, products) {
  emailDraft.products[gridKey] = products;
  renderEmailPanel();
  renderEmailPreview();
}

function createEmailGridSection(grid, products) {
  const count = document.createElement("span");
  count.className = "email-section-count";
  count.textContent = `${products.length} ${products.length === 1 ? "colour" : "colours"} · ${grid.columns} per row`;
  const { el, body } = createEmailSection(grid.label, count);

  const list = document.createElement("div");
  list.className = "email-products";
  products.forEach((p, i) => list.appendChild(createEmailProductRow(grid, products, p, i)));
  if (!products.length) {
    const empty = document.createElement("p");
    empty.className = "email-empty";
    empty.textContent = "Nothing picked — the grid is left out of the email. Add a colour below.";
    list.appendChild(empty);
  }
  body.append(list, createEmailProductSearch(grid, products));
  return el;
}

function createEmailProductRow(grid, products, product, index) {
  const row = document.createElement("div");
  row.className = "email-product";
  row.dataset.grid = grid.key;
  row.dataset.index = String(index);

  const thumb = document.createElement("img");
  thumb.className = "email-product-thumb";
  thumb.alt = "";
  thumb.loading = "lazy";
  if (product.image) thumb.src = product.image;

  const main = document.createElement("div");
  main.className = "email-product-main";
  const title = document.createElement("div");
  title.className = "email-product-style";
  title.textContent = emailProductLabel(product) || "—";
  if (product.name && product.name !== product.style && !product.color) {
    const name = document.createElement("span");
    name.className = "email-product-name";
    name.textContent = product.name;
    title.append(" ", name);
  }
  // A style always links to its product page — shown, not edited.
  const url = document.createElement("a");
  url.className = "email-product-url";
  url.href = product.url || "#";
  url.target = "_blank";
  url.rel = "noopener";
  url.textContent = String(product.url || "No product page").replace(/^https?:\/\/(www\.)?/, "");
  url.title = "The product page the photo and button link to";
  main.append(title, url);
  // Checked against the catalog when it's loaded: a style that stopped showing on the webstore.
  if (mgIndex && mgIndex.has(product.sku) && mgAvailability(product.sku).available === false) {
    row.classList.add("is-unavailable");
    title.append(Object.assign(document.createElement("span"), {
      className: "email-product-unavailable",
      textContent: "Not available",
      title: `Not showing on the webstore: ${mgAvailability(product.sku).reasons.join("; ") || "unknown"}`,
    }));
  }

  const tools = document.createElement("div");
  tools.className = "email-product-tools";
  const move = (dir, label, glyph) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "email-icon-btn";
    b.textContent = glyph;
    b.setAttribute("aria-label", label);
    b.title = label;
    const to = index + dir;
    b.disabled = to < 0 || to >= products.length;
    b.addEventListener("click", () => {
      const next = [...(emailDraft.products[grid.key] ?? products)];
      [next[index], next[to]] = [next[to], next[index]];
      setEmailProducts(grid.key, next);
    });
    return b;
  };
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "email-icon-btn";
  remove.textContent = "✕";
  remove.setAttribute("aria-label", `Remove ${emailProductLabel(product)}`);
  remove.title = "Remove";
  remove.addEventListener("click", () => setEmailProducts(grid.key, (emailDraft.products[grid.key] ?? products).filter((_, i) => i !== index)));
  tools.append(move(-1, "Move up", "↑"), move(1, "Move down", "↓"), remove);

  row.append(thumb, main, tools);
  return row;
}

/** What the style search shows — kept while the panel redraws after an add. */
const emailSearch = { gridKey: "", category: "", term: "", shown: 0, open: false };
const EMAIL_SEARCH_PAGE = 30;

/**
 * Add colours: only Available ones (showing on the webstore), by category
 * and/or SKU. Availability comes from the app's catalog check
 * (js/magento-availability.js), so the list is filtered here, then the
 * colours shown are loaded from Magento for their photos, with their
 * styles for the links (a colour has no page of its own).
 */
function createEmailProductSearch(grid, products) {
  const wrap = document.createElement("div");
  wrap.className = "email-product-search";
  if (emailSearch.gridKey !== grid.key) Object.assign(emailSearch, { gridKey: grid.key, category: "", term: "", shown: 0, open: false });

  const bar = document.createElement("div");
  bar.className = "email-search-bar";
  const category = document.createElement("select");
  category.className = "email-search-category";
  category.setAttribute("aria-label", "Category");
  category.append(new Option("All categories", ""));
  if (emailSearch.category) category.append(new Option(getMgCategoryName(emailSearch.category), emailSearch.category));
  category.value = emailSearch.category;
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search style # or colour";
  input.value = emailSearch.term;
  input.setAttribute("aria-label", "Search available colours by style # or colour");
  bar.append(category, input);

  const results = document.createElement("div");
  results.className = "email-search-results";
  results.hidden = true;
  let timer = 0;
  let seq = 0;

  const setState = (text, isError = false) => {
    results.replaceChildren(Object.assign(document.createElement("div"), {
      className: "email-search-state" + (isError ? " is-error" : ""),
      textContent: text,
    }));
  };
  const close = () => {
    emailSearch.open = false;
    results.hidden = true;
  };

  /** Only categories with an available colour, each with how many. */
  const fillCategories = () => {
    const counts = emailColorCategoryCounts();
    const opts = mgCategories
      .filter(c => counts.get(String(c.id)))
      .map(c => new Option(`${"   ".repeat(Math.max(0, (c.level ?? 2) - 2))}${c.name} (${counts.get(String(c.id))})`, String(c.id)));
    category.replaceChildren(new Option(`All categories (${counts.get("") ?? 0})`, ""), ...opts);
    category.value = counts.get(emailSearch.category) ? emailSearch.category : "";
    emailSearch.category = category.value;
  };

  const run = async () => {
    const mine = ++seq;
    const term = input.value.trim();
    emailSearch.term = term;
    emailSearch.category = category.value;
    emailSearch.open = true;
    emailSearch.shown = Math.max(emailSearch.shown, EMAIL_SEARCH_PAGE);
    results.hidden = false;
    setState("Checking which colours are available…");
    try {
      await ensureEmailCatalog();
      if (mine !== seq) return;
      fillCategories();
      const skus = emailColorSkus(term, category.value);
      if (!skus.length) {
        setState(term ? "No available colours match." : "No available colours in this category.");
        return;
      }
      const page = skus.slice(0, emailSearch.shown);
      if (page.some(sku => !emailColorCache.has(sku))) setState("Loading colours…");
      const found = await loadEmailColors(page);
      if (mine !== seq) return;
      renderResults(found, skus.length);
    } catch (err) {
      if (mine !== seq) return;
      setState(err.message || "Couldn't search Magento.", true);
    }
  };

  const renderResults = (found, total) => {
    const have = new Set(products.map(p => String(p.sku).toUpperCase()));
    const head = document.createElement("div");
    head.className = "email-search-head";
    head.append(`${total.toLocaleString()} available ${total === 1 ? "colour" : "colours"} · newest first`);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "email-icon-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", "Close the results");
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);

    const rows = found.map(p => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "email-search-result";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      if (p.image) img.src = p.image;
      const text = document.createElement("span");
      const s = document.createElement("strong");
      s.textContent = p.style;
      text.append(s, ` · ${p.color}`);
      b.append(img, text);
      if (have.has(String(p.sku).toUpperCase())) {
        b.disabled = true;
        b.title = "Already in the email";
        b.append(Object.assign(document.createElement("span"), { className: "email-search-added", textContent: "Added" }));
      }
      b.addEventListener("click", () => setEmailProducts(grid.key, [...(emailDraft.products[grid.key] ?? products), p]));
      return b;
    });
    results.replaceChildren(head, ...rows);
    if (found.length < total) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn email-search-more";
      more.textContent = `Show more (${(total - found.length).toLocaleString()} left)`;
      more.addEventListener("click", () => {
        emailSearch.shown += EMAIL_SEARCH_PAGE;
        run();
      });
      results.append(more);
    }
  };

  const restart = () => {
    // Nothing picked or typed still lists every available style, to browse.
    emailSearch.shown = EMAIL_SEARCH_PAGE;
    run();
  };
  category.addEventListener("change", restart);
  category.addEventListener("focus", () => { ensureEmailCatalog().then(() => { if (!emailSearch.open) fillCategories(); }).catch(() => {}); }, { once: true });
  input.addEventListener("focus", () => { if (!emailSearch.open) restart(); });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(restart, 250);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      input.value = "";
      emailSearch.term = "";
      close();
    }
  });
  wrap.append(bar, results);
  // Redrawn after an add: pick up where it was.
  if (emailSearch.open) run();
  return wrap;
}

// Clicking elsewhere closes the results.
document.addEventListener("click", e => {
  if (!emailSearch.open || e.target.closest?.(".email-product-search, .email-product")) return;
  emailSearch.open = false;
  document.querySelectorAll(".email-search-results").forEach(r => { r.hidden = true; });
});

let emailCatalogLoading = null;

/** Store info, categories, the imported groups and the catalog check — what the search needs. */
function ensureEmailCatalog() {
  emailCatalogLoading ??= (async () => {
    if (!mgStore || mgStore.error) mgStore = await callMagento("status");
    restoreMgIndexCache();
    const jobs = [];
    if (!mgGroups) jobs.push(loadMagentoGroups());
    if (!mgCategories.length) {
      jobs.push(callMagento("categories").then(list => {
        mgCategories = list ?? [];
        mgCategoryById = new Map(mgCategories.map(c => [c.id, c]));
      }));
    }
    // Last time's catalog will do to start; a fresh check runs behind it.
    if (!mgIndex) jobs.push(loadMgIndex());
    else if (!mgIndexLoading) loadMgIndex();
    await Promise.all(jobs);
    if (!mgIndex) throw new Error(mgIndexError || "Couldn't check which colours are available.");
  })().catch(err => {
    emailCatalogLoading = null;
    throw new Error(err.message || "Couldn't reach Magento.");
  });
  return emailCatalogLoading;
}

/**
 * A colour (Simple item) that can go in an email: showing on the webstore,
 * which also means it's in a style (its group) that is. Colours have no page
 * of their own, so the email links to the style's.
 */
const isEmailColorAvailable = sku => {
  const r = mgIndex?.get(sku);
  return Boolean(r) && r.type !== "grouped" && Boolean(mgChildGroup.get(sku)) && mgAvailability(sku).available === true;
};

/** The colour's name: its SKU after the style's ("D3519-BANANA" → "BANANA"). */
function emailColorName(sku, group = mgChildGroup.get(sku)) {
  const s = String(sku);
  return group && s.toUpperCase().startsWith(`${String(group).toUpperCase()}-`) ? s.slice(String(group).length + 1) : "";
}

/** Available colours matching a SKU search and a category, newest first. */
function emailColorSkus(term = "", categoryId = "") {
  const t = term.toLowerCase();
  const out = [];
  mgIndex.forEach((r, sku) => {
    if (r.type === "grouped") return;
    if (categoryId && !r.categoryIds.includes(categoryId)) return;
    if (t && !sku.toLowerCase().includes(t) && !String(r.name ?? "").toLowerCase().includes(t)) return;
    if (!isEmailColorAvailable(sku)) return;
    out.push(sku);
  });
  return out.sort((a, b) => String(mgIndex.get(b).updatedAt).localeCompare(String(mgIndex.get(a).updatedAt)) || a.localeCompare(b));
}

/** Category id → how many available colours are in it ("" → all of them). */
function emailColorCategoryCounts() {
  const counts = new Map([["", 0]]);
  mgIndex.forEach((r, sku) => {
    if (!isEmailColorAvailable(sku)) return;
    counts.set("", counts.get("") + 1);
    r.categoryIds.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  });
  return counts;
}

/** Email products by colour SKU, loaded from Magento once each. */
const emailColorCache = new Map();

/** Colours as email products: each colour, plus its style for the link. */
async function loadEmailColors(skus) {
  const need = skus.filter(sku => !emailColorCache.has(sku));
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const groups = [...new Set(chunk.map(sku => mgChildGroup.get(sku)).filter(Boolean))];
    const want = [...chunk, ...groups];
    const page = await callMagento("products", { page: 1, pageSize: want.length, ...MG_DEFAULT_SORT, skus: want, withStock: false });
    const bySku = new Map((page?.items ?? []).map(p => [p.sku, p]));
    chunk.forEach(sku => {
      const item = bySku.get(sku);
      if (item) emailColorCache.set(sku, toEmailProduct(item, bySku.get(mgChildGroup.get(sku))));
    });
  }
  return skus.map(sku => emailColorCache.get(sku)).filter(Boolean);
}

/**
 * A colour as an email product: its own photo, the style # and colour to
 * show, and the style's page for the link (a colour has none of its own).
 */
function toEmailProduct(item, group) {
  const base = String(mgStore?.baseUrl || "https://www.mioumuse.com/").replace(/\/?$/, "/");
  const groupSku = group?.sku ?? mgChildGroup.get(item.sku) ?? item.sku;
  return {
    sku: item.sku,
    style: String(groupSku).toUpperCase(),
    color: emailColorName(item.sku, groupSku).toUpperCase(),
    name: String(group?.name ?? item.name ?? "").trim(),
    url: group?.urlKey ? `${base}${group.urlKey}.html` : base,
    image: getMgImageUrl(item),
  };
}

/** "T7989ST · GREEN MULTI" — or just the style # for a whole style. */
function emailProductLabel(product) {
  return [product.style || product.sku, product.color].filter(Boolean).join(" · ");
}

// ── From the Categories page ─────────────────────────────────────────────────

/** Styles waiting to go on a template's grid when the E-Mail page opens it. */
let emailPendingAdd = null;

/** Every template's product grids, for "Add to email": [{ templateId, gridKey, label }]. */
async function emailGridChoices() {
  const out = [];
  await ensureEmailSettings();
  for (const t of getEmailTemplates()) {
    try {
      await loadEmailTemplateSource(t);
    } catch {
      continue;
    }
    const grids = emailInfoFor(t.id, emailSaved.get(t.id))?.grids ?? [];
    grids.forEach(g => out.push({ templateId: t.id, gridKey: g.key, label: grids.length > 1 ? `${t.name} · ${g.label}` : t.name }));
  }
  return out;
}

/** Put colours on a template's grid (not saved yet) and open it on the E-Mail page. */
function addStylesToEmail(templateId, gridKey, products) {
  if (!getEmailTemplate(templateId) || !products.length) return;
  emailPendingAdd = { templateId, gridKey, products };
  emailTemplateId = templateId;
  switchAppView("email");
}

/** Called once the draft is set up: adds what's waiting, skipping colours already there. */
function applyEmailPendingAdd(id) {
  if (emailPendingAdd?.templateId !== id) return;
  const { gridKey, products } = emailPendingAdd;
  emailPendingAdd = null;
  const info = emailInfoFor(id, emailDraft);
  const grid = info?.grids.find(g => g.key === gridKey) ?? info?.grids[0];
  if (!grid) return;
  const current = emailDraft.products[grid.key] ?? grid.products;
  const have = new Set(current.map(p => String(p.sku).toUpperCase()));
  const add = products.filter(p => !have.has(String(p.sku).toUpperCase()));
  emailDraft.products[grid.key] = [...current, ...add];
  const skipped = products.length - add.length;
  showIndicator(
    add.length
      ? `Added ${add.length} ${add.length === 1 ? "colour" : "colours"} to ${grid.label}${skipped ? ` (${skipped} already there)` : ""} — Save to keep`
      : "Those colours are already in the email",
    "success",
  );
}

function syncEmailFooter() {
  const dirty = isEmailDirty();
  const save = document.getElementById("emailSaveBtn");
  const revert = document.getElementById("emailRevertBtn");
  if (save) save.disabled = !dirty;
  if (revert) revert.disabled = !dirty;
  const state = document.getElementById("emailSaveState");
  if (state) state.textContent = dirty ? "Unsaved changes" : "Saved";
}

/** Save updates the template itself. */
async function saveEmailDraft() {
  if (!emailInfo.get(emailTemplateId) || !emailDraft) return;
  const settings = compactEmailSettingsFor(emailTemplateId, emailDraft);
  setAppLoading(true, "Saving…");
  try {
    await saveEmailSettings(emailTemplateId, settings);
    // Its name, folder and date stay as they were.
    emailSaved.set(emailTemplateId, { ...emailSaved.get(emailTemplateId), ...settings });
    showIndicator("Template saved", "success");
  } catch (err) {
    showIndicator(err.message || "Couldn't save.", "error");
  } finally {
    setAppLoading(false);
  }
  syncEmailFooter();
  renderEmailList();
}

function revertEmailDraft() {
  emailDraft = cloneEmailSettings(emailSaved.get(emailTemplateId));
  renderEmailList();
  renderEmailPanel();
  renderEmailPreview();
  syncEmailHtmlWindow();
}

// ── Edit HTML ────────────────────────────────────────────────────────────────
//
// The template's HTML to edit by hand — its text, mostly — filling the right
// panel in place of the links. Kept in the draft (settings.html) and saved
// with the rest; the links, images and products set in the panel still go on
// top of it. Click text in the preview while it's open to find it here.
// The editor is CodeMirror 5 (colour-coded HTML), loaded on first open.

const EMAIL_CM_BASE = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/";
const EMAIL_CM_SCRIPTS = [
  "codemirror.min.js",
  "mode/xml/xml.min.js",
  "mode/javascript/javascript.min.js",
  "mode/css/css.min.js",
  "mode/htmlmixed/htmlmixed.min.js",
  "addon/search/searchcursor.min.js",
];

let emailHtmlTimer = 0;
let emailCm = null;
let emailCmLoading = null;
/** The editor's text is being set from the draft, not typed. */
let emailCmSetting = false;

function loadEmailCodeMirror() {
  emailCmLoading ??= (async () => {
    for (const file of EMAIL_CM_SCRIPTS) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = EMAIL_CM_BASE + file;
        s.onload = resolve;
        s.onerror = () => reject(new Error("Couldn't load the HTML editor — check the connection and try again."));
        document.head.appendChild(s);
      });
    }
  })().catch(err => {
    emailCmLoading = null;
    throw err;
  });
  return emailCmLoading;
}

async function ensureEmailCm() {
  if (emailCm) return emailCm;
  await loadEmailCodeMirror();
  const host = document.getElementById("emailHtmlEditor");
  const focusFind = () => {
    const find = document.getElementById("emailHtmlFind");
    const sel = emailCm.getSelection();
    if (sel && !sel.includes("\n") && sel.length < 80) find.value = sel;
    find.focus();
    find.select();
  };
  emailCm = window.CodeMirror(host, {
    mode: "htmlmixed",
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 2,
    tabSize: 2,
    extraKeys: { "Ctrl-F": focusFind, "Cmd-F": focusFind },
  });
  emailCm.on("change", () => {
    if (!emailCmSetting) onEmailHtmlInput();
  });
  return emailCm;
}

function isEmailHtmlWindowOpen() {
  return !document.getElementById("emailHtmlPane")?.hidden;
}

async function openEmailHtmlWindow() {
  const pane = document.getElementById("emailHtmlPane");
  if (!pane || !emailDraft) return;
  pane.hidden = false;
  document.getElementById("emailEditPanel")?.classList.add("is-html");
  document.getElementById("emailHtmlBtn")?.classList.add("active");
  applyEmailPanelWidth();
  try {
    await ensureEmailCm();
  } catch (err) {
    showIndicator(err.message, "error");
    closeEmailHtmlWindow();
    return;
  }
  syncEmailHtmlWindow();
  emailCm.refresh();
  emailCm.focus();
}

function closeEmailHtmlWindow() {
  const pane = document.getElementById("emailHtmlPane");
  if (pane) pane.hidden = true;
  document.getElementById("emailEditPanel")?.classList.remove("is-html");
  document.getElementById("emailHtmlBtn")?.classList.remove("active");
  applyEmailPanelWidth();
}

/** The editor's text and note, from the draft (after a template switch, Revert …). */
function syncEmailHtmlWindow() {
  if (!isEmailHtmlWindowOpen() || !emailCm) return;
  const html = emailSourceFor(emailTemplateId, emailDraft);
  if (emailCm.getValue() !== html) {
    emailCmSetting = true;
    emailCm.setValue(html);
    emailCmSetting = false;
    emailCm.clearHistory();
    emailCm.scrollTo(0, 0);
  }
  const title = document.getElementById("emailHtmlTitle");
  if (title) title.textContent = `Edit HTML · ${getEmailTemplate()?.name ?? ""}`;
}

function onEmailHtmlInput() {
  if (!emailCm || !emailDraft) return;
  const value = emailCm.getValue();
  emailDraft.html = value === emailSources.get(emailTemplateId) ? "" : value;
  syncEmailFooter();
  clearTimeout(emailHtmlTimer);
  emailHtmlTimer = setTimeout(() => {
    renderEmailPanel();
    renderEmailList();
    renderEmailPreview();
  }, 400);
}

/** HTML-escaped as it might be written in the file. */
function emailHtmlVariants(s) {
  const amp = s.replace(/&/g, "&amp;");
  const esc = amp.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nbsp = esc.replace(/ /g, "&nbsp;");
  const quotes = nbsp.replace(/’/g, "&rsquo;").replace(/‘/g, "&lsquo;").replace(/“/g, "&ldquo;").replace(/”/g, "&rdquo;");
  return [...new Set([s, amp, esc, nbsp, quotes])];
}

/** Find the clicked text in the HTML, select it and scroll to it. */
function findEmailHtmlFor(target) {
  if (!emailCm || !target) return;
  // The longest piece of text under what was clicked (text split by <br> is several).
  const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let best = "";
  while (walker.nextNode()) {
    const t = walker.currentNode.data.replace(/\s+/g, " ").trim();
    if (t.length > best.length) best = t;
  }
  if (!best) best = target.closest?.("img")?.getAttribute("alt") ?? "";
  if (!best) return;
  const value = emailCm.getValue();
  for (const needle of emailHtmlVariants(best)) {
    const at = value.indexOf(needle);
    if (at >= 0) {
      selectEmailHtmlRange(at, at + needle.length);
      return;
    }
  }
  // Whitespace in the file may differ: try just the start.
  const start = best.slice(0, 24);
  const at = start.length >= 6 ? value.indexOf(start) : -1;
  if (at >= 0) selectEmailHtmlRange(at, at + start.length);
  else showIndicator("Couldn't find that text in the HTML — try the Find box", "error");
}

function selectEmailHtmlRange(from, to) {
  if (!emailCm) return;
  const a = emailCm.posFromIndex(from);
  const b = emailCm.posFromIndex(to);
  emailCm.focus();
  emailCm.setSelection(a, b);
  emailCm.scrollIntoView({ from: a, to: b }, Math.round(emailCm.getScrollInfo().clientHeight / 3));
}

function findEmailHtmlNext(term, backwards = false) {
  if (!emailCm || !term) return;
  const start = backwards ? emailCm.getCursor("from") : emailCm.getCursor("to");
  let cur = emailCm.getSearchCursor(term, start, { caseFold: true });
  let found = backwards ? cur.findPrevious() : cur.findNext();
  if (!found) {
    // Wrap around.
    const edge = backwards ? emailCm.posFromIndex(emailCm.getValue().length) : { line: 0, ch: 0 };
    cur = emailCm.getSearchCursor(term, edge, { caseFold: true });
    found = backwards ? cur.findPrevious() : cur.findNext();
  }
  if (!found) {
    showIndicator("Not found", "error");
    return;
  }
  emailCm.setSelection(cur.from(), cur.to());
  emailCm.scrollIntoView({ from: cur.from(), to: cur.to() }, Math.round(emailCm.getScrollInfo().clientHeight / 3));
}

// ── Panel width ──────────────────────────────────────────────────────────────
//
// Drag the panel's left border to resize it. The links and Edit HTML each
// keep their own width (Edit HTML starts at half the page).

const EMAIL_PANEL_MIN = 280;
const EMAIL_PREVIEW_MIN = 240;

function emailPanelWidthKey() {
  return isEmailHtmlWindowOpen() ? "email.panelWidth.html" : "email.panelWidth.links";
}

function readEmailPanelWidth() {
  try {
    return Number(localStorage.getItem(emailPanelWidthKey())) || 0;
  } catch {
    return 0;
  }
}

function clampEmailPanelWidth(width) {
  const layout = document.getElementById("emailWrap");
  const list = document.getElementById("emailTemplateList");
  const room = (layout?.clientWidth ?? 0) - (list?.offsetWidth ?? 0) - EMAIL_PREVIEW_MIN;
  return Math.round(Math.max(EMAIL_PANEL_MIN, Math.min(width, Math.max(EMAIL_PANEL_MIN, room))));
}

function applyEmailPanelWidth() {
  const panel = document.getElementById("emailEditPanel");
  if (!panel) return;
  let width = readEmailPanelWidth();
  if (!width && isEmailHtmlWindowOpen()) width = (document.getElementById("emailWrap")?.clientWidth ?? 1200) * 0.5;
  panel.style.flexBasis = width ? `${clampEmailPanelWidth(width)}px` : "";
  emailCm?.refresh();
}

function setupEmailPanelResizer() {
  const panel = document.getElementById("emailEditPanel");
  const handle = document.getElementById("emailEditResizer");
  if (!panel || !handle) return;
  handle.addEventListener("pointerdown", e => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;
    let frame = 0;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing-email");
    const move = ev => {
      panel.style.flexBasis = `${clampEmailPanelWidth(startWidth + (startX - ev.clientX))}px`;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => emailCm?.refresh());
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("is-resizing-email");
      try {
        localStorage.setItem(emailPanelWidthKey(), String(panel.offsetWidth));
      } catch { /* a remembered width is a nicety */ }
      emailCm?.refresh();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  // Double-click the border: back to the usual width.
  handle.addEventListener("dblclick", () => {
    try {
      localStorage.removeItem(emailPanelWidthKey());
    } catch { /* ignored */ }
    applyEmailPanelWidth();
  });
  window.addEventListener("resize", () => {
    if (panel.style.flexBasis) applyEmailPanelWidth();
  });
}

function setupEmailHtmlWindow() {
  document.getElementById("emailHtmlBtn")?.addEventListener("click", () => (isEmailHtmlWindowOpen() ? closeEmailHtmlWindow() : openEmailHtmlWindow()));
  document.getElementById("emailHtmlCloseBtn")?.addEventListener("click", closeEmailHtmlWindow);
  const find = document.getElementById("emailHtmlFind");
  find?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      findEmailHtmlNext(find.value.trim(), e.shiftKey);
      find.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      find.value = "";
      emailCm?.focus();
    }
  });
  setupEmailPanelResizer();
  applyEmailPanelWidth();
}

function exportEmailHtml() {
  const template = getEmailTemplate();
  if (!template || !emailSources.has(template.id)) return "";
  return buildEmailHtml(template, emailDraft, { forExport: true });
}

function warnEmailProblems() {
  const n = emailProblemCount(getEmailTemplate());
  if (n) showIndicator(`${n} ${n === 1 ? "link still needs" : "links still need"} a URL`, "error");
  return n;
}

async function copyEmailHtml() {
  const html = exportEmailHtml();
  if (!html) return;
  try {
    await navigator.clipboard.writeText(html);
    if (!warnEmailProblems()) showIndicator("HTML copied — paste it into Mailchimp's Code your own", "success");
  } catch {
    showIndicator("Couldn't copy — try Download instead.", "error");
  }
}

function downloadEmailHtml() {
  const html = exportEmailHtml();
  if (!html) return;
  const template = getEmailTemplate();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `MIOU MUSE email - ${template.name}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  warnEmailProblems();
}

// ── Send to Mailchimp ────────────────────────────────────────────────────────
//
// The exported HTML goes into a Mailchimp campaign as its content (the
// `content` action of the mailchimp function). Which campaign: an Email task's
// linked one, a new one made for an Email task (js/mailchimp.js's create
// form), or any other unsent draft. Sent campaigns are never changed.

const EMAIL_MC_OPEN = new Set(["save", "paused", "schedule"]);

/** Which groups the dialog shows: "all", "campaign" or "show". */
let emailMcFilter = "all";

/** Email tasks worth offering: linked to an unsent campaign, or still to do. */
function emailMcTaskChoices() {
  const since = ymd(addDays(parseYmd(todayYmd()), -14));
  const out = [];
  getAllScheduleItems().forEach(item => {
    if (item.type !== ITEM_TYPE_CAMPAIGN && item.type !== ITEM_TYPE_TRADE_SHOW) return;
    item.tasks.filter(t => t.kind === TASK_KIND_EMAIL).forEach(task => {
      const link = getTaskLink(task.id);
      const campaign = link ? getMcCampaign(link.campaignId) : null;
      if (link) {
        if (campaign && (campaign.missing || !EMAIL_MC_OPEN.has(campaign.status))) return;
      } else if (isTaskComplete(task.id) || task.dueDate < since) {
        return;
      }
      out.push({ task, item, campaign, linked: Boolean(link) });
    });
  });
  return out.sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate));
}

function createEmailMcRow({ title, sub, status, action, onClick }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "mc-link-row";
  const top = document.createElement("span");
  top.className = "mc-link-row-top";
  const t = document.createElement("span");
  t.className = "mc-link-title";
  t.textContent = title;
  top.append(t);
  if (status) {
    const badge = document.createElement("span");
    badge.className = "mc-status";
    badge.dataset.tone = status.tone;
    badge.textContent = status.label;
    top.append(badge);
  }
  const s = document.createElement("span");
  s.className = "mc-link-sub";
  s.textContent = sub;
  const go = document.createElement("span");
  go.className = "email-mc-action";
  go.textContent = action;
  row.append(top, s, go);
  row.addEventListener("click", onClick);
  return row;
}

async function openEmailMcDialog() {
  const template = getEmailTemplate();
  if (!template || !emailSources.has(template.id)) return;
  if (isMailchimpConnected() === false || mcConnected === null) await syncMailchimp();
  if (!isMailchimpConnected()) {
    showIndicator(mcError || "Mailchimp isn't connected.", "error");
    return;
  }
  document.getElementById("emailMcTitle").textContent = template.name;
  const problems = emailProblemCount(template);
  const warning = document.getElementById("emailMcWarning");
  warning.hidden = !problems;
  warning.textContent = problems
    ? `${problems} ${problems === 1 ? "link still needs" : "links still need"} a URL — you can send now and again later.`
    : "";
  document.getElementById("emailMcMoreBtn").hidden = false;
  renderEmailMcTasks();
  document.getElementById("emailMcOverlay").classList.add("open");
}

function closeEmailMcDialog() {
  document.getElementById("emailMcOverlay")?.classList.remove("open");
}

const EMAIL_MC_KIND = {
  [ITEM_TYPE_CAMPAIGN]: { filter: "campaign", label: "Campaign" },
  [ITEM_TYPE_TRADE_SHOW]: { filter: "show", label: "Trade show" },
};

/** The pills: which is on, and how many emails each would show. */
function syncEmailMcFilters(choices) {
  const bar = document.getElementById("emailMcFilters");
  if (!bar) return;
  bar.hidden = !choices.length;
  const counts = { all: choices.length, campaign: 0, show: 0 };
  choices.forEach(c => { counts[EMAIL_MC_KIND[c.item.type].filter] += 1; });
  bar.querySelectorAll(".cal-filter-btn").forEach(btn => {
    const key = btn.dataset.filter;
    const on = key === emailMcFilter;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
    const label = key === "all" ? "All" : key === "campaign" ? "Campaign" : "Trade show";
    btn.textContent = `${label} ${counts[key]}`;
  });
}

/** Send to a linked campaign, or make one for the task first. */
function sendEmailForTask({ task, item, linked }) {
  if (linked) {
    sendEmailToMailchimp(getTaskLink(task.id).campaignId);
    return;
  }
  closeEmailMcDialog();
  openMcForm({ mode: "create", task, item, onCreated: created => sendEmailToMailchimp(created.id) });
}

/** One email under its campaign / show: what, when, its Mailchimp state, and its button. */
function createEmailMcTaskRow(choice) {
  const { task, campaign, linked } = choice;
  const row = document.createElement("div");
  row.className = "email-mc-email";

  const main = document.createElement("div");
  main.className = "email-mc-email-main";
  const top = document.createElement("div");
  top.className = "email-mc-email-top";
  const icon = createCalEventIcon(task.kind);
  icon.classList.add("email-mc-email-icon");
  const label = document.createElement("span");
  label.className = "email-mc-email-label";
  label.textContent = task.label;
  const due = document.createElement("span");
  due.className = "email-mc-email-due";
  due.textContent = formatTaskDateShort(task.dueDate);
  if (isTaskOverdue(task)) {
    due.classList.add("is-overdue");
    due.title = "Overdue";
  }
  top.append(icon, label, due);
  if (linked) {
    const { label: statusLabel, tone } = describeMcStatus(campaign);
    const pill = document.createElement("span");
    pill.className = "mc-status";
    pill.dataset.tone = tone;
    pill.textContent = statusLabel;
    top.append(pill);
  }
  const sub = document.createElement("div");
  sub.className = "email-mc-email-sub";
  sub.textContent = linked
    ? (campaign?.subject ? `“${campaign.subject}”` : "No subject yet")
    : "Not in Mailchimp yet";
  main.append(top, sub);

  const send = document.createElement("button");
  send.type = "button";
  send.className = "btn email-mc-send" + (linked ? " btn-primary" : "");
  send.textContent = linked ? "Send HTML" : "Create & send";
  send.title = linked ? "Put this template into the email's Mailchimp campaign" : "Make the email's Mailchimp campaign, then put this template in it";
  send.addEventListener("click", () => sendEmailForTask(choice));

  row.append(main, send);
  return row;
}

/**
 * The Email tasks, grouped under their campaign or trade show like its
 * detail pane, in its colour — groups in order of their first email.
 */
function renderEmailMcTasks() {
  const list = document.getElementById("emailMcList");
  const choices = emailMcTaskChoices();
  syncEmailMcFilters(choices);
  if (!choices.length) {
    list.replaceChildren(Object.assign(document.createElement("div"), {
      className: "mc-link-empty",
      textContent: "No upcoming Email tasks. Add one to a campaign or trade show, or pick another draft below.",
    }));
    return;
  }
  const shown = choices.filter(c => emailMcFilter === "all" || EMAIL_MC_KIND[c.item.type].filter === emailMcFilter);
  if (!shown.length) {
    list.replaceChildren(Object.assign(document.createElement("div"), {
      className: "mc-link-empty",
      textContent: emailMcFilter === "campaign" ? "No campaign emails to send." : "No trade show emails to send.",
    }));
    return;
  }
  // Choices come sorted by due date, so groups land in order of their first email.
  const groups = new Map();
  shown.forEach(c => {
    const key = `${c.item.type}|${c.item.id}`;
    if (!groups.has(key)) groups.set(key, { item: c.item, emails: [] });
    groups.get(key).emails.push(c);
  });
  list.replaceChildren(...[...groups.values()].map(({ item, emails }) => {
    const group = document.createElement("section");
    group.className = "email-mc-group";
    applyItemColor(group, item);
    const head = document.createElement("div");
    head.className = "email-mc-group-head";
    const kind = document.createElement("span");
    kind.className = "email-mc-group-kind";
    kind.textContent = EMAIL_MC_KIND[item.type].label;
    const title = document.createElement("span");
    title.className = "email-mc-group-title";
    title.textContent = item.title;
    const dates = document.createElement("span");
    dates.className = "email-mc-group-dates";
    dates.textContent = formatDateRange(item.startDate, item.endDate);
    head.append(kind, title, dates);
    const body = document.createElement("div");
    body.className = "email-mc-group-emails";
    emails.forEach(c => body.appendChild(createEmailMcTaskRow(c)));
    group.append(head, body);
    return group;
  }));
}

/** Unsent Mailchimp campaigns not linked to a task. */
async function showEmailMcOtherDrafts() {
  const list = document.getElementById("emailMcList");
  document.getElementById("emailMcMoreBtn").hidden = true;
  // The pills sort tasks; here they take you back to them.
  document.querySelectorAll("#emailMcFilters .cal-filter-btn").forEach(btn => {
    btn.classList.remove("is-active");
    btn.setAttribute("aria-pressed", "false");
  });
  list.replaceChildren(Object.assign(document.createElement("div"), { className: "mc-link-empty", textContent: "Loading campaigns from Mailchimp…" }));
  try {
    const all = await callMailchimp("campaigns");
    const drafts = (all ?? []).filter(c => EMAIL_MC_OPEN.has(c.status) && !findTaskLinkedTo(c.id));
    if (!drafts.length) {
      list.replaceChildren(Object.assign(document.createElement("div"), { className: "mc-link-empty", textContent: "No other unsent campaigns in Mailchimp." }));
      return;
    }
    list.replaceChildren(...drafts.map(c => createEmailMcRow({
      title: c.title || "(untitled)",
      sub: [c.subject ? `“${c.subject}”` : "No subject yet", c.listName].filter(Boolean).join(" · "),
      status: describeMcStatus(c),
      action: "Send HTML",
      onClick: () => sendEmailToMailchimp(c.id),
    })));
  } catch (err) {
    list.replaceChildren(Object.assign(document.createElement("div"), { className: "mc-link-empty", textContent: err.message || "Couldn't load campaigns." }));
  }
}

async function sendEmailToMailchimp(campaignId) {
  const html = exportEmailHtml();
  if (!html) return;
  const current = getMcCampaign(campaignId);
  if (current?.status === "schedule"
      && !confirm("This campaign is scheduled. Replace its email? It stays scheduled for the same time.")) return;
  setAppLoading(true, "Sending to Mailchimp…");
  try {
    const updated = await callMailchimp("content", { id: campaignId, html });
    mcCampaigns.set(updated.id, updated);
    closeEmailMcDialog();
    refreshTaskViews();
    showEmailSentNotice(updated);
  } catch (err) {
    showIndicator(err.message || "Couldn't send to Mailchimp.", "error");
  } finally {
    setAppLoading(false);
  }
}

/** Sent: say where, with the way in to test and schedule it. */
function showEmailSentNotice(campaign) {
  const el = document.getElementById("emailNotice");
  if (!el) return;
  const text = document.createElement("span");
  text.textContent = `Sent to Mailchimp: “${campaign.title || campaign.subject || "campaign"}”. Send a test and schedule it there.`;
  const open = document.createElement("a");
  open.className = "btn";
  open.href = campaign.editUrl;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open in Mailchimp ↗";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "✕";
  close.addEventListener("click", () => { el.hidden = true; });
  el.replaceChildren(text, open, close);
  el.hidden = false;
  el.classList.add("is-success");
}

/** Leaving the page (or the app) with unsaved changes asks first. */
function confirmLeaveEmail() {
  if (getCurrentAppView() !== "email" || !isEmailDirty()) return true;
  return confirm("You have unsaved changes on this email. Leave without saving?");
}

function initEmailView() {
  document.querySelectorAll("#emailSchemeButtons .filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      emailScheme = btn.dataset.scheme;
      syncEmailSchemeButtons();
      renderEmailPreview();
    });
  });
  syncEmailSchemeButtons();
  const stage = document.getElementById("emailPreviewStage");
  if (stage && "ResizeObserver" in window) new ResizeObserver(() => fitEmailPreview()).observe(stage);
  document.getElementById("emailCopyBtn")?.addEventListener("click", copyEmailHtml);
  document.getElementById("emailMcBtn")?.addEventListener("click", openEmailMcDialog);
  document.getElementById("emailMcCloseBtn")?.addEventListener("click", closeEmailMcDialog);
  document.querySelectorAll("#emailMcFilters .cal-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      emailMcFilter = btn.dataset.filter;
      document.getElementById("emailMcMoreBtn").hidden = false;
      renderEmailMcTasks();
    });
  });
  document.getElementById("emailMcMoreBtn")?.addEventListener("click", showEmailMcOtherDrafts);
  document.getElementById("emailMcOverlay")?.addEventListener("click", e => {
    if (e.target.id === "emailMcOverlay") closeEmailMcDialog();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("emailMcOverlay")?.classList.contains("open")) closeEmailMcDialog();
  });
  document.getElementById("emailDownloadBtn")?.addEventListener("click", downloadEmailHtml);
  document.getElementById("emailSaveBtn")?.addEventListener("click", saveEmailDraft);
  document.getElementById("emailRevertBtn")?.addEventListener("click", revertEmailDraft);
  document.getElementById("emailCopySaveBtn")?.addEventListener("click", startEmailCopy);
  setupEmailHtmlWindow();
  window.addEventListener("beforeunload", e => {
    if (getCurrentAppView() === "email" && isEmailDirty()) e.preventDefault();
  });
}
