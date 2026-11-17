/**
 * Messages and notifications, app-wide.
 *
 *   showIndicator(msg, type)  pops a message in the bottom-right corner, just
 *                             above the footer. Successes and plain messages
 *                             fade after a few seconds (not while the pointer
 *                             is on them); errors stay until their ✕.
 *   The bell (header)         counts the notifications you haven't seen.
 *                             Click it for the latest few; Show all opens the
 *                             full list in a panel on the right.
 *
 * Successes and errors are kept as notifications (in this browser, the latest
 * NOTIF_MAX). Plain messages ("Preparing…") are passing status: they pop up
 * but aren't kept. Opening the list counts everything in it as seen.
 *
 * Each notification has a category: what the app says about itself is
 * "system"; notify({ msg, type, category }) files one under inventory, orders
 * or tasks. The panel's filters follow the categories there are. Chat
 * messages pop up here too (showChatToast) but live in Messages, not the bell.
 */

const NOTIF_STORE_KEY = "crm.notifications.v1";
const NOTIF_MAX = 200;
const NOTIF_DROPDOWN_COUNT = 8;
const TOAST_MS = 4000;
const TOAST_MAX = 4;
const TOAST_LEAVE_MS = 180;

const NOTIF_ICONS = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5V8"/></svg>`,
};

/** What a notification is about; the panel filters by these (in this order). */
const NOTIF_CATEGORIES = {
  inventory: "Inventory",
  orders: "Orders",
  tasks: "Tasks",
  system: "System",
};

const NOTIF_TOAST_MS = { chat: 6000 };

/** Newest first: { id, msg, type: "success" | "error" | "info", category, at, read }. */
let notifications = loadNotifications();
let notifPanelFilter = "all";
let notifPanelTimer = null;

function loadNotifications() {
  try {
    const list = JSON.parse(localStorage.getItem(NOTIF_STORE_KEY) || "[]");
    return Array.isArray(list)
      ? list.filter(n => n && n.msg).map(n => ({ ...n, category: NOTIF_CATEGORIES[n.category] ? n.category : "system" }))
      : [];
  } catch {
    return [];
  }
}

function saveNotifications() {
  try {
    localStorage.setItem(NOTIF_STORE_KEY, JSON.stringify(notifications));
  } catch { /* private window or full: the list just lasts this visit */ }
}

// ── Messages (bottom right) ──────────────────────────────────────────────────

/** type: "" | "success" | "error". Success auto-dismisses; errors persist. */
function showIndicator(msg, type = "") {
  const text = String(msg ?? "").trim();
  if (!text) return;
  if (type === "success" || type === "error") addNotification(text, type, "system");
  showToast(text, type);
}

/**
 * A notification for the bell, with its pop-up. category: "inventory" |
 * "orders" | "tasks" | "system"; type: "info" | "success" | "error".
 */
function notify({ msg, type = "info", category = "system", toast = true }) {
  const text = String(msg ?? "").trim();
  if (!text) return;
  const kind = ["success", "error"].includes(type) ? type : "info";
  addNotification(text, kind, NOTIF_CATEGORIES[category] ? category : "system");
  if (toast) showToast(text, kind === "info" ? "" : kind);
}

/** A chat message popping up: who, what, and a click to open it (js/chat.js). */
function showChatToast({ title, text, avatarHtml = "", onClick }) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = "toast toast--chat";
  toast.dataset.type = "chat";
  toast.setAttribute("role", "status");
  toast.innerHTML = `<span class="toast-avatar">${avatarHtml}</span>`
    + `<button type="button" class="toast-chat-body"><span class="toast-title"></span><span class="toast-text toast-text--clamp"></span></button>`
    + `<button type="button" class="toast-close" aria-label="Dismiss message">✕</button>`;
  toast.querySelector(".toast-title").textContent = title;
  toast.querySelector(".toast-text").textContent = text;
  toast.querySelector(".toast-chat-body").addEventListener("click", () => {
    dismissToast(toast);
    onClick?.();
  });
  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
  toast.addEventListener("mouseenter", () => clearTimeout(toast._timer));
  toast.addEventListener("mouseleave", () => scheduleToast(toast));
  stack.append(toast);
  scheduleToast(toast);
  const live = liveToasts();
  live.slice(0, Math.max(0, live.length - TOAST_MAX)).forEach(dismissToast);
}

/** Takes away the passing messages ("Preparing…"); errors stay. */
function clearIndicator() {
  document.querySelectorAll("#toastStack .toast[data-type='']").forEach(dismissToast);
}

function liveToasts() {
  return [...document.querySelectorAll("#toastStack .toast:not(.is-leaving)")];
}

function showToast(text, type) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  // The same message again (a second save, say) restarts that one rather than stacking another.
  let toast = liveToasts().find(t => t.dataset.msg === text && t.dataset.type === type);
  if (!toast) {
    toast = document.createElement("div");
    toast.className = `toast toast--${type || "info"}`;
    toast.dataset.msg = text;
    toast.dataset.type = type;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.innerHTML = `<span class="toast-icon">${NOTIF_ICONS[type || "info"]}</span>`
      + `<div class="toast-text"></div>`
      + `<button type="button" class="toast-close" aria-label="Dismiss message">✕</button>`;
    toast.querySelector(".toast-text").textContent = text;
    toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
    toast.addEventListener("mouseenter", () => clearTimeout(toast._timer));
    toast.addEventListener("mouseleave", () => scheduleToast(toast));
    stack.append(toast);
  }
  scheduleToast(toast);

  // Too many at once: the oldest go first.
  const live = liveToasts();
  live.slice(0, Math.max(0, live.length - TOAST_MAX)).forEach(dismissToast);
}

function scheduleToast(toast) {
  clearTimeout(toast._timer);
  if (toast.dataset.type !== "error") toast._timer = setTimeout(() => dismissToast(toast), NOTIF_TOAST_MS[toast.dataset.type] ?? TOAST_MS);
}

function dismissToast(toast) {
  if (!toast || toast.classList.contains("is-leaving")) return;
  clearTimeout(toast._timer);
  toast.classList.add("is-leaving");
  setTimeout(() => toast.remove(), TOAST_LEAVE_MS);
}

// ── Notifications ────────────────────────────────────────────────────────────

function addNotification(msg, type, category = "system") {
  const now = Date.now();
  const prev = notifications[0];
  // The same thing again within a few seconds is one notification.
  if (prev && prev.msg === msg && prev.type === type && prev.category === category && now - prev.at < 5000) {
    prev.at = now;
    prev.read = false;
  } else {
    notifications.unshift({ id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`, msg, type, category, at: now, read: false });
    if (notifications.length > NOTIF_MAX) notifications.length = NOTIF_MAX;
  }
  saveNotifications();
  renderNotifications();
}

function unreadNotificationCount() {
  return notifications.filter(n => !n.read).length;
}

function markAllNotificationsRead() {
  if (!notifications.some(n => !n.read)) return;
  notifications.forEach(n => { n.read = true; });
  saveNotifications();
  renderNotifications();
}

function removeNotification(id) {
  notifications = notifications.filter(n => n.id !== id);
  saveNotifications();
  renderNotifications();
}

function clearNotifications() {
  notifications = [];
  saveNotifications();
  renderNotifications();
}

/** "Just now", "5m ago", "3h ago", "Yesterday 4:10 PM", "Nov 12, 9:02 AM". */
function notificationTime(at) {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 12 * 60) return `${Math.floor(mins / 60)}h ago`;
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = notificationDayLabel(at);
  return day === "Today" || day === "Yesterday" ? `${day} ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function notificationDayLabel(at) {
  const d = new Date(at);
  const today = new Date();
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(today) - start(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function notificationItemHtml(n, { removable = false } = {}) {
  return `<li class="notif-item notif-item--${n.type}${n.read ? "" : " is-unread"}" data-id="${n.id}">
    <span class="notif-item-icon">${NOTIF_ICONS[n.type] || NOTIF_ICONS.info}</span>
    <div class="notif-item-body">
      <div class="notif-item-msg">${escapeNotifHtml(n.msg)}</div>
      <div class="notif-item-meta"><span class="notif-item-cat">${NOTIF_CATEGORIES[n.category] ?? "System"}</span><span aria-hidden="true">·</span><time class="notif-item-time" datetime="${new Date(n.at).toISOString()}" title="${escapeNotifHtml(new Date(n.at).toLocaleString())}">${notificationTime(n.at)}</time></div>
    </div>
    ${removable ? `<button type="button" class="notif-item-remove" data-remove="${n.id}" aria-label="Remove notification" title="Remove">✕</button>` : ""}
  </li>`;
}

function escapeNotifHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderNotifications() {
  renderNotificationBadge();
  if (!document.getElementById("notifDropdown")?.hidden) renderNotificationDropdown();
  if (!document.getElementById("notifPanel")?.hidden) renderNotificationPanel();
}

function renderNotificationBadge() {
  const badge = document.getElementById("notifBadge");
  const btn = document.getElementById("notifBtn");
  const count = unreadNotificationCount();
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }
  btn?.setAttribute("aria-label", count ? `Notifications, ${count} unread` : "Notifications");
}

function renderNotificationDropdown() {
  const list = document.getElementById("notifDropdownList");
  if (!list) return;
  const latest = notifications.slice(0, NOTIF_DROPDOWN_COUNT);
  list.innerHTML = latest.length
    ? latest.map(n => notificationItemHtml(n)).join("")
    : `<li class="notif-empty">No notifications yet</li>`;
  const more = notifications.length - latest.length;
  const showAll = document.getElementById("notifShowAll");
  if (showAll) showAll.textContent = more > 0 ? `Show all (${notifications.length})` : "Show all";
  document.getElementById("notifMarkRead").hidden = !notifications.some(n => !n.read);
}

function renderNotificationPanel() {
  const filtersEl = document.getElementById("notifPanelFilters");
  const listEl = document.getElementById("notifPanelList");
  if (!filtersEl || !listEl) return;

  // All, Unread, each category, Errors — only those something falls under (All always).
  const filters = [
    { key: "all", label: "All", match: () => true },
    { key: "unread", label: "Unread", match: n => !n.read },
    ...Object.entries(NOTIF_CATEGORIES).map(([key, label]) => ({ key: `cat:${key}`, label, match: n => n.category === key })),
    { key: "error", label: "Errors", match: n => n.type === "error" },
  ];
  const matches = Object.fromEntries(filters.map(f => [f.key, f.match]));
  const counts = Object.fromEntries(filters.map(f => [f.key, notifications.filter(f.match).length]));
  // One category only: its chip would just repeat All.
  const categoriesUsed = filters.filter(f => f.key.startsWith("cat:") && counts[f.key] > 0).length;
  const shown = filters.filter(f => f.key === "all"
    || (counts[f.key] > 0 && (!f.key.startsWith("cat:") || categoriesUsed > 1)));
  if (!shown.some(f => f.key === notifPanelFilter)) notifPanelFilter = "all";
  filtersEl.innerHTML = shown.map(f => `<button type="button" class="notif-filter${f.key === notifPanelFilter ? " is-active" : ""}" data-filter="${f.key}" aria-pressed="${f.key === notifPanelFilter}">${f.label}<span class="notif-filter-count">${counts[f.key]}</span></button>`).join("");

  const items = notifications.filter(matches[notifPanelFilter]);
  if (!items.length) {
    listEl.innerHTML = `<div class="notif-empty notif-empty--panel">${notifications.length ? "Nothing here" : "No notifications yet"}</div>`;
  } else {
    let html = "";
    let day = null;
    for (const n of items) {
      const label = notificationDayLabel(n.at);
      if (label !== day) {
        if (day !== null) html += `</ul>`;
        html += `<div class="notif-day">${label}</div><ul class="notif-list">`;
        day = label;
      }
      html += notificationItemHtml(n, { removable: true });
    }
    listEl.innerHTML = `${html}</ul>`;
  }
  document.getElementById("notifPanelMarkRead").disabled = !notifications.some(n => !n.read);
  document.getElementById("notifPanelClear").disabled = !notifications.length;
}

// ── Bell, dropdown and panel ─────────────────────────────────────────────────

function openNotificationDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;
  closeHeaderMenu?.();
  renderNotificationDropdown();
  dropdown.hidden = false;
  document.getElementById("notifBtn")?.setAttribute("aria-expanded", "true");
  // Seen now; they keep their unread mark until the list is next drawn.
  if (unreadNotificationCount()) {
    notifications.forEach(n => { n.read = true; });
    saveNotifications();
    renderNotificationBadge();
  }
}

function closeNotificationDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown || dropdown.hidden) return;
  dropdown.hidden = true;
  document.getElementById("notifBtn")?.setAttribute("aria-expanded", "false");
}

function openNotificationPanel() {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  closeNotificationDropdown();
  notifPanelFilter = "all";
  renderNotificationPanel();
  panel.hidden = false;
  document.body.classList.add("is-notif-panel-open");
  markAllNotificationsRead();
  clearInterval(notifPanelTimer);
  notifPanelTimer = setInterval(renderNotificationPanel, 60000); // keeps "5m ago" current
  panel.querySelector(".notif-panel-close")?.focus({ preventScroll: true });
}

function closeNotificationPanel() {
  const panel = document.getElementById("notifPanel");
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove("is-notif-panel-open");
  clearInterval(notifPanelTimer);
  markAllNotificationsRead();
}

/** The footer's height, for the messages and the panel to sit above it. */
function trackAppFooterHeight() {
  const footer = document.getElementById("appFooter");
  if (!footer) return;
  const sync = () => document.documentElement.style.setProperty("--app-footer-h", `${footer.offsetHeight}px`);
  sync();
  if (window.ResizeObserver) new ResizeObserver(sync).observe(footer);
  // Hiding the footer doesn't resize it as far as the observer's concerned.
  new MutationObserver(sync).observe(footer, { attributes: true, attributeFilter: ["hidden"] });
}

function initNotifications() {
  trackAppFooterHeight();
  renderNotificationBadge();

  const btn = document.getElementById("notifBtn");
  const dropdown = document.getElementById("notifDropdown");
  const panel = document.getElementById("notifPanel");
  if (!btn || !dropdown || !panel) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    if (dropdown.hidden) openNotificationDropdown();
    else closeNotificationDropdown();
  });
  // The ⋮ menu opening closes this one.
  document.getElementById("headerMenuBtn")?.addEventListener("click", closeNotificationDropdown);

  document.getElementById("notifShowAll")?.addEventListener("click", openNotificationPanel);
  document.getElementById("notifMarkRead")?.addEventListener("click", e => {
    e.stopPropagation();
    markAllNotificationsRead();
    renderNotificationDropdown();
  });

  panel.querySelector(".notif-panel-close")?.addEventListener("click", closeNotificationPanel);
  document.getElementById("notifPanelMarkRead")?.addEventListener("click", markAllNotificationsRead);
  document.getElementById("notifPanelClear")?.addEventListener("click", () => {
    if (!notifications.length) return;
    if (!window.confirm(`Clear all ${notifications.length} notifications?`)) return;
    clearNotifications();
  });
  document.getElementById("notifPanelFilters")?.addEventListener("click", e => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    notifPanelFilter = chip.dataset.filter;
    renderNotificationPanel();
  });
  document.getElementById("notifPanelList")?.addEventListener("click", e => {
    const remove = e.target.closest("[data-remove]");
    if (remove) removeNotification(remove.dataset.remove);
  });

  document.addEventListener("click", e => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && !btn.contains(e.target)) closeNotificationDropdown();
  });
  // A press outside the panel closes it (not on the bell, a message, or a dialog).
  document.addEventListener("pointerdown", e => {
    if (panel.hidden || e.button !== 0) return;
    const t = e.target;
    if (!(t instanceof Element) || t.closest("#notifPanel, .notif-wrap, #toastStack, .modal-backdrop")) return;
    closeNotificationPanel();
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!dropdown.hidden) { closeNotificationDropdown(); btn.focus(); }
    else if (!panel.hidden) closeNotificationPanel();
  });

  // Another tab added or read some.
  window.addEventListener("storage", e => {
    if (e.key !== NOTIF_STORE_KEY) return;
    notifications = loadNotifications();
    renderNotifications();
  });
}
