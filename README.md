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
| `index.html` | Page shell — header nav, toolbar, trade shows table, show detail, calendar |
| `crm.css` | Design system, plus the trade show sections at the bottom |
| `js/config.js` | Supabase keys, the trade show list, the email task schedule |
| `js/util.js` | Display, sort-compare, search-highlight, and status-message helpers |
| `js/dates.js` | Date primitives and formatting |
| `js/auth.js` | Supabase client + the login screen |
| `js/store.js` | Data layer (Supabase) |
| `js/tasks.js` | Email tasks and show-day events derived from each show; shared task checkbox and card |
| `js/app-shell.js` | View switching, header menu, CSV export |
| `js/trade-shows.js` | Trade Shows table — timing filter, search, sort |
| `js/trade-show-detail.js` | Full-page show detail: email tasks, notes, edit/delete menu |
| `js/trade-show-form.js` | Add / edit trade show modal |
| `js/calendar.js` | Home calendar of every show and email, with the upcoming rail |
| `js/main.js` | Boot |

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

- E-Commerce (banners per webstore/platform)
- Social Media
- Campaigns that tie banners, posts and shows together
- Mailchimp
