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
 *                           url (href), image (src + alt), style, name (text)
 * Mailchimp merge-tag links (*|UNSUB|* …) are left alone.
 *
 * What you set (links, products) is saved per template in Supabase
 * (email_settings, js/store.js); the template file itself never changes.
 */

const EMAIL_TEMPLATES = [
  { id: "end-of-year-sale", name: "End of Year Sale", file: "email-templates/end-of-year-sale/template.html" },
];

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
  const style = emailFields(card, "style")[0]?.textContent.trim() ?? "";
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
  return { links: [...links.values()], grids };
}

// ── Building the email ───────────────────────────────────────────────────────

/** The link and product values in force: the draft's, else the template's. */
function emailValues(info, settings) {
  const links = {};
  info.links.forEach(l => { links[l.key] = settings?.links?.[l.key] ?? l.href; });
  const products = {};
  info.grids.forEach(g => { products[g.key] = settings?.products?.[g.key] ?? g.products; });
  return { links, products };
}

function fillEmailCard(card, product, width) {
  if (width) card.setAttribute("width", width);
  emailFields(card, "url").forEach(el => el.setAttribute("href", product.url || "#"));
  emailFields(card, "image").forEach(el => {
    el.setAttribute("src", product.image || "");
    el.setAttribute("alt", product.style ? `Style ${product.style}` : product.name || "");
  });
  emailFields(card, "style").forEach(el => { el.textContent = product.style || ""; });
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
  const html = emailSources.get(template.id) ?? "";
  const info = emailInfo.get(template.id);
  const doc = parseEmailDoc(html);
  const values = emailValues(info, settings);

  emailLinkElements(doc).forEach(({ a, key }) => {
    if (values.links[key] !== undefined) a.setAttribute("href", values.links[key]);
  });
  [...doc.querySelectorAll("[data-mm-products]")].forEach((grid, i) => {
    const g = info.grids[i];
    if (g) fillEmailGrid(grid, values.products[g.key] ?? [], g.columns);
  });

  if (forExport) {
    // Its own images (a logo bar, a hero) from where the repo is online.
    const folder = new URL(template.file.replace(/[^/]+$/, ""), EMAIL_PUBLIC_BASE);
    doc.querySelectorAll("img[src]").forEach(img => {
      const src = img.getAttribute("src");
      if (src && !/^[a-z]+:|^\/\/|^\*\|/i.test(src)) img.setAttribute("src", new URL(src, folder).href);
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
  return EMAIL_TEMPLATES.find(t => t.id === id) ?? null;
}

function cloneEmailSettings(s) {
  return { links: { ...(s?.links ?? {}) }, products: JSON.parse(JSON.stringify(s?.products ?? {})) };
}

/** Values that match the template's own aren't kept — the file may change. */
function compactEmailSettings(info, draft) {
  const links = {};
  info.links.forEach(l => {
    const v = draft.links[l.key];
    if (v !== undefined && v !== l.href) links[l.key] = v;
  });
  const products = {};
  info.grids.forEach(g => {
    const v = draft.products[g.key];
    if (v && JSON.stringify(v) !== JSON.stringify(g.products)) products[g.key] = v;
  });
  return { links, products };
}

function isEmailDirty() {
  const info = emailInfo.get(emailTemplateId);
  if (!info || !emailDraft) return false;
  const a = compactEmailSettings(info, emailDraft);
  const b = compactEmailSettings(info, cloneEmailSettings(emailSaved.get(emailTemplateId)));
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
  const info = emailInfo.get(template.id);
  if (!info) return 0;
  const settings = template.id === emailTemplateId && emailDraft ? emailDraft : emailSaved.get(template.id);
  const values = emailValues(info, settings);
  return info.links.filter(l => emailLinkProblem(values.links[l.key])).length;
}

async function loadEmailTemplateSource(template) {
  if (emailSources.has(template.id)) return;
  const res = await fetch(`${template.file}?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load ${template.name} (${res.status}).`);
  const html = await res.text();
  emailSources.set(template.id, html);
  emailInfo.set(template.id, readEmailInfo(html));
}

// ── The page ─────────────────────────────────────────────────────────────────

async function renderEmailView() {
  renderEmailList();
  if (!emailSettingsLoaded) {
    emailSettingsLoaded = true;
    try {
      emailSaved = await loadEmailSettings();
    } catch (err) {
      showEmailNotice(err.message, err.sql);
    }
  }
  await openEmailTemplate(emailTemplateId);
}

/** A note above the preview; `sql`, when given, gets a Copy SQL button. */
function showEmailNotice(message, sql = "") {
  const el = document.getElementById("emailNotice");
  if (!el) return;
  el.hidden = !message;
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
  renderEmailList();
  renderEmailPanel();
  renderEmailPreview();
}

function renderEmailEmpty() {
  document.getElementById("emailEditBody")?.replaceChildren();
  emailPreviewFrames().forEach(frame => { frame.srcdoc = ""; });
}

function renderEmailList() {
  const list = document.getElementById("emailTemplateList");
  if (!list) return;
  list.replaceChildren(...EMAIL_TEMPLATES.map(t => {
    const item = document.createElement("div");
    item.className = "po-month po-month--top" + (t.id === emailTemplateId ? " is-active" : "");
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
    item.append(pick);
    return item;
  }));
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
  const base = new URL(template.file.replace(/[^/]+$/, ""), location.href).href;
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${base}" target="_blank">`);
  html = forceEmailColorScheme(html, emailScheme);
  frames.forEach(frame => {
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      sizeEmailFrame(frame);
      // Click a link in either preview to edit it.
      doc.addEventListener("click", e => {
        const a = e.target.closest?.("a[href]");
        if (!a) return;
        e.preventDefault();
        focusEmailLinkFor(a);
      });
      doc.querySelectorAll("img").forEach(img => img.addEventListener("load", () => sizeEmailFrame(frame), { once: true }));
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
  frame.style.height = `${Math.max(400, doc.documentElement.scrollHeight)}px`;
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
    flashEmailRow(row, row?.querySelector("input"));
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
  const info = emailInfo.get(emailTemplateId);
  if (!body || !info) return;
  const values = emailValues(info, emailDraft);
  const sections = [];

  info.grids.forEach(g => sections.push(createEmailGridSection(g, values.products[g.key] ?? [])));

  const groups = new Map();
  info.links.forEach(l => {
    if (!groups.has(l.group)) groups.set(l.group, []);
    groups.get(l.group).push(l);
  });
  groups.forEach((links, group) => {
    const section = createEmailSection(group);
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
  const problem = document.createElement("span");
  problem.className = "email-link-problem";
  const syncProblem = () => {
    const p = emailLinkProblem(input.value);
    problem.textContent = p;
    problem.hidden = !p;
    input.classList.toggle("is-invalid", Boolean(p));
  };
  syncProblem();
  input.addEventListener("input", () => {
    emailDraft.links[link.key] = input.value.trim();
    syncProblem();
    syncEmailFooter();
    renderEmailList();
    scheduleEmailPreview();
  });
  row.append(label, input, problem);
  return row;
}

function setEmailProducts(gridKey, products) {
  emailDraft.products[gridKey] = products;
  renderEmailPanel();
  renderEmailPreview();
}

function createEmailGridSection(grid, products) {
  const count = document.createElement("span");
  count.className = "email-section-count";
  count.textContent = `${products.length} ${products.length === 1 ? "style" : "styles"} · ${grid.columns} per row`;
  const { el, body } = createEmailSection(grid.label, count);

  const list = document.createElement("div");
  list.className = "email-products";
  products.forEach((p, i) => list.appendChild(createEmailProductRow(grid, products, p, i)));
  if (!products.length) {
    const empty = document.createElement("p");
    empty.className = "email-empty";
    empty.textContent = "No styles — the grid is left out of the email. Add one below.";
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
  title.textContent = product.style || product.sku || "—";
  if (product.name && product.name !== product.style) {
    const name = document.createElement("span");
    name.className = "email-product-name";
    name.textContent = product.name;
    title.append(" ", name);
  }
  const url = document.createElement("input");
  url.type = "url";
  url.className = "form-input email-product-url";
  url.value = product.url || "";
  url.spellcheck = false;
  url.title = "Where the photo and button link to";
  url.addEventListener("input", () => {
    // The template's own list stays as it is; the draft gets a copy.
    const list = emailDraft.products[grid.key] ??= JSON.parse(JSON.stringify(products));
    list[index] = { ...list[index], url: url.value.trim() };
    syncEmailFooter();
    scheduleEmailPreview();
  });
  main.append(title, url);

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
  remove.setAttribute("aria-label", `Remove ${product.style}`);
  remove.title = "Remove";
  remove.addEventListener("click", () => setEmailProducts(grid.key, (emailDraft.products[grid.key] ?? products).filter((_, i) => i !== index)));
  tools.append(move(-1, "Move up", "↑"), move(1, "Move down", "↓"), remove);

  row.append(thumb, main, tools);
  return row;
}

/** Add a style: search Magento's grouped products (one per style). */
function createEmailProductSearch(grid, products) {
  const wrap = document.createElement("div");
  wrap.className = "email-product-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Add a style — search SKU or name";
  const results = document.createElement("div");
  results.className = "email-search-results";
  results.hidden = true;
  let timer = 0;
  let seq = 0;

  const run = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    if (q.length < 2) {
      results.hidden = true;
      return;
    }
    results.hidden = false;
    results.replaceChildren(Object.assign(document.createElement("div"), { className: "email-search-state", textContent: "Searching Magento…" }));
    try {
      const found = await searchEmailProducts(q);
      if (mine !== seq) return;
      if (!found.length) {
        results.replaceChildren(Object.assign(document.createElement("div"), { className: "email-search-state", textContent: "No styles match." }));
        return;
      }
      const have = new Set(products.map(p => String(p.sku).toUpperCase()));
      results.replaceChildren(...found.map(p => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "email-search-result";
        const img = document.createElement("img");
        img.alt = "";
        if (p.image) img.src = p.image;
        const text = document.createElement("span");
        const s = document.createElement("strong");
        s.textContent = p.style;
        text.append(s, " ", p.name !== p.style ? p.name : "");
        b.append(img, text);
        const added = have.has(String(p.sku).toUpperCase());
        if (added) {
          b.disabled = true;
          b.title = "Already in the email";
        }
        b.addEventListener("click", () => setEmailProducts(grid.key, [...(emailDraft.products[grid.key] ?? products), p]));
        return b;
      }));
    } catch (err) {
      if (mine !== seq) return;
      results.replaceChildren(Object.assign(document.createElement("div"), { className: "email-search-state is-error", textContent: err.message || "Couldn't search Magento." }));
    }
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      input.value = "";
      results.hidden = true;
    }
  });
  wrap.append(input, results);
  return wrap;
}

/** Magento's grouped products (styles) for a search, as email products. */
async function searchEmailProducts(search) {
  if (!mgStore || mgStore.error) {
    try {
      mgStore = await callMagento("status");
    } catch (err) {
      throw new Error(err.message || "Couldn't reach Magento.");
    }
  }
  const page = await callMagento("products", { page: 1, pageSize: 20, ...MG_DEFAULT_SORT, search, type: "grouped" });
  const styles = page?.items ?? [];
  // A style's photo sits on its colours: one call for each style's first.
  const firstChild = new Map();
  styles.forEach(p => { if (!getMgImageUrl(p) && p.childSkus?.length) firstChild.set(p.sku, p.childSkus[0]); });
  const childImages = new Map();
  if (firstChild.size) {
    const skus = [...new Set(firstChild.values())];
    const children = await callMagento("products", { page: 1, pageSize: skus.length, ...MG_DEFAULT_SORT, skus }).catch(() => null);
    (children?.items ?? []).forEach(c => childImages.set(c.sku, getMgImageUrl(c)));
  }
  const base = String(mgStore.baseUrl || "https://www.mioumuse.com/").replace(/\/?$/, "/");
  return styles.map(p => ({
    sku: p.sku,
    style: String(p.sku).toUpperCase(),
    name: String(p.name ?? "").trim(),
    url: p.urlKey ? `${base}${p.urlKey}.html` : base,
    image: getMgImageUrl(p) || childImages.get(firstChild.get(p.sku)) || "",
  }));
}

function syncEmailFooter() {
  const dirty = isEmailDirty();
  const save = document.getElementById("emailSaveBtn");
  const revert = document.getElementById("emailRevertBtn");
  if (save) save.disabled = !dirty;
  if (revert) revert.disabled = !dirty;
  const state = document.getElementById("emailSaveState");
  if (state) state.textContent = dirty ? "Unsaved changes" : (emailSaved.has(emailTemplateId) ? "Saved" : "Template defaults");
}

async function saveEmailDraft() {
  const info = emailInfo.get(emailTemplateId);
  if (!info || !emailDraft) return;
  const settings = compactEmailSettings(info, emailDraft);
  setAppLoading(true, "Saving…");
  try {
    await saveEmailSettings(emailTemplateId, settings);
    emailSaved.set(emailTemplateId, settings);
    showIndicator("Email saved", "success");
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
}

/** Back to the template file's own links and products (not saved yet). */
function resetEmailDraft() {
  if (!confirm("Reset every link and product to the template's own? You can still Revert before saving.")) return;
  emailDraft = { links: {}, products: {} };
  renderEmailList();
  renderEmailPanel();
  renderEmailPreview();
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
  document.getElementById("emailDownloadBtn")?.addEventListener("click", downloadEmailHtml);
  document.getElementById("emailSaveBtn")?.addEventListener("click", saveEmailDraft);
  document.getElementById("emailRevertBtn")?.addEventListener("click", revertEmailDraft);
  document.getElementById("emailResetBtn")?.addEventListener("click", resetEmailDraft);
  window.addEventListener("beforeunload", e => {
    if (getCurrentAppView() === "email" && isEmailDirty()) e.preventDefault();
  });
}
