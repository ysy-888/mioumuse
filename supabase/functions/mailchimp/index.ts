/**
 * Mailchimp helper — the app's only way to Mailchimp.
 *
 * Mailchimp won't answer requests made straight from a web page, and the API
 * key can't live in the app's public code, so the app calls this function
 * instead. The key stays here, read from the MAILCHIMP_API_KEY secret.
 *
 * Every request must come from a signed-in user of the app (checked below).
 * Body: { action, ...params }. Replies: { data } or { error } (with status).
 *
 * Actions
 *   status                         is a key set, and which account is it
 *   audiences                      lists, with their default sender
 *   segments   { listId }          an audience's saved segments and tags
 *   campaigns                      recent campaigns, newest first (for linking)
 *   get        { ids }             current state of specific campaigns
 *   create     { listId, title, subject, previewText, targeting? }
 *   update     { id, title?, subject?, previewText?, sendTime?, listId?, targeting? }
 *                                  sendTime: ISO string to schedule,
 *                                  null to unschedule, omitted to keep;
 *                                  listId: move it to another audience;
 *                                  targeting: who in the audience (below)
 *   delete     { id }              never a sent campaign
 *
 * Deploy: supabase functions deploy mailchimp --project-ref <ref> --use-api
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const API_KEY = Deno.env.get("MAILCHIMP_API_KEY") ?? "";
// Mailchimp keys end in their data centre, e.g. "…-us21".
const DC = API_KEY.split("-")[1] ?? "";
const API = `https://${DC}.api.mailchimp.com/3.0`;
const ADMIN = `https://${DC}.admin.mailchimp.com`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

class UserError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** One Mailchimp API call. Mailchimp's own error text is passed through. */
async function mc(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`app:${API_KEY}`)}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields = Array.isArray(body?.errors)
      ? body.errors.map((e: { field?: string; message?: string }) => [e.field, e.message].filter(Boolean).join(": ")).join("; ")
      : "";
    const message = [body?.detail || body?.title || `Mailchimp error ${res.status}`, fields].filter(Boolean).join(" — ");
    throw new UserError(message, res.status === 404 ? 404 : 502);
  }
  return body;
}

const CAMPAIGN_FIELDS = [
  "id", "web_id", "status", "send_time", "create_time", "emails_sent",
  "settings.title", "settings.subject_line", "settings.preview_text",
  "settings.from_name", "settings.reply_to",
  "recipients.list_id", "recipients.list_name",
  "recipients.segment_opts", "recipients.segment_text", "recipients.recipient_count",
].join(",");

// ── Targeting ────────────────────────────────────────────────────────────────
//
// Who in the audience gets the campaign, in the app's terms:
//   { kind: "all" }
//   { kind: "segment", segmentId }               a saved segment
//   { kind: "tags", tagIds, match: "any"|"all" }  contacts with these tags
//   { kind: "custom" }                           other conditions set in
//                                                Mailchimp — left as they are
// Tags are Mailchimp "static segments", so a single tag picked in Mailchimp
// can come back as a saved_segment_id; the app sorts that out, since it
// knows which ids are tags.

type Targeting = { kind: string; segmentId?: number; tagIds?: number[]; match?: string };

// deno-lint-ignore no-explicit-any
function readTargeting(opts: any): Targeting {
  const conditions = Array.isArray(opts?.conditions) ? opts.conditions : [];
  if (opts?.saved_segment_id) return { kind: "segment", segmentId: Number(opts.saved_segment_id) };
  if (conditions.length === 0) return { kind: "all" };
  // deno-lint-ignore no-explicit-any
  const tagsOnly = conditions.every((c: any) => c?.condition_type === "StaticSegment" && c?.op === "static_is");
  if (tagsOnly) {
    // deno-lint-ignore no-explicit-any
    return { kind: "tags", tagIds: conditions.map((c: any) => Number(c.value)), match: opts.match === "all" ? "all" : "any" };
  }
  return { kind: "custom" };
}

function buildSegmentOpts(t: Targeting) {
  if (t.kind === "segment" && t.segmentId) return { saved_segment_id: Number(t.segmentId) };
  if (t.kind === "tags" && t.tagIds?.length) {
    return {
      match: t.match === "all" ? "all" : "any",
      conditions: t.tagIds.map(id => ({
        condition_type: "StaticSegment",
        field: "static_segment",
        op: "static_is",
        value: Number(id),
      })),
    };
  }
  return null;
}

/** Mailchimp's description of the targeting comes as HTML; keep the words. */
function plainText(html: string) {
  return String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

/**
 * Point a campaign at `listId`, targeted as `t`. Clearing targeting back to
 * the whole audience isn't documented one single way, so each known form is
 * tried and the result checked — and if Mailchimp still holds on to a
 * segment, that's reported rather than claimed as done.
 */
async function applyRecipients(id: string, listId: string, t: Targeting) {
  const path = `/campaigns/${encodeURIComponent(id)}`;
  const opts = buildSegmentOpts(t);
  if (opts) {
    await mc(path, { method: "PATCH", body: JSON.stringify({ recipients: { list_id: listId, segment_opts: opts } }) });
    return;
  }
  const attempts = [
    { list_id: listId },
    { list_id: listId, segment_opts: { match: "all", conditions: [] } },
  ];
  for (const recipients of attempts) {
    await mc(path, { method: "PATCH", body: JSON.stringify({ recipients }) });
    const now = await getCampaign(id);
    if (readTargeting(now.recipients?.segment_opts).kind === "all") return;
  }
  throw new UserError("Mailchimp kept the segment on this campaign — switch it to the entire audience in Mailchimp instead.", 409);
}

/** The shape the app works with — and the links it needs into Mailchimp. */
// deno-lint-ignore no-explicit-any
function summarize(c: any) {
  return {
    targeting: readTargeting(c.recipients?.segment_opts),
    segmentText: plainText(c.recipients?.segment_text),
    recipientCount: c.recipients?.recipient_count ?? null,
    id: c.id,
    webId: c.web_id,
    status: c.status, // save | paused | schedule | sending | sent
    sendTime: c.send_time || "",
    createTime: c.create_time || "",
    title: c.settings?.title ?? "",
    subject: c.settings?.subject_line ?? "",
    previewText: c.settings?.preview_text ?? "",
    listId: c.recipients?.list_id ?? "",
    listName: c.recipients?.list_name ?? "",
    emailsSent: c.emails_sent ?? 0,
    editUrl: `${ADMIN}/campaigns/edit?id=${c.web_id}`,
    reportUrl: `${ADMIN}/reports/summary?id=${c.web_id}`,
  };
}

async function getCampaign(id: string) {
  return mc(`/campaigns/${encodeURIComponent(id)}?fields=${CAMPAIGN_FIELDS}`);
}

const LOCKED = new Set(["sending", "sent"]);

// ── Actions ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
const actions: Record<string, (p: any) => Promise<unknown>> = {
  async status() {
    const account = await mc("/?fields=account_name,login_id");
    return { connected: true, accountName: account?.account_name ?? "" };
  },

  async audiences() {
    const body = await mc("/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count,lists.campaign_defaults");
    // deno-lint-ignore no-explicit-any
    return (body?.lists ?? []).map((l: any) => ({
      id: l.id,
      name: l.name,
      members: l.stats?.member_count ?? 0,
      fromName: l.campaign_defaults?.from_name ?? "",
      fromEmail: l.campaign_defaults?.from_email ?? "",
    }));
  },

  /** An audience's saved segments and tags, for the "Send to" choice. */
  async segments({ listId }) {
    if (!listId) throw new UserError("Pick an audience.");
    const body = await mc(`/lists/${encodeURIComponent(listId)}/segments?count=1000&fields=segments.id,segments.name,segments.type,segments.member_count`);
    // deno-lint-ignore no-explicit-any
    const all = (body?.segments ?? []).map((s: any) => ({ id: s.id, name: s.name, type: s.type, members: s.member_count ?? 0 }));
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      // deno-lint-ignore no-explicit-any
      segments: all.filter((s: any) => s.type !== "static").sort(byName),
      // deno-lint-ignore no-explicit-any
      tags: all.filter((s: any) => s.type === "static").sort(byName),
    };
  },

  async campaigns() {
    const fields = CAMPAIGN_FIELDS.split(",").map(f => `campaigns.${f}`).join(",");
    const body = await mc(`/campaigns?count=100&type=regular&sort_field=create_time&sort_dir=DESC&fields=${fields}`);
    return (body?.campaigns ?? []).map(summarize);
  },

  async get({ ids }: { ids: string[] }) {
    const list = Array.isArray(ids) ? ids.slice(0, 200) : [];
    const results = await Promise.all(list.map(async id => {
      try {
        return [id, summarize(await getCampaign(id))];
      } catch (err) {
        // Deleted in Mailchimp — the app shows the link as broken.
        if (err instanceof UserError && err.status === 404) return [id, { id, missing: true }];
        throw err;
      }
    }));
    return Object.fromEntries(results);
  },

  async create({ listId, title, subject, previewText, targeting }) {
    if (!listId) throw new UserError("Pick an audience.");
    // The audience's default sender, so the draft is ready to design.
    const list = await mc(`/lists/${encodeURIComponent(listId)}?fields=campaign_defaults`);
    const segmentOpts = buildSegmentOpts(targeting ?? { kind: "all" });
    const created = await mc("/campaigns", {
      method: "POST",
      body: JSON.stringify({
        type: "regular",
        recipients: segmentOpts ? { list_id: listId, segment_opts: segmentOpts } : { list_id: listId },
        settings: {
          title: title ?? "",
          subject_line: subject ?? "",
          preview_text: previewText ?? "",
          from_name: list?.campaign_defaults?.from_name ?? "",
          reply_to: list?.campaign_defaults?.from_email ?? "",
        },
      }),
    });
    return summarize(await getCampaign(created.id));
  },

  /**
   * Mailchimp won't edit a scheduled campaign, so a scheduled one is
   * unscheduled, edited, and put back — at the new time if one was given,
   * otherwise at the time it already had.
   */
  async update({ id, title, subject, previewText, sendTime, listId, targeting }) {
    const current = await getCampaign(id);
    if (LOCKED.has(current.status)) throw new UserError("This campaign has already been sent, so it can't be changed.");

    const wasScheduledAt = current.status === "schedule" ? current.send_time : "";
    if (wasScheduledAt) await mc(`/campaigns/${encodeURIComponent(id)}/actions/unschedule`, { method: "POST" });

    const settings = {
      title: title ?? current.settings?.title ?? "",
      subject_line: subject ?? current.settings?.subject_line ?? "",
      preview_text: previewText ?? current.settings?.preview_text ?? "",
      from_name: current.settings?.from_name ?? "",
      reply_to: current.settings?.reply_to ?? "",
    };
    await mc(`/campaigns/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ settings }) });

    // Who it goes to. Segments and tags belong to an audience, so a new
    // audience without new targeting goes to that whole audience.
    const currentList = current.recipients?.list_id ?? "";
    const newList = listId || currentList;
    if (targeting || newList !== currentList) {
      try {
        await applyRecipients(id, newList, targeting ?? { kind: "all" });
      } catch (err) {
        // Put the schedule back before reporting, so nothing is left unscheduled by accident.
        if (wasScheduledAt) {
          await mc(`/campaigns/${encodeURIComponent(id)}/actions/schedule`, {
            method: "POST",
            body: JSON.stringify({ schedule_time: new Date(wasScheduledAt).toISOString() }),
          }).catch(() => {});
        }
        throw err;
      }
    }

    const target = sendTime === undefined ? wasScheduledAt : sendTime;
    if (target) {
      try {
        await mc(`/campaigns/${encodeURIComponent(id)}/actions/schedule`, {
          method: "POST",
          body: JSON.stringify({ schedule_time: new Date(target).toISOString() }),
        });
      } catch (err) {
        // The edit itself landed; say so, along with why the schedule didn't.
        const why = err instanceof Error ? err.message : String(err);
        throw new UserError(`Saved, but Mailchimp didn't schedule it: ${why}`, 409);
      }
    }
    return summarize(await getCampaign(id));
  },

  async delete({ id }) {
    let current;
    try {
      current = await getCampaign(id);
    } catch (err) {
      // Already gone in Mailchimp — nothing left to delete.
      if (err instanceof UserError && err.status === 404) return { deleted: true };
      throw err;
    }
    if (LOCKED.has(current.status)) throw new UserError("Sent campaigns aren't deleted from the app — their reports would go with them.");
    if (current.status === "schedule") await mc(`/campaigns/${encodeURIComponent(id)}/actions/unschedule`, { method: "POST" });
    await mc(`/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { deleted: true };
  },
};

// ── Entry ────────────────────────────────────────────────────────────────────

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "POST only." }, 405);

  // Only a signed-in user of the app gets through — the anon key alone isn't enough.
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return reply({ error: "Sign in to use Mailchimp." }, 401);

  if (!API_KEY || !DC) {
    return reply({ error: "Mailchimp isn't connected yet — add the MAILCHIMP_API_KEY secret in Supabase." }, 503);
  }

  try {
    const { action, ...params } = await req.json();
    const run = actions[action];
    if (!run) return reply({ error: `Unknown action "${action}".` }, 400);
    return reply({ data: await run(params) });
  } catch (err) {
    const status = err instanceof UserError ? err.status : 500;
    return reply({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});
