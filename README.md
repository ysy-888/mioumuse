# Practice CRM

Client and task management for a public accounting practice. Built on the frame
and design system of the PO App (sibling project): same header/tab shell,
toolbar, table with search / sort / column filters, and footer pagination.

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
3. Authentication → Users → Add user (your one login; check "Auto Confirm
   User").
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
against new HTML — which produces a half-updated app rather than an obvious
failure. The script rewrites the `?v=` on every local asset reference in
index.html so the URLs change on every deploy.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Page shell — header nav, toolbar, companies table, company detail view, footer |
| `crm.css` | Design system carried over from the PO App, plus CRM-specific sections at the bottom |
| `js/config.js` | Domain vocabulary — schedule options, the five service areas |
| `js/util.js` | Display, sort-compare, search-highlight, and status-message helpers |
| `js/auth.js` | Supabase client + the login screen |
| `js/store.js` | Data layer (Supabase) |
| `js/app-shell.js` | View switching, header menu, CSV export |
| `js/companies-filters.js` | Toolbar service filter + per-column filter popover |
| `js/companies.js` | Companies table — search, sort, pagination, render |
| `js/company-detail.js` | Full-page company detail with service toggles |
| `js/company-form.js` | Add / edit company modal and the detail-page menu |
| `js/payroll-schedule.js` | Pay date / tax due date engine — pure date math, no DOM |
| `js/payroll.js` | Payroll section: schedule groups, employees, upcoming tasks |
| `js/bookkeeping.js` | Bookkeeping: monthly close per company, plus the practice-wide year grid |
| `js/calendar.js` | Calendar view of every payroll task across all clients |
| `js/main.js` | Boot |

## Data model

```
Owner   { id, name, email, phone }
Company { id, name, ownerId, location,
          payrollSchedules: string[],
          payrollTax, salesTax,
          services: { payroll, salesTax, bookkeeping, registration, reporting } }
```

One owner is assigned to many companies.

Schedule options:

- **Payroll** (multi-select — a company can run several at once)
  - Monthly — pay date is the end of every month
  - Semi-Monthly — the 15th and the end of every month
  - Bi-Weekly — every other chosen weekday, anchored to a first pay date
- **Payroll Tax** — Quarterly, Monthly, Semi-Weekly
- **Sales Tax** — Quarterly, Y6, Y12

## The five service areas

Each company opts into any combination. Enabled services become tabs on the
company detail page.

| Service | Tracks |
|---|---|
| Payroll | Payroll processing and tax payment schedules |
| Sales Tax | Sales tax payments and schedules |
| Bookkeeping | Bookkeeping progress |
| Registration | SOI renewal, business license renewal, etc. |
| Reporting | Quarterly payroll and sales tax reporting |

## Storage

`js/store.js` is the only file that knows where data lives — three Supabase
tables (`owners`, `companies`, `completed_tasks`), each scoped to the
signed-in user by Row Level Security (see `supabase-schema.sql`). Every
function is `async`; the rest of the app reads through synchronous getters
(`getAllCompanies`, `getCompanyById`, …) served from an in-memory cache kept
in sync with the database, so nothing else awaits a network round trip just
to render.

*Clear all data* in the header menu permanently wipes every company, owner,
and completed task. *Sign out* ends the session and returns to the login
screen.

## Payroll

Group-first: one group per schedule. Which schedules a company runs, and
which services it buys, are both set in **Edit company details** — the
company page then shows only what is actually in use.

In that form, Payroll and Sales Tax own the settings nested under them.
Switching a service off disables its settings and blanks its columns and
pills everywhere else, but the stored values are kept, so switching it back
on restores the schedules, deposit status, and employees intact. The bi-weekly pay calendar (weekday + first pay date)
lives on the *group*, not the employee, because a company runs one bi-weekly
cycle that everyone on it shares.

### Date rules

All of this lives in `js/payroll-schedule.js`.

| | Rule |
|---|---|
| Monthly pay | Last day of every month |
| Semi-Monthly pay | The 15th and the last day of every month |
| Bi-Weekly pay | Anchor pay date, then every 14 days |
| Quarterly deposit | The last day of the month after the quarter ends — the Form 941 deadline (Apr 30, Jul 31, Oct 31, Jan 31) |
| Monthly deposit | The 15th of the following month |
| Semi-Weekly deposit | Pay date Sat/Sun/Mon/Tue → that week's upcoming Friday. Pay date Wed/Thu/Fri → the following Wednesday |

**Weekends.** A date that lands on a weekend does not move. The *task* is
pulled back to the Friday before, so work is done ahead of the date rather
than after. This is deliberately stricter than the IRS rule, which pushes a
due date forward to the next business day.

**Federal holidays are not handled.** A task due the Friday after
Thanksgiving still reads as that Friday.

### Tasks

Each pay run produces a Paystub task. Tax deposits are separate: one deposit
covers every payroll falling in its window, so a monthly depositor gets one
task per month and a semi-weekly depositor gets one per Wed/Fri deadline —
not one per pay run.

Only completion is stored (`practiceCrm.completedTasks`). The tasks
themselves are always regenerated from the schedules, so there is no calendar
to backfill.

## Bookkeeping

Deliberately outside the task calendar. Payroll and sales tax have deadlines
derived from schedules and states; bookkeeping is a two-step close you work
through per month with no due date to place on a grid — so these tasks appear
only in the company's Bookkeeping section and the practice-wide **Bookkeeping**
tab, never on the calendar or in the task rails.

Each month has two parts, in order:

| Step | Meaning |
|---|---|
| Statement | The month's statements are in hand |
| Bookkeeping | The books for that month are done |

The second is locked until the first is ticked, and reopening the statements
reopens the books with them — closed books resting on statements you no longer
have is the state to avoid.

Accounts (Checking Account / Credit Card) are a documented list of what gets
reconciled, in the same spirit as employees under a payroll group: they say
what the work covers without each one becoming its own task.

The **Bookkeeping** tab lists every client with the service switched on, one
row each, Jan–Dec across — not started, statements in, or closed.

## Not built yet

- Registration and Reporting section bodies
- Federal holiday handling
- Email functionality (to be carried over from the PO App Apps Script relay)
