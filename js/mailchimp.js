/**
 * Mailchimp — Email tasks linked to Mailchimp campaigns.
 *
 * The app never talks to Mailchimp directly: everything goes through the
 * `mailchimp` Supabase Edge Function (supabase/functions/mailchimp), which
 * holds the API key. Here:
 *
 *   - calling that function, and caching what it says about each campaign
 *   - syncing: on load, on Refresh, every few minutes while open, and when
 *     the tab comes back into view — and ticking off any linked task whose
 *     campaign has been sent (once; untick it by hand and it stays unticked)
 *   - the Mailchimp strip under each Email task in the side pane:
 *       not linked  Create in Mailchimp · Link existing
 *       linked      status, subject · Edit · Open in Mailchimp · Unlink · Delete
 *   - the create / edit dialog and the link picker
 *
 * Mailchimp stays in charge of the email itself: its design is done in
 * Mailchimp's editor ("Open in Mailchimp"), and sent campaigns are never
 * deleted from here.
 */

const MC_FUNCTION = "mailchimp";
const MC_SYNC_EVERY_MS = 5 * 60 * 1000;

/** campaign id → summary from the function (or { id, missing: true }). */
const mcCampaigns = new Map();

/** null until first checked; then true, or false with `mcError` saying why. */
let mcConnected = null;
let mcError = "";
let mcAccountName = "";
let mcLastSync = 0;
let mcSyncing = null;

// ── Calling the function ─────────────────────────────────────────────────────

async function callMailchimp(action, params = {}) {
  if (!supabaseClient) throw new Error("Supabase isn't configured.");
  const { data, error } = await supabaseClient.functions.invoke(MC_FUNCTION, {
    body: { action, ...params },
  });
  if (error) {
    // The function's own message, when it sent one.
    let message = error.message || "Couldn't reach Mailchimp.";
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    if (/Failed to send a request|not found/i.test(message) && !/Mailchimp/.test(message)) {
      message = "The Mailchimp helper isn't set up yet.";
    }
    const err = new Error(message);
    err.status = error.context?.status;
    throw err;
  }
  return data?.data;
}

function isMailchimpConnected() {
  return mcConnected === true;
}

function getMcCampaign(campaignId) {
  return mcCampaigns.get(campaignId) ?? null;
}

/** The Mailchimp campaign linked to a task, as last fetched — or null. */
function getTaskMcCampaign(taskId) {
  const link = getTaskLink(taskId);
  return link ? getMcCampaign(link.campaignId) : null;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Check the connection, refresh every linked campaign, and tick off tasks
 * whose campaign has been sent. Overlapping calls share one run.
 */
function syncMailchimp() {
  if (!mcSyncing) {
    mcSyncing = runMailchimpSync().finally(() => { mcSyncing = null; });
  }
  return mcSyncing;
}

async function runMailchimpSync() {
  try {
    const status = await callMailchimp("status");
    mcConnected = true;
    mcError = "";
    mcAccountName = status?.accountName ?? "";
  } catch (err) {
    mcConnected = false;
    mcError = err.message;
    refreshTaskViews();
    return;
  }

  const ids = [...new Set([...getAllTaskLinks().values()].map(l => l.campaignId))];
  if (ids.length) {
    try {
      const found = await callMailchimp("get", { ids });
      Object.values(found ?? {}).forEach(c => mcCampaigns.set(c.id, c));
    } catch (err) {
      mcError = err.message;
    }
  }
  mcLastSync = Date.now();

  const ticked = await autoCompleteSentTasks();
  refreshTaskViews();
  if (ticked > 0) {
    showIndicator(ticked === 1
      ? "1 email marked done — it was sent in Mailchimp"
      : `${ticked} emails marked done — they were sent in Mailchimp`, "success");
  }
}

/** Tick off each linked task whose campaign has gone out — once per link. */
async function autoCompleteSentTasks() {
  let ticked = 0;
  for (const [taskId, link] of getAllTaskLinks()) {
    if (link.sentSeen) continue;
    if (getMcCampaign(link.campaignId)?.status !== "sent") continue;
    try {
      if (!isTaskComplete(taskId)) {
        await setTaskComplete(taskId, true);
        ticked += 1;
      }
      await markTaskLinkSentSeen(taskId);
    } catch {
      /* try again next sync */
    }
  }
  return ticked;
}

function initMailchimpSync() {
  setInterval(() => {
    if (document.visibilityState === "visible" && getAllTaskLinks().size) syncMailchimp();
  }, MC_SYNC_EVERY_MS);
  // Coming back to the tab is when a send is most likely to have happened.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - mcLastSync > 60 * 1000) syncMailchimp();
  });
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** "Thu, Nov 26, 9:00 AM" in local time. */
function formatMcDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** { label, tone } for a campaign's state; tone picks the badge colour. */
function describeMcStatus(campaign) {
  if (!campaign) return { label: "Checking Mailchimp…", tone: "unknown" };
  if (campaign.missing) return { label: "Not found in Mailchimp", tone: "missing" };
  switch (campaign.status) {
    case "save":     return { label: "Draft", tone: "draft" };
    case "paused":   return { label: "Paused", tone: "draft" };
    case "schedule": return { label: `Scheduled · ${formatMcDateTime(campaign.sendTime)}`, tone: "scheduled" };
    case "sending":  return { label: "Sending now", tone: "sending" };
    case "sent":     return { label: `Sent · ${formatMcDateTime(campaign.sendTime)}`, tone: "sent" };
    default:         return { label: campaign.status, tone: "unknown" };
  }
}

/** A small Mailchimp mark for task rows in cards — just the state, by colour. */
function createMcTaskBadge(taskId) {
  const link = getTaskLink(taskId);
  if (!link) return null;
  const { label, tone } = describeMcStatus(getMcCampaign(link.campaignId));
  const badge = document.createElement("span");
  badge.className = "mc-badge";
  badge.dataset.tone = tone;
  badge.textContent = "MC";
  badge.title = `Mailchimp: ${label}`;
  return badge;
}

function mcButton(label, onClick, extraClass = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mc-btn" + (extraClass ? ` ${extraClass}` : "");
  btn.textContent = label;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

// ── The strip under an Email task ────────────────────────────────────────────

/**
 * `task` is the app task; `item` the campaign or trade show it belongs to,
 * which names the new Mailchimp campaign.
 */
function createMailchimpStrip(task, item) {
  const strip = document.createElement("div");
  strip.className = "mc-strip";
  strip.dataset.taskId = task.id;

  const logo = document.createElement("span");
  logo.className = "mc-logo";
  logo.textContent = "Mailchimp";
  strip.appendChild(logo);

  const link = getTaskLink(task.id);

  if (!link) {
    if (mcConnected === false) {
      const note = document.createElement("span");
      note.className = "mc-note";
      note.textContent = mcError || "Not connected.";
      note.title = mcError;
      strip.appendChild(note);
      return strip;
    }
    const actions = document.createElement("span");
    actions.className = "mc-actions";
    actions.append(
      mcButton("Create in Mailchimp", () => openMcForm({ mode: "create", task, item })),
      mcButton("Link existing", () => openMcLinkPicker(task)),
    );
    strip.appendChild(actions);
    return strip;
  }

  const campaign = getMcCampaign(link.campaignId);
  const { label, tone } = describeMcStatus(campaign);

  const info = document.createElement("span");
  info.className = "mc-info";
  const badge = document.createElement("span");
  badge.className = "mc-status";
  badge.dataset.tone = tone;
  badge.textContent = label;
  info.appendChild(badge);
  if (campaign?.subject) {
    const subject = document.createElement("span");
    subject.className = "mc-subject";
    subject.textContent = campaign.subject;
    subject.title = `Subject: ${campaign.subject}`;
    info.appendChild(subject);
  }
  strip.appendChild(info);

  // Who it goes to: the audience, narrowed when a segment or tags are set.
  if (campaign && !campaign.missing && campaign.listName) {
    const to = document.createElement("span");
    to.className = "mc-recipients";
    const narrowed = campaign.targeting && campaign.targeting.kind !== "all";
    const count = Number.isFinite(campaign.recipientCount) && campaign.recipientCount !== null
      ? ` · ${campaign.recipientCount.toLocaleString()} recipients`
      : "";
    to.textContent = `To: ${campaign.listName}${narrowed ? " (segmented)" : ""}${count}`;
    if (narrowed && campaign.segmentText) to.title = campaign.segmentText;
    strip.appendChild(to);
  }

  const actions = document.createElement("span");
  actions.className = "mc-actions";
  const editable = campaign && !campaign.missing && !["sent", "sending"].includes(campaign.status);
  if (editable) actions.appendChild(mcButton("Edit", () => openMcForm({ mode: "edit", task, item, campaign })));
  if (campaign && !campaign.missing) {
    const open = document.createElement("a");
    open.className = "mc-btn";
    open.href = campaign.status === "sent" ? campaign.reportUrl : campaign.editUrl;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = campaign.status === "sent" ? "Report ↗" : "Open in Mailchimp ↗";
    open.addEventListener("click", e => e.stopPropagation());
    actions.appendChild(open);
  }
  actions.appendChild(mcButton("Unlink", () => unlinkTask(task)));
  if (editable) actions.appendChild(mcButton("Delete", () => deleteLinkedCampaign(task), "mc-btn--danger"));
  strip.appendChild(actions);

  return strip;
}

async function unlinkTask(task) {
  if (!confirm("Unlink this task from its Mailchimp campaign? The campaign stays in Mailchimp.")) return;
  try {
    await deleteTaskLinks([task.id]);
    refreshTaskViews();
    showIndicator("Unlinked from Mailchimp", "success");
  } catch (err) {
    showIndicator(err.message || "Could not unlink.", "error");
  }
}

async function deleteLinkedCampaign(task) {
  const campaign = getTaskMcCampaign(task.id);
  if (!campaign) return;
  const name = campaign.title || campaign.subject || "this campaign";
  const message = campaign.status === "schedule"
    ? `"${name}" is scheduled to send ${formatMcDateTime(campaign.sendTime)}.\n\nCancel the send and delete it from Mailchimp? This can't be undone.`
    : `Delete the draft "${name}" from Mailchimp? This can't be undone.`;
  if (!confirm(message)) return;
  try {
    await callMailchimp("delete", { id: campaign.id });
    mcCampaigns.delete(campaign.id);
    await deleteTaskLinks([task.id]);
    refreshTaskViews();
    showIndicator("Deleted from Mailchimp", "success");
  } catch (err) {
    showIndicator(err.message || "Could not delete in Mailchimp.", "error");
  }
}

/**
 * Before a campaign or trade show is deleted: offer to delete the Mailchimp
 * campaigns its tasks are linked to, if any haven't been sent. Resolves once
 * that's done (or declined); never blocks deleting the record itself.
 */
async function offerToDeleteLinkedCampaigns(tasks) {
  const unsent = tasks
    .map(task => getTaskMcCampaign(task.id))
    .filter(c => c && !c.missing && !["sent", "sending"].includes(c.status));
  if (unsent.length === 0) return;

  const scheduled = unsent.filter(c => c.status === "schedule").length;
  const what = unsent.length === 1 ? "the linked Mailchimp email" : `the ${unsent.length} linked Mailchimp emails`;
  const extra = scheduled ? `\n\n${scheduled === 1 ? "One is" : `${scheduled} are`} scheduled — deleting cancels the send.` : "";
  if (!confirm(`Also delete ${what} that ${unsent.length === 1 ? "hasn't" : "haven't"} been sent?${extra}\n\nOK deletes ${unsent.length === 1 ? "it" : "them"} from Mailchimp. Cancel keeps ${unsent.length === 1 ? "it" : "them"} there.`)) return;

  const failed = [];
  for (const c of unsent) {
    try {
      await callMailchimp("delete", { id: c.id });
      mcCampaigns.delete(c.id);
    } catch {
      failed.push(c.title || c.subject || c.id);
    }
  }
  if (failed.length) showIndicator(`Couldn't delete in Mailchimp: ${failed.join(", ")}`, "error");
}

// ── Create / edit dialog ─────────────────────────────────────────────────────

let mcFormState = null; // { mode, task, item, campaign }
let mcAudiences = null;

/** 12:00 AM … 11:45 PM — Mailchimp only schedules on the quarter hour. */
function fillMcTimeOptions() {
  const select = document.getElementById("mcFormSendClock");
  if (!select || select.options.length) return;
  for (let m = 0; m < 24 * 60; m += 15) {
    const h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, "0");
    const label = new Date(2000, 0, 1, h, m % 60).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    select.add(new Option(label, `${String(h).padStart(2, "0")}:${mm}`));
  }
}

function setMcFormMessage(text, type = "") {
  const el = document.getElementById("mcFormMessage");
  if (!el) return;
  el.textContent = text;
  el.className = "modal-footer-message" + (type ? ` ${type}` : "");
}

async function loadMcAudiences() {
  if (!mcAudiences) mcAudiences = await callMailchimp("audiences");
  return mcAudiences;
}

// ── Send to: whole audience, a segment, or tags ──────────────────────────────

const MC_SEND_TO = [
  { key: "all", label: "Entire audience" },
  { key: "segment", label: "Segment" },
  { key: "tags", label: "Tags" },
];

/** listId → { segments, tags }, each [{ id, name, members }]. */
const mcSegmentsCache = new Map();

/**
 * What the dialog has picked. `kind` "custom" means the campaign uses other
 * conditions set in Mailchimp; it's left alone unless something is picked.
 * `touched` says whether to send targeting on save at all.
 */
let mcSendTo = { kind: "all", segmentId: "", tagIds: new Set(), match: "any", touched: false };

async function loadMcSegments(listId) {
  if (!mcSegmentsCache.has(listId)) mcSegmentsCache.set(listId, await callMailchimp("segments", { listId }));
  return mcSegmentsCache.get(listId);
}

function fillMcSendToControls() {
  const row = document.getElementById("mcFormSendTo");
  if (row && !row.children.length) {
    row.replaceChildren(...MC_SEND_TO.map(option => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "form-toggle-btn";
      btn.dataset.value = option.key;
      btn.textContent = option.label;
      btn.addEventListener("click", () => {
        mcSendTo.kind = option.key;
        mcSendTo.touched = true;
        renderMcSendTo();
      });
      return btn;
    }));
  }
  const match = document.getElementById("mcFormTagMatch");
  if (match && !match.children.length) {
    match.replaceChildren(...["any", "all"].map(key => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "form-toggle-btn";
      btn.dataset.value = key;
      btn.textContent = key;
      btn.addEventListener("click", () => {
        mcSendTo.match = key;
        mcSendTo.touched = true;
        renderMcSendTo();
      });
      return btn;
    }));
  }
}

/** Start from what the campaign has now (or everyone, for a new one). */
function resetMcSendTo(targeting) {
  const t = targeting ?? { kind: "all" };
  mcSendTo = {
    kind: t.kind,
    segmentId: t.segmentId ? String(t.segmentId) : "",
    tagIds: new Set((t.tagIds ?? []).map(String)),
    match: t.match === "all" ? "all" : "any",
    touched: false,
  };
}

function renderMcSendTo() {
  const listId = document.getElementById("mcFormAudience")?.value ?? "";
  const data = mcSegmentsCache.get(listId);

  // A single tag picked in Mailchimp comes back as a "segment" — show it as
  // the tag it is.
  if (data && mcSendTo.kind === "segment" && data.tags.some(t => String(t.id) === mcSendTo.segmentId)) {
    mcSendTo = { ...mcSendTo, kind: "tags", tagIds: new Set([mcSendTo.segmentId]), segmentId: "" };
  }

  document.querySelectorAll("#mcFormSendTo .form-toggle-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.value === mcSendTo.kind);
  });
  document.querySelectorAll("#mcFormTagMatch .form-toggle-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.value === mcSendTo.match);
  });

  const segmentSelect = document.getElementById("mcFormSegment");
  const tagsWrap = document.getElementById("mcFormTagsWrap");
  const hint = document.getElementById("mcFormSendToHint");
  segmentSelect.hidden = mcSendTo.kind !== "segment";
  tagsWrap.hidden = mcSendTo.kind !== "tags";

  if (mcSendTo.kind === "custom") {
    hint.textContent = "Uses conditions set in Mailchimp. They're kept unless you pick an option here.";
    return;
  }
  if (!listId) {
    hint.textContent = "";
    return;
  }
  if (!data) {
    hint.textContent = mcSendTo.kind === "all" ? "" : "Loading segments and tags…";
    return;
  }

  if (mcSendTo.kind === "segment") {
    segmentSelect.replaceChildren(
      new Option(data.segments.length ? "Pick a segment" : "No saved segments in this audience", ""),
      ...data.segments.map(s => new Option(`${s.name} (${s.members.toLocaleString()} contacts)`, String(s.id))),
    );
    segmentSelect.value = mcSendTo.segmentId;
    const picked = data.segments.find(s => String(s.id) === mcSendTo.segmentId);
    hint.textContent = picked ? `${picked.members.toLocaleString()} contacts in this segment.` : "";
  } else if (mcSendTo.kind === "tags") {
    const list = document.getElementById("mcFormTags");
    if (data.tags.length === 0) {
      list.replaceChildren(Object.assign(document.createElement("span"), { className: "form-hint", textContent: "No tags in this audience yet." }));
    } else {
      list.replaceChildren(...data.tags.map(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "form-toggle-btn mc-tag-btn" + (mcSendTo.tagIds.has(String(tag.id)) ? " is-active" : "");
        btn.textContent = `${tag.name} · ${tag.members.toLocaleString()}`;
        btn.addEventListener("click", () => {
          const id = String(tag.id);
          if (mcSendTo.tagIds.has(id)) mcSendTo.tagIds.delete(id); else mcSendTo.tagIds.add(id);
          mcSendTo.touched = true;
          renderMcSendTo();
        });
        return btn;
      }));
    }
    const names = data.tags.filter(t => mcSendTo.tagIds.has(String(t.id))).map(t => t.name);
    hint.textContent = names.length
      ? `Contacts tagged ${names.join(mcSendTo.match === "all" ? " and " : " or ")}.`
      : "Pick one or more tags.";
  } else {
    const audience = (mcAudiences ?? []).find(a => a.id === listId);
    hint.textContent = audience ? `All ${audience.members.toLocaleString()} contacts.` : "";
  }
}

async function refreshMcSegmentsFor(listId, task) {
  if (!listId) return;
  renderMcSendTo();
  try {
    await loadMcSegments(listId);
  } catch (err) {
    if (mcFormState?.task === task) setMcFormMessage(err.message, "error");
  }
  if (mcFormState?.task === task) renderMcSendTo();
}

/** Targeting to send, or undefined to leave the campaign's as it is. */
function getMcTargeting() {
  switch (mcSendTo.kind) {
    case "segment": return { kind: "segment", segmentId: Number(mcSendTo.segmentId) };
    case "tags":    return { kind: "tags", tagIds: [...mcSendTo.tagIds].map(Number), match: mcSendTo.match };
    case "custom":  return undefined;
    default:        return { kind: "all" };
  }
}

function validateMcSendTo() {
  if (mcSendTo.kind === "segment" && !mcSendTo.segmentId) return "Pick a segment, or send to the entire audience.";
  if (mcSendTo.kind === "tags" && mcSendTo.tagIds.size === 0) return "Pick at least one tag, or send to the entire audience.";
  return "";
}

function syncMcScheduleFields() {
  const on = document.getElementById("mcFormSchedule")?.checked === true;
  const row = document.getElementById("mcFormSendRow");
  if (row) row.hidden = !on;
}

async function openMcForm({ mode, task, item, campaign = null }) {
  const overlay = document.getElementById("mcFormOverlay");
  if (!overlay) return;
  mcFormState = { mode, task, item, campaign };
  fillMcTimeOptions();
  fillMcSendToControls();
  resetMcSendTo(campaign?.targeting);
  renderMcSendTo();

  document.getElementById("mcFormTitle").textContent = mode === "create" ? "Create in Mailchimp" : "Edit Mailchimp campaign";
  document.getElementById("mcFormSaveBtn").textContent = mode === "create" ? "Create draft" : "Save";
  document.getElementById("mcFormTaskLabel").textContent = `${item.title} · ${task.label} · due ${formatTaskDate(task.dueDate)}`;

  const name = document.getElementById("mcFormName");
  const subject = document.getElementById("mcFormSubject");
  const preview = document.getElementById("mcFormPreview");
  name.value = campaign?.title ?? `${item.title} — ${task.label}`;
  subject.value = campaign?.subject ?? "";
  preview.value = campaign?.previewText ?? "";

  // Audience: picked when creating, changeable until it's sent. Moving an
  // existing campaign clears any segment or tag targeting set in Mailchimp.
  const audienceSelect = document.getElementById("mcFormAudience");
  document.getElementById("mcFormAudienceHint").hidden = mode === "create";

  // Send time: only once the campaign exists — Mailchimp won't schedule an
  // email that hasn't been designed yet.
  const scheduleField = document.getElementById("mcFormScheduleField");
  scheduleField.hidden = mode === "create";
  const scheduled = campaign?.status === "schedule" && campaign.sendTime;
  document.getElementById("mcFormSchedule").checked = Boolean(scheduled);
  const when = scheduled ? new Date(campaign.sendTime) : null;
  document.getElementById("mcFormSendDate").value = when ? ymd(when) : task.dueDate;
  const clock = when
    ? `${String(when.getHours()).padStart(2, "0")}:${String(Math.floor(when.getMinutes() / 15) * 15).padStart(2, "0")}`
    : "09:00";
  document.getElementById("mcFormSendClock").value = clock;
  document.getElementById("mcFormDueNote").hidden = !(mode === "edit" && task.id.startsWith(`${TASK_ID_PREFIX_CAMPAIGN}|`));
  syncMcScheduleFields();

  setMcFormMessage("");
  overlay.classList.add("open");
  requestAnimationFrame(() => (mode === "create" ? subject : name).focus());

  // Until the list arrives, show the campaign's own audience (when editing).
  audienceSelect.replaceChildren(campaign?.listId
    ? new Option(campaign.listName || "Current audience", campaign.listId)
    : new Option("Loading audiences…", ""));
  audienceSelect.disabled = true;
  try {
    const audiences = await loadMcAudiences();
    if (mcFormState?.task !== task) return; // closed or reopened meanwhile
    audienceSelect.replaceChildren(...audiences.map(a =>
      new Option(`${a.name} (${a.members.toLocaleString()} contacts)`, a.id)));
    if (campaign?.listId) audienceSelect.value = campaign.listId;
    audienceSelect.disabled = audiences.length <= 1;
    if (!audiences.length) setMcFormMessage("No audiences in this Mailchimp account yet.", "error");
  } catch (err) {
    if (mcFormState?.task !== task) return;
    // Editing can still go ahead on the audience it already has.
    if (mode === "create") audienceSelect.replaceChildren(new Option("—", ""));
    setMcFormMessage(err.message, "error");
  }
  await refreshMcSegmentsFor(audienceSelect.value, task);
}

/** A different audience has different segments and tags — start over at everyone. */
function onMcAudienceChange() {
  if (!mcFormState) return;
  mcSendTo = { kind: "all", segmentId: "", tagIds: new Set(), match: "any", touched: true };
  refreshMcSegmentsFor(document.getElementById("mcFormAudience").value, mcFormState.task);
}

function closeMcForm() {
  document.getElementById("mcFormOverlay")?.classList.remove("open");
  mcFormState = null;
}

/** The chosen send time as ISO, or "" when scheduling is off. */
function getMcFormSendTime() {
  if (!document.getElementById("mcFormSchedule")?.checked) return "";
  const date = parseYmd(document.getElementById("mcFormSendDate").value);
  const [h, m] = (document.getElementById("mcFormSendClock").value || "09:00").split(":").map(Number);
  if (!date) return "";
  date.setHours(h, m, 0, 0);
  return date.toISOString();
}

async function saveMcForm() {
  if (!mcFormState) return;
  const { mode, task, campaign } = mcFormState;
  const fields = {
    title: document.getElementById("mcFormName").value.trim(),
    subject: document.getElementById("mcFormSubject").value.trim(),
    previewText: document.getElementById("mcFormPreview").value.trim(),
  };

  const sendToProblem = validateMcSendTo();
  if (sendToProblem) {
    setMcFormMessage(sendToProblem, "error");
    return;
  }

  const btn = document.getElementById("mcFormSaveBtn");
  btn.disabled = true;
  setMcFormMessage(mode === "create" ? "Creating in Mailchimp…" : "Saving to Mailchimp…");

  try {
    if (mode === "create") {
      const listId = document.getElementById("mcFormAudience").value;
      if (!listId) throw new Error("Pick an audience.");
      const created = await callMailchimp("create", { ...fields, listId, targeting: getMcTargeting() });
      mcCampaigns.set(created.id, created);
      await setTaskLink(task.id, created.id);
      closeMcForm();
      refreshTaskViews();
      showIndicator("Draft created in Mailchimp — use Open in Mailchimp to design it", "success");
      return;
    }

    const wantsSchedule = document.getElementById("mcFormSchedule").checked;
    const sendTime = getMcFormSendTime();
    if (wantsSchedule && !sendTime) throw new Error("Pick a send date.");
    if (wantsSchedule && new Date(sendTime) <= new Date()) throw new Error("The send time has to be in the future.");

    // Turned off on a scheduled campaign → unschedule; otherwise keep as is.
    const payload = { id: campaign.id, ...fields };
    const listId = document.getElementById("mcFormAudience").value;
    if (listId && listId !== campaign.listId) payload.listId = listId;
    // Only send who-it-goes-to when it was actually changed here.
    if (mcSendTo.touched) {
      const targeting = getMcTargeting();
      if (targeting) payload.targeting = targeting;
    }
    if (wantsSchedule) payload.sendTime = sendTime;
    else if (campaign.status === "schedule") payload.sendTime = null;

    let updated;
    try {
      updated = await callMailchimp("update", payload);
    } catch (err) {
      // Edits may have landed even if scheduling didn't — show what's there now.
      const found = await callMailchimp("get", { ids: [campaign.id] }).catch(() => null);
      if (found?.[campaign.id]) mcCampaigns.set(campaign.id, found[campaign.id]);
      refreshTaskViews();
      throw err;
    }
    mcCampaigns.set(updated.id, updated);

    // A campaign task follows its send date, so the calendar shows the day
    // the email actually goes out.
    let moved = false;
    if (updated.status === "schedule" && updated.sendTime) {
      moved = await setCampaignTaskDueDate(task.id, ymd(new Date(updated.sendTime)));
    }
    closeMcForm();
    refreshTaskViews();
    showIndicator(moved ? "Saved to Mailchimp — task moved to the send date" : "Saved to Mailchimp", "success");
  } catch (err) {
    setMcFormMessage(err.message || "Couldn't save to Mailchimp.", "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Link picker ──────────────────────────────────────────────────────────────

let mcLinkTask = null;
let mcLinkChoices = [];

async function openMcLinkPicker(task) {
  const overlay = document.getElementById("mcLinkOverlay");
  if (!overlay) return;
  mcLinkTask = task;
  document.getElementById("mcLinkTaskLabel").textContent = `${task.label} · due ${formatTaskDate(task.dueDate)}`;
  const search = document.getElementById("mcLinkSearch");
  search.value = "";
  const list = document.getElementById("mcLinkList");
  list.replaceChildren(Object.assign(document.createElement("div"), { className: "mc-link-empty", textContent: "Loading campaigns from Mailchimp…" }));
  overlay.classList.add("open");
  requestAnimationFrame(() => search.focus());

  try {
    mcLinkChoices = await callMailchimp("campaigns");
    mcLinkChoices.forEach(c => mcCampaigns.set(c.id, c));
    renderMcLinkList();
  } catch (err) {
    list.replaceChildren(Object.assign(document.createElement("div"), { className: "mc-link-empty is-error", textContent: err.message }));
  }
}

function renderMcLinkList() {
  const list = document.getElementById("mcLinkList");
  if (!list) return;
  const q = (document.getElementById("mcLinkSearch")?.value ?? "").trim().toLowerCase();
  const rows = mcLinkChoices.filter(c => !q || `${c.title} ${c.subject} ${c.listName}`.toLowerCase().includes(q));

  if (rows.length === 0) {
    list.replaceChildren(Object.assign(document.createElement("div"), {
      className: "mc-link-empty",
      textContent: mcLinkChoices.length ? "No campaigns match." : "No campaigns in Mailchimp yet.",
    }));
    return;
  }

  list.replaceChildren(...rows.map(c => {
    const takenBy = findTaskLinkedTo(c.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "mc-link-row";
    row.disabled = Boolean(takenBy && takenBy !== mcLinkTask?.id);

    const top = document.createElement("span");
    top.className = "mc-link-row-top";
    const title = document.createElement("span");
    title.className = "mc-link-title";
    title.textContent = c.title || "(untitled)";
    const status = document.createElement("span");
    status.className = "mc-status";
    const s = describeMcStatus(c);
    status.dataset.tone = s.tone;
    status.textContent = s.label;
    top.append(title, status);

    const sub = document.createElement("span");
    sub.className = "mc-link-sub";
    sub.textContent = [c.subject ? `“${c.subject}”` : "No subject yet", c.listName, row.disabled ? "already linked to another task" : ""]
      .filter(Boolean).join(" · ");

    row.append(top, sub);
    row.addEventListener("click", () => linkTaskTo(c));
    return row;
  }));
}

async function linkTaskTo(campaign) {
  if (!mcLinkTask) return;
  try {
    await setTaskLink(mcLinkTask.id, campaign.id);
    mcCampaigns.set(campaign.id, campaign);
    document.getElementById("mcLinkOverlay")?.classList.remove("open");
    mcLinkTask = null;
    // Linking an email that's already gone out ticks the task straight away.
    await autoCompleteSentTasks();
    refreshTaskViews();
    showIndicator("Linked to Mailchimp", "success");
  } catch (err) {
    showIndicator(err.message || "Could not link.", "error");
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function initMailchimp() {
  document.getElementById("mcFormSaveBtn")?.addEventListener("click", saveMcForm);
  document.getElementById("mcFormCancelBtn")?.addEventListener("click", closeMcForm);
  document.getElementById("mcFormCloseBtn")?.addEventListener("click", closeMcForm);
  document.getElementById("mcFormSchedule")?.addEventListener("change", syncMcScheduleFields);
  document.getElementById("mcFormAudience")?.addEventListener("change", onMcAudienceChange);
  document.getElementById("mcFormSegment")?.addEventListener("change", e => {
    mcSendTo.segmentId = e.target.value;
    mcSendTo.touched = true;
    renderMcSendTo();
  });
  document.getElementById("mcForm")?.addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "SELECT" || e.target.type === "checkbox") return;
    e.preventDefault();
    saveMcForm();
  });

  const closeLink = () => {
    document.getElementById("mcLinkOverlay")?.classList.remove("open");
    mcLinkTask = null;
  };
  document.getElementById("mcLinkCloseBtn")?.addEventListener("click", closeLink);
  document.getElementById("mcLinkSearch")?.addEventListener("input", renderMcLinkList);

  ["mcFormOverlay", "mcLinkOverlay"].forEach(id => {
    const overlay = document.getElementById(id);
    overlay?.addEventListener("click", e => {
      if (e.target !== overlay) return;
      if (id === "mcFormOverlay") closeMcForm(); else closeLink();
    });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (document.getElementById("mcFormOverlay")?.classList.contains("open")) closeMcForm();
    if (document.getElementById("mcLinkOverlay")?.classList.contains("open")) closeLink();
  });

  initMailchimpSync();
}
