/**
 * Messages: direct messages and group chats with the rest of the team.
 *
 *   Messages page   every chat down the left (direct messages, then groups,
 *                   with what's unread in bold); the one picked on the right.
 *   Mini windows    a chat in a small window, bottom right, over whatever
 *                   page you're on (two at most). They come back after a reload.
 *   Header icon     unread count; click for the latest chats, New chat, or
 *                   the Messages page.
 *
 * Everything arrives live (Supabase Realtime). A message in a chat you're not
 * looking at pops up bottom right; clicking it opens that chat. Messages
 * aren't kept in the bell: that's for the app's own notifications.
 *
 * Tables and the functions that start, join and read chats:
 * supabase/migrations/20261117150100_chat.sql.
 */

const CHAT_PAGE_SIZE = 50;
const CHAT_MINI_MAX = 2;
const CHAT_MINI_KEY = "crm.chat.mini.v1";
const CHAT_DROPDOWN_COUNT = 8;
const CHAT_GROUP_GAP_MS = 5 * 60 * 1000; // one sender's messages this close share a name
const CHAT_AVATAR_COLORS = ["#6d5bd0", "#2f7ab8", "#1f8a70", "#c2410c", "#b83280", "#4d7c0f", "#a16207", "#0e7490", "#7c3aed", "#be123c"];

const CHAT_ICONS = {
  send: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>`,
  group: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  expand: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`,
  popout: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>`,
  minimize: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  chat: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
};

const chat = {
  started: false,
  ready: false,
  me: null,
  people: new Map(), // id → { id, name, email, color }
  convs: new Map(), // id → { id, kind, title, lastMessageAt, lastReadAt, memberIds, lastBody, lastSenderId, lastDeleted, unread }
  messages: new Map(), // conversation id → { list, all, loading }
  drafts: new Map(), // conversation id → text not sent yet
  editing: new Map(), // conversation id → message id being edited
  activeId: null, // the chat open on the Messages page
  search: "",
  mini: [], // [{ id, min }], oldest first
  channel: null,
  refreshTimer: 0,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function chatEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Message text: escaped, links clickable, line breaks kept (by CSS). */
function chatBodyHtml(text) {
  return chatEsc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function chatColorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHAT_AVATAR_COLORS[h % CHAT_AVATAR_COLORS.length];
}

function chatPerson(id) {
  return chat.people.get(id) ?? { id, name: "Someone", email: "", color: chatColorFor(id) };
}

function chatFirstName(id) {
  return chatPerson(id).name.split(/\s+/)[0] || "Someone";
}

function chatInitials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function chatAvatarHtml(id, size = "") {
  const p = chatPerson(id);
  return `<span class="chat-avatar${size ? ` chat-avatar--${size}` : ""}" style="background:${p.color}" aria-hidden="true">${chatEsc(chatInitials(p.name))}</span>`;
}

function chatConvAvatarHtml(conv, size = "") {
  if (conv.kind === "dm") return chatAvatarHtml(chatOtherMember(conv), size);
  return `<span class="chat-avatar chat-avatar--group${size ? ` chat-avatar--${size}` : ""}" aria-hidden="true">${CHAT_ICONS.group}</span>`;
}

function chatOtherMember(conv) {
  return conv.memberIds.find(id => id !== chat.me) ?? chat.me;
}

function chatConvTitle(conv) {
  if (!conv) return "";
  if (conv.kind === "dm") return chatPerson(chatOtherMember(conv)).name;
  if (conv.title) return conv.title;
  const others = conv.memberIds.filter(id => id !== chat.me).map(chatFirstName);
  if (others.length <= 3) return others.join(", ") || "Group";
  return `${others.slice(0, 2).join(", ")} & ${others.length - 2} others`;
}

function chatConvSubtitle(conv) {
  if (conv.kind === "dm") return chatPerson(chatOtherMember(conv)).email;
  return `${conv.memberIds.length} people`;
}

function chatSnippet(conv) {
  if (!conv.lastSenderId) return conv.kind === "group" ? "Group created" : "Say hello";
  const who = conv.lastSenderId === chat.me ? "You: " : conv.kind === "group" ? `${chatFirstName(conv.lastSenderId)}: ` : "";
  return who + (conv.lastDeleted ? "Message deleted" : String(conv.lastBody ?? "").replace(/\s+/g, " "));
}

/** "3:04 PM" today, "Mon" this week, "Nov 12" before that. */
function chatListTime(at) {
  if (!at) return "";
  const d = new Date(at);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function chatTotalUnread() {
  let n = 0;
  chat.convs.forEach(c => { n += c.unread; });
  return n;
}

function sortedChatConvs() {
  return [...chat.convs.values()].sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
}

function chatTeammates() {
  return [...chat.people.values()].filter(p => p.id !== chat.me).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadChatPeople() {
  const { data, error } = await requireClient().from("profiles").select("id, display_name, email, avatar_color");
  if (error) throw new Error(error.message);
  chat.people = new Map((data ?? []).map(p => [p.id, {
    id: p.id,
    name: p.display_name || p.email || "Someone",
    email: p.email || "",
    color: p.avatar_color || chatColorFor(p.id),
  }]));
}

async function loadChatInbox() {
  const { data, error } = await requireClient().rpc("chat_inbox");
  if (error) throw new Error(error.message);
  const next = new Map();
  for (const r of data ?? []) {
    next.set(r.id, {
      id: r.id,
      kind: r.kind,
      title: r.title || "",
      lastMessageAt: r.last_message_at,
      lastReadAt: r.last_read_at,
      memberIds: r.member_ids ?? [],
      lastBody: r.last_body,
      lastSenderId: r.last_sender_id,
      lastDeleted: Boolean(r.last_deleted),
      unread: r.unread_count ?? 0,
    });
  }
  chat.convs = next;
  // Someone new in a chat: their name.
  const unknown = [...next.values()].some(c => c.memberIds.some(id => !chat.people.has(id)));
  if (unknown) await loadChatPeople();
  // A chat you've left (or that's gone) closes wherever it was showing.
  chat.mini = chat.mini.filter(w => next.has(w.id));
  if (chat.activeId && !next.has(chat.activeId)) chat.activeId = null;
}

function refreshChatInboxSoon() {
  clearTimeout(chat.refreshTimer);
  chat.refreshTimer = setTimeout(async () => {
    try {
      await loadChatInbox();
      renderChatEverywhere();
    } catch { /* tried again on the next change */ }
  }, 300);
}

function chatMessageFromRow(r) {
  return { id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, body: r.body ?? "", createdAt: r.created_at, editedAt: r.edited_at, deletedAt: r.deleted_at, pending: false, failed: false };
}

async function ensureChatMessages(id) {
  let cache = chat.messages.get(id);
  if (cache) return cache;
  cache = { list: [], all: false, loading: true };
  chat.messages.set(id, cache);
  try {
    const { data, error } = await requireClient().from("chat_messages")
      .select("*").eq("conversation_id", id)
      .order("created_at", { ascending: false }).limit(CHAT_PAGE_SIZE);
    if (error) throw new Error(error.message);
    // Any that arrived live while this was loading stay.
    const live = cache.list;
    cache.list = (data ?? []).map(chatMessageFromRow).reverse();
    live.forEach(m => { if (!cache.list.some(x => x.id === m.id)) cache.list.push(m); });
    cache.all = (data ?? []).length < CHAT_PAGE_SIZE;
  } catch (err) {
    chat.messages.delete(id);
    showIndicator(`Couldn't load the messages: ${err.message}`, "error");
  } finally {
    cache.loading = false;
  }
  return cache;
}

async function loadEarlierChatMessages(id) {
  const cache = chat.messages.get(id);
  if (!cache || cache.all || cache.loading || !cache.list.length) return;
  cache.loading = true;
  try {
    const { data, error } = await requireClient().from("chat_messages")
      .select("*").eq("conversation_id", id)
      .lt("created_at", cache.list[0].createdAt)
      .order("created_at", { ascending: false }).limit(CHAT_PAGE_SIZE);
    if (error) throw new Error(error.message);
    cache.list = [...(data ?? []).map(chatMessageFromRow).reverse(), ...cache.list];
    cache.all = (data ?? []).length < CHAT_PAGE_SIZE;
  } catch (err) {
    showIndicator(`Couldn't load earlier messages: ${err.message}`, "error");
  } finally {
    cache.loading = false;
  }
  renderChatThreads(id, { keepScroll: true });
}

async function sendChatMessage(id, text) {
  const body = text.trim();
  if (!body) return;
  if (body.length > 8000) {
    showIndicator("That message is too long (8,000 characters at most).", "error");
    return;
  }
  const cache = await ensureChatMessages(id);
  // The id is made here, so the live copy of this message is recognised as this one.
  const msg = { id: crypto.randomUUID(), conversationId: id, senderId: chat.me, body, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, pending: true, failed: false };
  cache.list.push(msg);
  const conv = chat.convs.get(id);
  if (conv) Object.assign(conv, { lastMessageAt: msg.createdAt, lastBody: body, lastSenderId: chat.me, lastDeleted: false });
  renderChatEverywhere({ scrollTo: id });
  const { error } = await requireClient().from("chat_messages").insert({ id: msg.id, conversation_id: id, body });
  msg.pending = false;
  if (error) {
    msg.failed = true;
    showIndicator(`Message not sent: ${error.message}`, "error");
  }
  renderChatThreads(id);
}

async function retryChatMessage(id, messageId) {
  const cache = chat.messages.get(id);
  const msg = cache?.list.find(m => m.id === messageId);
  if (!msg) return;
  cache.list = cache.list.filter(m => m !== msg);
  await sendChatMessage(id, msg.body);
}

async function saveChatEdit(id, messageId, text) {
  const body = text.trim();
  if (!body) return;
  const msg = chat.messages.get(id)?.list.find(m => m.id === messageId);
  const { error } = await requireClient().rpc("chat_edit_message", { message: messageId, new_body: body });
  if (error) { showIndicator(`Couldn't edit the message: ${error.message}`, "error"); return; }
  if (msg) Object.assign(msg, { body, editedAt: new Date().toISOString() });
  renderChatThreads(id);
}

async function deleteChatMessage(id, messageId) {
  if (!window.confirm("Delete this message for everyone?")) return;
  const { error } = await requireClient().rpc("chat_delete_message", { message: messageId });
  if (error) { showIndicator(`Couldn't delete the message: ${error.message}`, "error"); return; }
  const msg = chat.messages.get(id)?.list.find(m => m.id === messageId);
  if (msg) Object.assign(msg, { body: "", deletedAt: new Date().toISOString() });
  renderChatEverywhere();
}

async function markChatRead(id) {
  const conv = chat.convs.get(id);
  if (!conv || !conv.unread) return;
  conv.unread = 0;
  conv.lastReadAt = new Date().toISOString();
  renderChatChrome();
  const { error } = await requireClient().rpc("chat_mark_read", { conv: id });
  if (error) refreshChatInboxSoon();
}

/** Showing on screen right now (the Messages page, or an open mini window). */
function isChatShowing(id) {
  if (document.visibilityState !== "visible") return false;
  if (getCurrentAppView() === "messages" && chat.activeId === id) return true;
  return chat.mini.some(w => w.id === id && !w.min);
}

function markShowingChatsRead() {
  chat.convs.forEach(c => { if (c.unread && isChatShowing(c.id)) markChatRead(c.id); });
}

async function startDirectMessage(personId) {
  const { data, error } = await requireClient().rpc("chat_start_dm", { other: personId });
  if (error) throw new Error(error.message);
  await loadChatInbox();
  return data;
}

async function createGroupChat(title, memberIds) {
  const { data, error } = await requireClient().rpc("chat_create_group", { group_title: title, member_ids: memberIds });
  if (error) throw new Error(error.message);
  await loadChatInbox();
  return data;
}

// ── Live ─────────────────────────────────────────────────────────────────────

function subscribeChat() {
  let subscribedBefore = false;
  chat.channel = requireClient().channel("chat-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, p => onLiveChatMessage(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, p => onLiveChatMessageUpdate(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, () => refreshChatInboxSoon())
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_conversations" }, p => {
      const conv = chat.convs.get(p.new?.id);
      if (conv && (p.new.title ?? "") !== conv.title) refreshChatInboxSoon();
    })
    .subscribe(status => {
      if (status !== "SUBSCRIBED") return;
      // Back after a dropped connection: catch up on what was missed.
      if (subscribedBefore) {
        chat.messages.clear();
        refreshChatInboxSoon();
        chat.mini.forEach(w => ensureChatMessages(w.id).then(() => renderChatThreads(w.id)));
        if (chat.activeId) ensureChatMessages(chat.activeId).then(() => renderChatThreads(chat.activeId));
      }
      subscribedBefore = true;
    });
}

async function onLiveChatMessage(row) {
  const msg = chatMessageFromRow(row);
  let conv = chat.convs.get(msg.conversationId);
  const fresh = !conv;
  if (fresh) {
    // A chat you were just added to; its unread count comes with it.
    try { await loadChatInbox(); } catch { return; }
    conv = chat.convs.get(msg.conversationId);
    if (!conv) return;
  } else {
    Object.assign(conv, { lastMessageAt: msg.createdAt, lastBody: msg.body, lastSenderId: msg.senderId, lastDeleted: Boolean(msg.deletedAt) });
  }

  const cache = chat.messages.get(msg.conversationId);
  if (cache) {
    const mine = cache.list.find(m => m.id === msg.id);
    if (mine) Object.assign(mine, msg);
    else cache.list.push(msg);
  }

  if (msg.senderId !== chat.me) {
    if (isChatShowing(msg.conversationId)) {
      conv.unread = 0;
      requireClient().rpc("chat_mark_read", { conv: msg.conversationId });
    } else {
      if (!fresh) conv.unread += 1;
      showChatToast({
        title: conv.kind === "group" ? `${chatFirstName(msg.senderId)} in ${chatConvTitle(conv)}` : chatPerson(msg.senderId).name,
        text: msg.body,
        avatarHtml: chatAvatarHtml(msg.senderId),
        onClick: () => openMiniChat(msg.conversationId),
      });
    }
  }
  renderChatEverywhere({ scrollTo: msg.conversationId });
}

function onLiveChatMessageUpdate(row) {
  const msg = chatMessageFromRow(row);
  const cached = chat.messages.get(msg.conversationId)?.list.find(m => m.id === msg.id);
  if (cached) Object.assign(cached, msg);
  const conv = chat.convs.get(msg.conversationId);
  if (conv && conv.lastSenderId === msg.senderId && cached === chat.messages.get(msg.conversationId)?.list.at(-1)) {
    conv.lastBody = msg.body;
    conv.lastDeleted = Boolean(msg.deletedAt);
  }
  renderChatEverywhere();
}

// ── Threads (shared by the page and the mini windows) ───────────────────────

function chatThreadShellHtml(id) {
  const conv = chat.convs.get(id);
  const placeholder = conv ? `Message ${conv.kind === "dm" ? chatFirstName(chatOtherMember(conv)) : chatConvTitle(conv)}` : "Message";
  return `<div class="chat-thread" data-conv="${id}">
    <div class="chat-scroll"><div class="chat-msgs"></div></div>
    <form class="chat-composer">
      <div class="chat-editing" hidden><span>Editing message</span><button type="button" class="notif-link chat-edit-cancel">Cancel</button></div>
      <div class="chat-composer-row">
        <textarea class="chat-input" rows="1" placeholder="${chatEsc(placeholder)}" aria-label="${chatEsc(placeholder)}"></textarea>
        <button type="submit" class="chat-send" aria-label="Send" title="Send (Enter)">${CHAT_ICONS.send}</button>
      </div>
    </form>
  </div>`;
}

/** Put a chat's thread into `host` (once), and fill it in. */
function mountChatThread(host, id) {
  if (host.querySelector(`.chat-thread[data-conv="${id}"]`)) return;
  host.innerHTML = chatThreadShellHtml(id);
  const thread = host.querySelector(".chat-thread");
  const input = thread.querySelector(".chat-input");
  input.value = chat.drafts.get(id) ?? "";
  autoSizeChatInput(input);

  thread.querySelector(".chat-scroll").addEventListener("scroll", e => {
    if (e.target.scrollTop < 60) loadEarlierChatMessages(id);
  }, { passive: true });

  input.addEventListener("input", () => {
    chat.drafts.set(id, input.value);
    autoSizeChatInput(input);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      thread.querySelector(".chat-composer").requestSubmit();
    } else if (e.key === "Escape" && chat.editing.has(id)) {
      e.stopPropagation();
      stopChatEdit(id);
    } else if (e.key === "ArrowUp" && !input.value) {
      // Up in an empty box edits your last message.
      const last = [...(chat.messages.get(id)?.list ?? [])].reverse().find(m => m.senderId === chat.me && !m.deletedAt && !m.pending && !m.failed);
      if (last) { e.preventDefault(); startChatEdit(id, last.id); }
    }
  });
  thread.querySelector(".chat-composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    const editingId = chat.editing.get(id);
    if (editingId) {
      saveChatEdit(id, editingId, text);
      stopChatEdit(id);
      return;
    }
    input.value = "";
    chat.drafts.delete(id);
    autoSizeChatInput(input);
    syncAllChatInputs(id, thread);
    sendChatMessage(id, text);
  });
  thread.querySelector(".chat-edit-cancel").addEventListener("click", () => stopChatEdit(id));
  thread.querySelector(".chat-msgs").addEventListener("click", e => {
    const btn = e.target.closest("[data-msg-action]");
    if (!btn) return;
    const messageId = btn.closest("[data-msg]")?.dataset.msg;
    if (btn.dataset.msgAction === "edit") startChatEdit(id, messageId);
    if (btn.dataset.msgAction === "delete") deleteChatMessage(id, messageId);
    if (btn.dataset.msgAction === "retry") retryChatMessage(id, messageId);
  });

  ensureChatMessages(id).then(() => renderChatThreads(id, { toBottom: true }));
  renderChatThreads(id, { toBottom: true });
}

/** The same chat open in two places: the box just sent from is emptied in both. */
function syncAllChatInputs(id, except) {
  document.querySelectorAll(`.chat-thread[data-conv="${id}"]`).forEach(t => {
    if (t === except) return;
    const input = t.querySelector(".chat-input");
    input.value = chat.drafts.get(id) ?? "";
    autoSizeChatInput(input);
  });
}

function autoSizeChatInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
}

function startChatEdit(id, messageId) {
  const msg = chat.messages.get(id)?.list.find(m => m.id === messageId);
  if (!msg) return;
  chat.editing.set(id, messageId);
  document.querySelectorAll(`.chat-thread[data-conv="${id}"]`).forEach(t => {
    t.querySelector(".chat-editing").hidden = false;
    const input = t.querySelector(".chat-input");
    input.value = msg.body;
    autoSizeChatInput(input);
    input.focus();
  });
}

function stopChatEdit(id) {
  chat.editing.delete(id);
  document.querySelectorAll(`.chat-thread[data-conv="${id}"]`).forEach(t => {
    t.querySelector(".chat-editing").hidden = true;
    const input = t.querySelector(".chat-input");
    input.value = chat.drafts.get(id) ?? "";
    autoSizeChatInput(input);
  });
}

function chatDayLabel(at) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function chatMessagesHtml(id, { compact = false } = {}) {
  const cache = chat.messages.get(id);
  const conv = chat.convs.get(id);
  if (!cache || (cache.loading && !cache.list.length)) return `<div class="chat-thread-note">Loading…</div>`;
  if (!cache.list.length) {
    const who = conv?.kind === "dm" ? chatPerson(chatOtherMember(conv)).name : "the group";
    return `<div class="chat-thread-empty">${conv ? chatConvAvatarHtml(conv, "lg") : ""}<p>This is the start of your chat with ${chatEsc(who)}.</p></div>`;
  }
  let html = cache.all ? "" : `<div class="chat-thread-note">${cache.loading ? "Loading earlier messages…" : "Scroll up for earlier messages"}</div>`;
  let day = "";
  let prev = null;
  for (const m of cache.list) {
    const label = chatDayLabel(m.createdAt);
    if (label !== day) {
      html += `<div class="chat-day"><span>${chatEsc(label)}</span></div>`;
      day = label;
      prev = null;
    }
    const mine = m.senderId === chat.me;
    const grouped = prev && prev.senderId === m.senderId && new Date(m.createdAt) - new Date(prev.createdAt) < CHAT_GROUP_GAP_MS;
    const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const showName = !mine && !grouped && (conv?.kind === "group" || !compact);
    const status = m.failed
      ? `<button type="button" class="chat-msg-failed" data-msg-action="retry">Not sent · Retry</button>`
      : m.pending ? `<span class="chat-msg-pending">Sending…</span>` : "";
    const actions = mine && !m.deletedAt && !m.pending && !m.failed
      ? `<span class="chat-msg-actions"><button type="button" data-msg-action="edit" title="Edit">Edit</button><button type="button" data-msg-action="delete" title="Delete">Delete</button></span>`
      : "";
    html += `<div class="chat-msg${mine ? " is-mine" : ""}${grouped ? " is-grouped" : ""}${m.deletedAt ? " is-deleted" : ""}" data-msg="${m.id}">
      ${mine ? "" : `<div class="chat-msg-avatar">${grouped ? "" : chatAvatarHtml(m.senderId, "sm")}</div>`}
      <div class="chat-msg-main">
        ${showName ? `<div class="chat-msg-name">${chatEsc(chatPerson(m.senderId).name)}</div>` : ""}
        <div class="chat-msg-line">
          ${actions}
          <div class="chat-bubble" title="${chatEsc(new Date(m.createdAt).toLocaleString())}">${m.deletedAt ? "Message deleted" : chatBodyHtml(m.body)}</div>
        </div>
        ${grouped && !status ? "" : `<div class="chat-msg-meta">${status || `${time}${m.editedAt && !m.deletedAt ? " · edited" : ""}`}</div>`}
      </div>
    </div>`;
    prev = m;
  }
  return html;
}

/** Redraw every open thread of this chat. */
function renderChatThreads(id, { toBottom = false, keepScroll = false } = {}) {
  document.querySelectorAll(`.chat-thread[data-conv="${id}"]`).forEach(thread => {
    const scroll = thread.querySelector(".chat-scroll");
    const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    const fromBottom = scroll.scrollHeight - scroll.scrollTop;
    thread.querySelector(".chat-msgs").innerHTML = chatMessagesHtml(id, { compact: Boolean(thread.closest(".chat-mini")) });
    if (keepScroll) scroll.scrollTop = scroll.scrollHeight - fromBottom;
    else if (toBottom || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  });
}

// ── Messages page ────────────────────────────────────────────────────────────

function chatListRowHtml(conv) {
  const active = conv.id === chat.activeId && getCurrentAppView() === "messages";
  return `<button type="button" class="chat-row${conv.unread ? " is-unread" : ""}${active ? " is-active" : ""}" data-open-conv="${conv.id}">
    ${chatConvAvatarHtml(conv)}
    <span class="chat-row-body">
      <span class="chat-row-top"><span class="chat-row-name">${chatEsc(chatConvTitle(conv))}</span><span class="chat-row-time">${chatListTime(conv.lastMessageAt)}</span></span>
      <span class="chat-row-bottom"><span class="chat-row-snippet">${chatEsc(chatSnippet(conv))}</span>${conv.unread ? `<span class="chat-count">${conv.unread > 99 ? "99+" : conv.unread}</span>` : ""}</span>
    </span>
  </button>`;
}

function renderChatList() {
  const list = document.getElementById("chatList");
  if (!list) return;
  if (!chat.ready) { list.innerHTML = `<div class="chat-list-note">Loading…</div>`; return; }
  const q = chat.search.trim().toLowerCase();
  const convs = sortedChatConvs().filter(c => !q || chatConvTitle(c).toLowerCase().includes(q)
    || c.memberIds.some(id => chatPerson(id).name.toLowerCase().includes(q)));
  const dms = convs.filter(c => c.kind === "dm");
  const groups = convs.filter(c => c.kind === "group");
  // Searching: teammates you haven't messaged yet, to start one.
  const dmWith = new Set([...chat.convs.values()].filter(c => c.kind === "dm").map(chatOtherMember));
  const people = q ? chatTeammates().filter(p => !dmWith.has(p.id) && (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))) : [];

  let html = "";
  if (dms.length) html += `<div class="chat-list-group">Direct messages</div>${dms.map(chatListRowHtml).join("")}`;
  if (groups.length) html += `<div class="chat-list-group">Groups</div>${groups.map(chatListRowHtml).join("")}`;
  if (people.length) {
    html += `<div class="chat-list-group">People</div>` + people.map(p => `<button type="button" class="chat-row" data-start-dm="${p.id}">
      ${chatAvatarHtml(p.id)}<span class="chat-row-body"><span class="chat-row-top"><span class="chat-row-name">${chatEsc(p.name)}</span></span><span class="chat-row-bottom"><span class="chat-row-snippet">${chatEsc(p.email)}</span></span></span>
    </button>`).join("");
  }
  if (!html) {
    html = q
      ? `<div class="chat-list-note">No chats or people match “${chatEsc(chat.search.trim())}”.</div>`
      : `<div class="chat-list-note">No chats yet. Start one with <strong>New chat</strong>.</div>`;
  }
  list.innerHTML = html;
}

function renderChatMain() {
  const main = document.getElementById("chatMain");
  if (!main) return;
  const conv = chat.convs.get(chat.activeId);
  if (!conv) {
    main.dataset.conv = "";
    const teammates = chatTeammates().length;
    main.innerHTML = `<div class="chat-main-empty">${CHAT_ICONS.chat}
      <h2>${chat.ready && !chat.convs.size ? "No chats yet" : "Pick a chat"}</h2>
      <p>${!chat.ready ? "Loading…" : teammates ? "Choose one on the left, or start a new one." : "No one else is on the team yet. Once teammates have accounts, you can message them here."}</p>
      ${chat.ready && teammates ? `<button type="button" class="btn btn-primary" data-chat-new>${CHAT_ICONS.plus}<span>New chat</span></button>` : ""}
    </div>`;
    return;
  }
  if (main.dataset.conv !== conv.id) {
    main.dataset.conv = conv.id;
    main.innerHTML = `<header class="chat-main-head">
        <button type="button" class="btn btn-icon chat-back-btn" data-chat-back aria-label="All chats" title="All chats">‹</button>
        <span class="chat-main-avatar"></span>
        <div class="chat-main-titles"><h2 class="chat-main-title"></h2><div class="chat-main-sub"></div></div>
        <div class="chat-main-actions">
          ${conv.kind === "group" ? `<button type="button" class="btn btn-icon" data-chat-people title="People" aria-label="People">${CHAT_ICONS.group}</button>` : ""}
          <button type="button" class="btn btn-icon" data-chat-popout title="Open in a small window" aria-label="Open in a small window">${CHAT_ICONS.popout}</button>
        </div>
      </header>
      <div class="chat-main-thread"></div>`;
    mountChatThread(main.querySelector(".chat-main-thread"), conv.id);
  }
  main.querySelector(".chat-main-avatar").innerHTML = chatConvAvatarHtml(conv);
  main.querySelector(".chat-main-title").textContent = chatConvTitle(conv);
  main.querySelector(".chat-main-sub").textContent = chatConvSubtitle(conv);
}

function openChatOnPage(id) {
  chat.activeId = id;
  if (getCurrentAppView() !== "messages") switchAppView("messages");
  else renderMessagesPage();
  markChatRead(id);
  setTimeout(() => document.querySelector("#chatMain .chat-input")?.focus(), 0);
}

/** On entering the Messages page (js/app-shell.js). */
function renderMessagesPage() {
  // Wide enough for both sides: the latest chat opens. (On a phone, the list shows first.)
  if (!chat.activeId && chat.ready && window.matchMedia("(min-width: 761px)").matches) chat.activeId = sortedChatConvs()[0]?.id ?? null;
  renderChatList();
  renderChatMain();
  if (chat.activeId) markChatRead(chat.activeId);
}

// ── Group members popover ───────────────────────────────────────────────────

function openChatPeoplePopover(anchor) {
  closeChatPeoplePopover();
  const conv = chat.convs.get(chat.activeId);
  if (!conv || conv.kind !== "group") return;
  const pop = document.createElement("div");
  pop.className = "header-menu-dropdown chat-people-pop";
  pop.id = "chatPeoplePop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "People in this group");
  pop.innerHTML = `<div class="notif-dropdown-head"><span class="notif-dropdown-title">${conv.memberIds.length} people</span></div>
    <ul class="chat-people-list">${conv.memberIds.map(id => `<li>${chatAvatarHtml(id, "sm")}<span>${chatEsc(chatPerson(id).name)}${id === chat.me ? " (you)" : ""}</span></li>`).join("")}</ul>
    <div class="chat-people-actions">
      <button type="button" class="header-menu-item" data-pop="add">${CHAT_ICONS.plus}<span>Add people</span></button>
      <button type="button" class="header-menu-item" data-pop="rename"><span>Rename group</span></button>
      <button type="button" class="header-menu-item chat-danger" data-pop="leave"><span>Leave group</span></button>
    </div>`;
  anchor.closest(".chat-main-actions").append(pop);
  pop.addEventListener("click", async e => {
    const action = e.target.closest("[data-pop]")?.dataset.pop;
    if (!action) return;
    closeChatPeoplePopover();
    try {
      if (action === "add") openNewChatDialog({ addTo: conv.id });
      if (action === "rename") {
        const title = window.prompt("Group name", conv.title || chatConvTitle(conv));
        if (title === null) return;
        const { error } = await requireClient().rpc("chat_rename", { conv: conv.id, new_title: title });
        if (error) throw new Error(error.message);
        conv.title = title.trim();
        renderChatEverywhere();
      }
      if (action === "leave") {
        if (!window.confirm(`Leave “${chatConvTitle(conv)}”? You won't see its messages any more.`)) return;
        const { error } = await requireClient().from("chat_members").delete().eq("conversation_id", conv.id).eq("user_id", chat.me);
        if (error) throw new Error(error.message);
        chat.convs.delete(conv.id);
        chat.mini = chat.mini.filter(w => w.id !== conv.id);
        chat.activeId = null;
        renderChatEverywhere();
      }
    } catch (err) {
      showIndicator(err.message, "error");
    }
  });
}

function closeChatPeoplePopover() {
  document.getElementById("chatPeoplePop")?.remove();
}

// ── New chat / add people dialog ─────────────────────────────────────────────

function openNewChatDialog({ addTo = null } = {}) {
  const overlay = document.getElementById("chatNewOverlay");
  if (!overlay) return;
  const conv = addTo ? chat.convs.get(addTo) : null;
  const picked = new Set();
  const already = new Set(conv?.memberIds ?? []);
  const people = chatTeammates().filter(p => !already.has(p.id));
  const title = overlay.querySelector("#chatNewTitle");
  const search = overlay.querySelector("#chatNewSearch");
  const list = overlay.querySelector("#chatNewList");
  const nameRow = overlay.querySelector("#chatNewNameRow");
  const nameInput = overlay.querySelector("#chatNewName");
  const submit = overlay.querySelector("#chatNewSubmit");
  const msg = overlay.querySelector("#chatNewMessage");

  title.textContent = conv ? `Add people to ${chatConvTitle(conv)}` : "New chat";
  search.value = "";
  nameInput.value = "";
  msg.textContent = "";

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = people.filter(p => !q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
    list.innerHTML = !people.length
      ? `<li class="chat-list-note">${conv ? "Everyone on the team is already in this group." : "No one else is on the team yet. Once teammates have accounts, they'll be here."}</li>`
      : !shown.length ? `<li class="chat-list-note">No one matches.</li>`
      : shown.map(p => `<li><label class="chat-pick">
          <input type="checkbox" value="${p.id}"${picked.has(p.id) ? " checked" : ""} />
          ${chatAvatarHtml(p.id)}
          <span class="chat-pick-body"><span class="chat-pick-name">${chatEsc(p.name)}</span><span class="chat-pick-email">${chatEsc(p.email)}</span></span>
        </label></li>`).join("");
    nameRow.hidden = Boolean(conv) || picked.size < 2;
    submit.disabled = picked.size === 0;
    submit.textContent = conv ? (picked.size > 1 ? `Add ${picked.size} people` : "Add") : picked.size > 1 ? "Create group" : "Start chat";
  };

  search.oninput = draw;
  list.onchange = e => {
    if (e.target.type !== "checkbox") return;
    if (e.target.checked) picked.add(e.target.value);
    else picked.delete(e.target.value);
    draw();
  };
  submit.onclick = async () => {
    if (!picked.size) return;
    submit.disabled = true;
    msg.textContent = "";
    try {
      let id;
      if (conv) {
        const { error } = await requireClient().rpc("chat_add_members", { conv: conv.id, member_ids: [...picked] });
        if (error) throw new Error(error.message);
        await loadChatInbox();
        id = conv.id;
      } else if (picked.size === 1) {
        id = await startDirectMessage([...picked][0]);
      } else {
        id = await createGroupChat(nameInput.value, [...picked]);
      }
      closeNewChatDialog();
      renderChatEverywhere();
      if (getCurrentAppView() === "messages") openChatOnPage(id);
      else openMiniChat(id);
    } catch (err) {
      msg.textContent = err.message;
      submit.disabled = false;
    }
  };

  draw();
  overlay.classList.add("open");
  setTimeout(() => search.focus(), 0);
}

function closeNewChatDialog() {
  document.getElementById("chatNewOverlay")?.classList.remove("open");
}

// ── Mini windows ─────────────────────────────────────────────────────────────

function saveMiniChats() {
  try { localStorage.setItem(CHAT_MINI_KEY, JSON.stringify(chat.mini)); } catch { /* storage off */ }
}

function restoreMiniChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_MINI_KEY) || "[]");
    chat.mini = Array.isArray(saved) ? saved.filter(w => w && chat.convs.has(w.id)).slice(-CHAT_MINI_MAX) : [];
  } catch {
    chat.mini = [];
  }
}

function openMiniChat(id) {
  closeChatDropdown();
  const existing = chat.mini.find(w => w.id === id);
  if (existing) existing.min = false;
  else {
    chat.mini.push({ id, min: false });
    if (chat.mini.length > CHAT_MINI_MAX) chat.mini.shift();
  }
  saveMiniChats();
  renderChatDock();
  markChatRead(id);
  setTimeout(() => document.querySelector(`.chat-mini[data-mini="${id}"] .chat-input`)?.focus(), 0);
}

function closeMiniChat(id) {
  chat.mini = chat.mini.filter(w => w.id !== id);
  saveMiniChats();
  renderChatDock();
}

function toggleMiniChat(id) {
  const w = chat.mini.find(x => x.id === id);
  if (!w) return;
  w.min = !w.min;
  saveMiniChats();
  renderChatDock();
  if (!w.min) markChatRead(id);
}

function renderChatDock() {
  const dock = document.getElementById("chatDock");
  if (!dock) return;
  const wanted = chat.ready ? chat.mini.filter(w => chat.convs.has(w.id)) : [];
  // Windows no longer open go; the rest keep their thread (and what's typed).
  dock.querySelectorAll(".chat-mini").forEach(el => {
    if (!wanted.some(w => w.id === el.dataset.mini)) el.remove();
  });
  wanted.forEach((w, i) => {
    const conv = chat.convs.get(w.id);
    let el = dock.querySelector(`.chat-mini[data-mini="${w.id}"]`);
    if (!el) {
      el = document.createElement("section");
      el.className = "chat-mini";
      el.dataset.mini = w.id;
      el.setAttribute("aria-label", "Chat");
      el.innerHTML = `<header class="chat-mini-head" data-mini-toggle>
          <span class="chat-mini-avatar"></span>
          <span class="chat-mini-title"></span>
          <span class="chat-count chat-mini-count" hidden></span>
          <button type="button" class="chat-mini-btn" data-mini-act="min" aria-label="Minimise" title="Minimise">${CHAT_ICONS.minimize}</button>
          <button type="button" class="chat-mini-btn" data-mini-act="expand" aria-label="Open in Messages" title="Open in Messages">${CHAT_ICONS.expand}</button>
          <button type="button" class="chat-mini-btn" data-mini-act="close" aria-label="Close" title="Close">✕</button>
        </header>
        <div class="chat-mini-body"></div>`;
      dock.append(el);
      mountChatThread(el.querySelector(".chat-mini-body"), w.id);
    }
    el.style.order = String(-i); // newest nearest the corner
    el.classList.toggle("is-min", w.min);
    el.querySelector(".chat-mini-avatar").innerHTML = chatConvAvatarHtml(conv, "sm");
    el.querySelector(".chat-mini-title").textContent = chatConvTitle(conv);
    const count = el.querySelector(".chat-mini-count");
    count.hidden = !conv.unread;
    count.textContent = conv.unread > 99 ? "99+" : String(conv.unread);
    el.querySelector('[data-mini-act="min"]').setAttribute("aria-label", w.min ? "Open" : "Minimise");
  });
  dock.hidden = !wanted.length;
  // The messages bottom right move over beside the windows.
  document.documentElement.style.setProperty("--chat-dock-w", `${wanted.length ? dock.offsetWidth + 12 : 0}px`);
}

// ── Header icon and dropdown ─────────────────────────────────────────────────

function renderChatChrome() {
  const total = chatTotalUnread();
  const badge = document.getElementById("chatBadge");
  if (badge) {
    badge.hidden = !total;
    badge.textContent = total > 99 ? "99+" : String(total);
  }
  document.getElementById("chatBtn")?.setAttribute("aria-label", total ? `Messages, ${total} unread` : "Messages");
  const navCount = document.getElementById("navMessagesCount");
  if (navCount) {
    navCount.hidden = !total;
    navCount.textContent = total > 99 ? "99+" : String(total);
  }
  if (!document.getElementById("chatDropdown")?.hidden) renderChatDropdown();
  // Unread counts on the page and the windows.
  if (getCurrentAppView() === "messages") renderChatList();
  if (getCurrentAppView() === "home" && typeof renderHomeInbox === "function") renderHomeInbox();
  chat.mini.forEach(w => {
    const conv = chat.convs.get(w.id);
    const count = document.querySelector(`.chat-mini[data-mini="${w.id}"] .chat-mini-count`);
    if (!conv || !count) return;
    count.hidden = !conv.unread;
    count.textContent = String(conv.unread);
  });
}

function renderChatDropdown() {
  const list = document.getElementById("chatDropdownList");
  if (!list) return;
  if (!chat.ready) { list.innerHTML = `<li class="notif-empty">Loading…</li>`; return; }
  const convs = sortedChatConvs().slice(0, CHAT_DROPDOWN_COUNT);
  list.innerHTML = convs.length
    ? convs.map(c => `<li>${chatListRowHtml(c).replace("is-active", "")}</li>`).join("")
    : `<li class="notif-empty">No chats yet</li>`;
}

function openChatDropdown() {
  const dropdown = document.getElementById("chatDropdown");
  if (!dropdown) return;
  closeHeaderMenu?.();
  closeNotificationDropdown?.();
  renderChatDropdown();
  dropdown.hidden = false;
  document.getElementById("chatBtn")?.setAttribute("aria-expanded", "true");
}

function closeChatDropdown() {
  const dropdown = document.getElementById("chatDropdown");
  if (!dropdown || dropdown.hidden) return;
  dropdown.hidden = true;
  document.getElementById("chatBtn")?.setAttribute("aria-expanded", "false");
}

function renderChatEverywhere({ scrollTo = null } = {}) {
  renderChatChrome();
  if (getCurrentAppView() === "messages") {
    renderChatList();
    renderChatMain();
  }
  renderChatDock();
  const ids = new Set([chat.activeId, ...chat.mini.map(w => w.id)].filter(Boolean));
  ids.forEach(id => renderChatThreads(id, { toBottom: id === scrollTo && chat.messages.get(id)?.list.at(-1)?.senderId === chat.me }));
}

// ── Start ────────────────────────────────────────────────────────────────────

/** Wire up the controls; called once at boot (js/main.js). */
function initChat() {
  const btn = document.getElementById("chatBtn");
  const dropdown = document.getElementById("chatDropdown");
  btn?.addEventListener("click", e => {
    e.stopPropagation();
    if (dropdown.hidden) openChatDropdown();
    else closeChatDropdown();
  });
  document.getElementById("headerMenuBtn")?.addEventListener("click", closeChatDropdown);
  document.getElementById("notifBtn")?.addEventListener("click", closeChatDropdown);
  document.getElementById("chatDropdownNew")?.addEventListener("click", () => { closeChatDropdown(); openNewChatDialog(); });
  document.getElementById("chatDropdownAll")?.addEventListener("click", () => { closeChatDropdown(); switchAppView("messages"); });
  dropdown?.addEventListener("click", e => {
    const row = e.target.closest("[data-open-conv]");
    if (row) openMiniChat(row.dataset.openConv);
  });
  document.addEventListener("click", e => {
    if (dropdown && !dropdown.hidden && !dropdown.contains(e.target) && !btn.contains(e.target)) closeChatDropdown();
    const pop = document.getElementById("chatPeoplePop");
    if (pop && !pop.contains(e.target) && !e.target.closest("[data-chat-people]")) closeChatPeoplePopover();
  });

  // The Messages page.
  document.getElementById("chatNewBtn")?.addEventListener("click", () => openNewChatDialog());
  document.getElementById("chatSearch")?.addEventListener("input", e => {
    chat.search = e.target.value;
    renderChatList();
  });
  document.getElementById("chatList")?.addEventListener("click", async e => {
    const row = e.target.closest("[data-open-conv]");
    if (row) { openChatOnPage(row.dataset.openConv); return; }
    const person = e.target.closest("[data-start-dm]");
    if (!person) return;
    try {
      const id = await startDirectMessage(person.dataset.startDm);
      chat.search = "";
      document.getElementById("chatSearch").value = "";
      openChatOnPage(id);
    } catch (err) {
      showIndicator(err.message, "error");
    }
  });
  document.getElementById("chatMain")?.addEventListener("click", e => {
    if (e.target.closest("[data-chat-new]")) openNewChatDialog();
    if (e.target.closest("[data-chat-back]")) {
      chat.activeId = null;
      renderMessagesPage();
      return;
    }
    if (e.target.closest("[data-chat-popout]") && chat.activeId) openMiniChat(chat.activeId);
    const people = e.target.closest("[data-chat-people]");
    if (people) {
      if (document.getElementById("chatPeoplePop")) closeChatPeoplePopover();
      else openChatPeoplePopover(people);
    }
  });

  // Mini windows.
  document.getElementById("chatDock")?.addEventListener("click", e => {
    const win = e.target.closest(".chat-mini");
    if (!win) return;
    const act = e.target.closest("[data-mini-act]")?.dataset.miniAct;
    const id = win.dataset.mini;
    if (act === "close") closeMiniChat(id);
    else if (act === "expand") { closeMiniChat(id); openChatOnPage(id); }
    else if (act === "min" || (e.target.closest("[data-mini-toggle]") && !act)) toggleMiniChat(id);
  });
  // Clicking into an open window reads it.
  document.getElementById("chatDock")?.addEventListener("focusin", e => {
    const id = e.target.closest(".chat-mini")?.dataset.mini;
    if (id) markChatRead(id);
  });

  // New chat dialog.
  document.getElementById("chatNewClose")?.addEventListener("click", closeNewChatDialog);
  document.getElementById("chatNewCancel")?.addEventListener("click", closeNewChatDialog);
  document.getElementById("chatNewOverlay")?.addEventListener("click", e => { if (e.target.id === "chatNewOverlay") closeNewChatDialog(); });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (document.getElementById("chatNewOverlay")?.classList.contains("open")) { closeNewChatDialog(); return; }
    if (document.getElementById("chatPeoplePop")) { closeChatPeoplePopover(); return; }
    closeChatDropdown();
  });

  // Back to this tab: what's on screen counts as read.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && chat.ready) markShowingChatsRead();
  });

  renderChatChrome();
}

/** Load the chats and go live; after sign-in (js/main.js). */
async function startChat() {
  if (chat.started || !supabaseClient) return;
  chat.started = true;
  try {
    const { data } = await supabaseClient.auth.getSession();
    chat.me = data?.session?.user?.id ?? null;
    if (!chat.me) return;
    await loadChatPeople();
    await loadChatInbox();
    chat.ready = true;
    restoreMiniChats();
    subscribeChat();
    renderChatEverywhere();
    markShowingChatsRead();
  } catch (err) {
    chat.started = false;
    showIndicator(`Messages couldn't load: ${err.message}`, "error");
  }
}
