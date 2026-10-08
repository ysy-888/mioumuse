# Mioumuse

Central planner for an apparel brand's design and marketing work — trade
shows first, with e-commerce banners and social media to follow. Started
from the frame of an accounting CRM: same header/tab shell, toolbar, table,
and calendar.

## Running it

Static site, no build step. Serve the folder and open it:

```bash
npx http-server -c-1 .
```

## Backend setup (one time)

Data lives in Supabase (Postgres + auth), gated behind a login — see
`supabase-schema.sql` for the full walkthrough. Short version:

1. Create a free project at [supabase.com](https://supabase.com).
2. Project → SQL Editor → paste `supabase-schema.sql` → Run.
3. Authentication → Users → Add user (check "Auto Confirm User").
4. Project Settings → API → copy the **Project URL** and **anon public key**
   into `SUPABASE_URL` / `SUPABASE_ANON_KEY` at the top of `js/config.js`.

Until those two values are filled in, the app shows a "Supabase isn't
configured" message instead of the login screen.

## Before committing js/ or crm.css changes

```bash
node scripts/stamp-assets.js
```

GitHub Pages serves assets with `Cache-Control: max-age=600` and no content
hash in the filename, so without this a browser happily runs cached old JS
against new HTML. The script rewrites the `?v=` on every local asset
reference in index.html so the URLs change on every deploy.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Page shell — header nav, toolbars, campaign and trade show tables, side pane, calendar, forms |
| `crm.css` | Design system, plus the campaign / trade show sections at the bottom |
| `js/config.js` | Supabase keys, trade show list, email schedule, campaign types and task categories |
| `js/util.js` | Display, sort-compare, search-highlight, and status-message helpers |
| `js/dates.js` | Date primitives and formatting |
| `js/auth.js` | Supabase client + the login screen |
| `js/store.js` | Data layer (Supabase) |
| `js/tasks.js` | Campaigns and trade shows as one "schedule item" shape; tasks, status buckets, shared task checkbox and card |
| `js/app-shell.js` | View switching, header menu, CSV export |
| `js/record-list.js` | The Campaigns and Trade Shows tables — timing filter, search, sort |
| `js/item-pane.js` | Right-hand side pane for a campaign or show: summary, tasks, notes, edit/delete menu |
| `js/campaign-form.js` | Add / edit campaign modal, with the task builder |
| `js/trade-show-form.js` | Add / edit trade show modal |
| `js/banners.js` | Platforms tab — banners table (platform filter, search, sort) and the banner side pane |
| `js/banner-form.js` | Add / edit banner modal — image upload, pixel size, up to 4 Style # / Color rows |
| `js/mailchimp.js` | Mailchimp links on Email tasks — create / edit / schedule / delete, link picker, sync and auto-complete |
| `supabase/functions/mailchimp/` | Edge Function the app calls for Mailchimp; holds the API key (secret `MAILCHIMP_API_KEY`) |
| `js/styles.js` | Styles tab — the style database table, status / season / category filters, search |
| `js/style-import.js` | Import Excel — reads the N41 ATS export in the browser, previews new / updated / unchanged, saves |
| `js/calendar.js` | Home calendar of every campaign, show, and task, with the upcoming rail |
| `js/main.js` | Boot |

## Campaigns

A campaign has a type (`CAMPAIGN_TYPES` — Sale by default), an optional name
("Black Friday"), a start and end date, and whatever tasks it needs. Tasks
are added one at a time from three categories — Email, Banner, Social Media
(`CAMPAIGN_TASK_CATEGORIES`) — as many of each as you like.

**Only on specific days** limits a campaign to chosen weekdays between its
dates — a sale from 11/7 to 12/19 on Fri, Sat and Sun only, say
(`campaigns.weekdays`, 0 = Sunday … 6 = Saturday; empty = every day). The
calendar, day counts and Starts / Ends labels all follow the chosen days.
Tasks keep their own due dates either way.

A new task is due on the campaign's start date. In the form, a task keeps
following the start date until you give it a date of its own; after that,
moving the start date leaves it alone.

Tasks are stored on the campaign (`campaigns.tasks`), each with its own id,
so a task's checkmark (`cp|<campaign id>|<task id>`) survives date changes.
Removing a task in the edit form deletes its checkmark too.

## Home calendar and task rail

Campaigns and trade shows share one pipeline (`js/tasks.js` turns each into
a "schedule item"). Each appears on every day it runs, in its own colour —
one per trade show, one per campaign type — and each task appears on its due
date. The filter bar narrows by Campaigns / Trade Shows / Emails / Banners /
Social Media.

The rail beside the calendar buckets each card by its tasks, and a card can
be in more than one tab:

| Tab | Card shows when | Rows shown |
|---|---|---|
| Upcoming | any task still to come | all its tasks, missed dates in red |
| Overdue | any task past due and not done | only the missed tasks |
| Completed | every task done | all its tasks |

## Trade shows

Add a show by picking it from the list — Atlanta Apparel, Dallas Market,
Magic New York, Magic Las Vegas, Magic Nashville, Flair (`TRADE_SHOWS` in
`js/config.js`) — and setting its start date (Day 1) and end date.

Each show creates three email tasks, counted back from Day 1
(`TRADE_SHOW_EMAIL_TASKS`):

| Task | Due |
|---|---|
| Email · 3 weeks out | 21 days before Day 1 |
| Email · 1 week out | 7 days before Day 1 |
| Email · Day before | 1 day before Day 1 |

Dates are exact — an email that lands on a weekend stays on the weekend.

Only completion is stored (`completed_tasks`). Task ids are
`ts|<show id>|<email key>` with no date in them, so moving a show's dates
moves its emails and keeps their checkmarks. Deleting a show deletes its
checkmarks with it.

On the Home calendar each show appears on every day it runs (Day 1, Day 2,
…) and each email on its due date, both in the show's own colour. Clicking
a show or its card highlights the whole thing — show days and all three
emails. Once every email for a show is done, its email chips are hidden
unless **Show completed** is on.

## Not built yet


- Social Media


## Mailchimp

Email tasks (campaign emails and trade show emails) can be linked to a
Mailchimp campaign from the side pane: **Create in Mailchimp** makes a draft
already linked to the task; **Link existing** picks one you started in
Mailchimp. A linked task shows the campaign's status and subject, and can be
edited (name, subject, preview text, send time), opened in Mailchimp to
design, unlinked, or deleted — drafts and scheduled campaigns only; sent ones
are never deleted from the app, since their reports would go with them.

When a linked campaign has been sent, the task ticks itself off — checked on
load, on Refresh, every 5 minutes while the app is open, and when its tab
comes back into view. That happens once per link: untick it by hand and it
stays unticked. Setting a send time on a campaign task moves its due date to
the send date.

The app never holds the Mailchimp key. It calls the `mailchimp` Edge
Function, which reads the key from the `MAILCHIMP_API_KEY` secret and only
answers signed-in users. Deploy it with:

```bash
supabase functions deploy mailchimp --project-ref anzrcautqhbxdyobdyxp --use-api
```

Links live in the `task_links` table (see `supabase-schema.sql`).

## Styles database

The **Styles** tab holds every Style # + Color from the N41 ATS export.
**Import Excel** reads the .xlsx in the browser (SheetJS, loaded only when
importing) — the file itself is never uploaded:

| Column | Field |
|---|---|
| B | N41 Status |
| D (merged with E) | Season |
| F | Category |
| H | Style # |
| I | Color |
| L (merged with M–N) | Description |

Rows are read from row 8 down; any row without a Style # (the size-breakdown
and blank rows between styles) is skipped. A preview shows what's new,
updated and unchanged before anything is saved; confirming saves only new
and changed styles. Styles missing from a newer file are left as they are.

Banner Style # fields look styles up as you type: suggestions, the style's
colours, and its description and status under the row and in the banner pane.

Styles live in the `styles` table (see `supabase-schema.sql`), keyed by
user + Style # + Color, and are loaded 1,000 rows at a time.
