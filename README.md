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
| `js/style-import.js` | Import Excel — reads the N41 ATS export in the browser, lists every change under Update / New Styles / New Colors tabs, saves, and records it for Update history |
| `js/style-images.js` | Style photos from a linked network folder — matched by file name, thumbnails, gallery |
| `js/photoshoots.js` | Photoshoots tab — the Need to Shoot list, the shoots list, the shoot side pane, shoot status badges |
| `js/photoshoot-form.js` | Create / edit photoshoot modal |
| `js/magento-sales.js` | Magento → Orders and Customers (read-only): lists with Status / Group filters, date quick filters, search, sort, paging; the order / customer pane |
| `js/magento-groups.js` | Magento tab → Import groups: reads a Magento product export's `associated_skus` and saves the exact group links; the "Not in group" flag |
| `js/magento.js` | Magento tab — live products (filters, sort, paging, status switch, bulk changes, edit pane) and categories (rename, active, jump to products) |
| `supabase/functions/magento/` | Edge Function the app calls for Magento; holds the store address and token (secrets `MAGENTO_BASE_URL`, `MAGENTO_ACCESS_TOKEN`) |
| `js/column-filter.js` | Header filters (the PO app's design): click a column's funnel to tick which values show — used for IHD by month and the Magento products table |
| `js/shortcuts.js` | Keyboard shortcuts on table pages: ← / → turn pages, Space jumps to search |
| `js/copy-menu.js` | Right-click → Copy: style numbers (Styles, Need to Shoot, the shoot pane) and Magento product names |
| `js/table-view.js` | Header menu → Table view: show / hide and reorder any table's columns, saved as that table's default to your account (`table_views`) |
| `js/exports.js` | CSV downloads and printable (Save as PDF) reports — Need to Shoot, each photoshoot, and the header menu's Export CSV |
| `js/calendar.js` | Home calendar of every campaign, show, and task, with the upcoming rail |
| `js/main.js` | Boot |

## Keyboard shortcuts

On the table pages (`js/shortcuts.js`):

| Key | Does |
|---|---|
| ← / → | Previous / next page — Magento Products, Orders, Customers. On Styles, → shows the next batch. Tables that fit on one page ignore them. |
| Space | Jumps to the page's search box; text already there is selected, to type over or edit. |

They stand aside while you're typing (a text box, dropdown or checkbox),
while a window, filter or menu is open, and when Ctrl / Alt / Shift / Cmd is
held. Space on a button reached with Tab still presses it.

## Header menus

**Home**, then three menus that open on hover: **Marketing** (Campaigns, Trade
Shows, Platforms), **Photoshoots** (Photoshoots, Styles) and **Magento**
(Products, Categories). The page you're on is ticked and its menu
underlined.

**Right-click → Copy**: a style number in the Styles and Need to Shoot
tables (the Style # cell) or in a shoot's pane copies that number; a
Magento product name copies the style number (a Simple item's colour suffix
dropped — `ET6157-BLACK` copies `ET6157`).

## Table view

Header menu (⋮) → **Table view** sets which columns a table shows and in
what order. It opens on the table of the page you're on; the **Table** list
switches to any other (Campaigns, Trade Shows, Banners, Styles, Need to
Shoot, Shoots, Magento Products).

- **Show columns**: tick or untick. The tick-box column always stays, and
  at least one other column has to.
- **Column order**: drag a column up or down (or focus it and press Alt+↑ /
  Alt+↓).
- **Save as default** applies it and remembers it for that table. A column
  you hide loses its header filter, if it had one.
- **Reset to original** puts back every column in the original order (Save
  to keep it).

Views are saved to your account (the `table_views` table — see
`supabase-schema.sql`), so they follow your login to any computer; Refresh
picks up a view saved on another computer since. The browser also keeps a
copy, so the columns are right from the first moment. A view saved on a
computer before the table existed is uploaded the first time you sign in
there. Until the table is added, views are saved on that computer only (the
app says so). Columns added to a table later show up in their original spot.

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

## Magento

The **Magento** tab is the store's catalog (Magento 2 / Adobe Commerce),
read and edited live — nothing is copied into Supabase, so what you see is
what the store has right now, and a save goes straight to the store.

**Products** lists one page at a time (25–200 per page); Magento does the
filtering and sorting, so it stays quick on a big catalog.

- Filter from the **Type**, **Visibility**, **Status** and **Categories**
  column headers: click the funnel side of the header and tick the values to
  show — any of them match (Tops and Dresses shows products in either).
  Each filter lists only values some product has, with how many (counted
  in Magento when the tab loads, and again after bulk enable / disable);
  categories with no products are left out. A filtered header turns dark;
  Select all removes the filter. The toolbar's quick filters are shortcuts
  for the header ones: All / Enabled / Disabled for Status, All / Grouped /
  Simple for Type. Search matches SKU or name.
- Products open sorted by **Name**, A–Z. Click a column's label to sort:
  ascending, descending, then back to Name A–Z (Name itself flips between
  A–Z and Z–A). Categories, color, image and qty don't sort. Products with
  the same name put the Grouped item first, then go by SKU.
- **Qty**: Magento's product list doesn't carry stock, so the helper asks
  Magento's inventory for each page's SKUs in one call — a SKU's qty is the
  total across its sources, in stock if any source is — falling back to
  each product's stock record. Grouped items hold no stock and show "–".
- **Stock Status** (In Stock / Out of Stock) is Magento's own setting, kept
  apart from the qty — so an item can have stock and still be Out of Stock.
  Simple items' comes with the qty; Grouped items have their own, read from
  each one's stock record.
- **Available** — is it showing on the webstore? Grouped styles are
  visible (Catalog, Search) and their Simple items (colours) are "Not
  Visible Individually", so:
  - a **Simple item** is available when it's Enabled, Qty ≥ 1 and In Stock,
    *and* its group is Enabled and In Stock — an item in no group, or in an
    unavailable group, doesn't show;
  - a **Grouped style** is available when it's Enabled and In Stock (it has
    no qty), *and* at least one of its items is available.
  The column says Available / Not available and why not ("Qty 0", "Group
  T2846 is Disabled", "No available items", "Not in a group"). It's worked
  out from a brief index of the whole catalog (every product's status,
  visibility, qty and Stock Status — loaded with the tab and on Refresh,
  its pages fetched side by side) and the imported groups, and updates
  straight away after an edit in the app. The browser keeps the last index,
  so availability shows the moment the tab opens while a fresh one loads.
  With the index in hand, a page of products is a single call to Magento:
  Qty and Stock Status are filled in from the index rather than asked for
  page by page (which took a call per Grouped item). They're as fresh as
  the index — Refresh gets new ones.
- **Speed check**: hover over the product count for where the last page's
  time went — the whole wait, Magento's share and how many calls it took,
  and the sign-in check. The helper also reports its version; if the copy
  in Supabase is older than the app expects, the app says so. (Bump
  `HELPER_VERSION` in the Edge Function and `MG_HELPER_VERSION` in
  `js/magento.js` together whenever the function changes.)
  **Available / Not available** (toolbar) filter by it, and **Flagged**
  shows Simple items whose SKU matches a group they aren't in. Magento
  can't filter by these, so with one on the app does the rest itself, from
  the catalog index (which also carries each product's name, price, date
  and categories): it applies the other filters and the search, sorts the
  way Magento does, keeps the products that pass, and asks Magento only for
  the page shown (10 SKUs per call, side by side) — paging, sorting and
  Export CSV all follow. Export adds Available and Why Not
  Available columns.
- **Color** comes from Magento's Color attribute. It's a dropdown there, so
  each product stores an option number and the app looks up the names:
  through the admin API when the integration may read attributes (Stores →
  Attributes → Product — the reliable way), otherwise from the store's
  public GraphQL. If neither works, Color shows the numbers and the app
  says why. It can be changed in the pane.
- **Grouped items**: each shows how many Simple items it has (the number
  beside its name — hover for their SKUs). While Type
  isn't filtered, a Grouped item's Simple items on the same page are moved
  right under it, and the group is set apart — a light grey tint, a bar
  down the left, a line above the Grouped item and below its last Simple
  item, the Simple items indented. With a Type filter on, the list is
  shown just as sorted. A Grouped item's pane lists its Simple items' SKUs;
  a Simple item's pane shows its group.
- **Groups come from a Magento export.** Magento's API lists only a group's
  *enabled* items and can't say which group a product is in, so the exact
  links come from a product export instead. **Import groups** (header menu ⋮)
  reads the file in the browser — it's never uploaded — and saves only the
  group links (`magento_groups`); nothing else in the app or in Magento
  changes. A preview shows the counts and what changed since the last
  import before **Update groups** saves. To get the file: Magento admin →
  System → Data Transfer → Export → Entity Type: Products, format CSV.
  Import a fresh one after changing groups in Magento; the toolbar shows
  the date of the one in use. Until the first import (or for a group added
  since), a group shows only its enabled items.
- **Not in group** flag: a Simple item whose SKU is a group's SKU plus
  "-…" (`T4339-WHITE/BLACK` → `T4339`) but which isn't in that group on
  Magento is flagged "Not in T4339".
- **Shared SKUs**: Magento doesn't strictly stop two products sharing a
  SKU. The import lists any it finds (fix them in Magento), and combines a
  shared Grouped SKU's items.
- **Export CSV** (header menu ⋮) downloads the products as
  the app reads them from Magento's API — every product matching the
  filters — with the imported groups. It isn't Magento's own export format:
  Magento's API can't produce that, so the file for Import groups has to
  come from the Magento admin.
- The **Status** switch in each row enables or disables the product
  straight away.
- Tick rows (they stay ticked across pages) to **Enable**, **Disable**,
  **Add to category…** or **Remove from category…** all at once. Anything
  that fails stays ticked, with the reason shown.
- Click a row to edit it in the side pane: status, visibility, name, price,
  special price (blank clears it), weight, URL key, categories, short
  description, description (HTML), meta title and meta description. Only
  the fields you changed are sent. **Save to Magento** (or Ctrl+S) saves,
  and **Revert** throws the edit away.

**Categories** shows the tree with each category's product count. Click a
name to rename it (Enter or click away saves, Esc undoes), switch it active
or inactive, or **View products** to see the products in it.

**Orders** (read-only) lists the store's orders, newest first: order #,
placed (your local time), customer (Guest when they didn't sign in), email,
status, items, total, ship-to, payment and shipping. Filter by **Status**
(the header funnel — only statuses in use, with counts) and when placed
(All / Today / 7 / 30 days); search order #, name or email; sort by a
column; page through. Click an order for its items (shipped, canceled,
refunded), totals, billing and shipping addresses, shipments with tracking
numbers, and its comment history.

**Customers** lists accounts: name, email, group, company, Is Activated,
orders, location, phone, joined. Orders counts what each placed with their
account (guest checkouts aren't tied to one), worked out for the page shown
— 10 customers per call to Magento, side by side. Filter by **Group** (only groups with customers),
by **Is Activated** (the column's funnel, or the toolbar's All / Activated /
Not activated — for a choice field, Activated is the approved / active /
yes options and Not activated the rest) and by when they joined; search
name or email.

Company and Is Activated aren't Magento's own customer fields, so the app
finds them in the store's customer fields by their labels: Company prefers
the account's Company field and falls back to the address's company; Is
Activated shows as a switch (a yes / no field) or a dropdown (a choice like
Pending / Approved), headed with whatever the store calls it. **Changing it
saves straight to Magento** — from the table or the customer's pane;
deactivating asks first. This is the only customer edit the app makes, and
it needs the **Customers → All Customers → Actions → Edit** permission. If
no such field is found, the app lists the store's customer fields so the
right one can be picked. Click one for their details,
saved addresses, and orders (newest 100) with what they've spent; click an
order there to open it — and from an order, its customer's name opens
them. Back returns.

**Business License**: a file field in the customer's Account Information
(found by its label), required at sign-up — the pane gives the file's name.
Magento's API can't hand over the file itself (customer uploads are served
only to the signed-in admin), so it's viewed in the Magento admin: the
open-in-new-window icon beside each customer's name (and beside the
license's name in the pane), and **Open in Magento** on customer and order
panes, go straight to that customer's or order's admin page.
For those links, add the **`MAGENTO_ADMIN_URL`** secret in Supabase — the
admin panel's address, e.g. `https://www.mioumuse.com/admin_x7k2` — and in
Magento set Stores → Configuration → Advanced → Admin → Security → **Add
Secret Key to URLs** to **No** (otherwise links land on the Dashboard).

Right-click an order # or email to copy it. Export CSV and Table view work
on both. These need the integration's **Sales → Operations → Orders**
(and **Shipments**, for tracking) and **Customers → All Customers**
permissions (plus **Customers → Customer Groups** for group names); a
missing one is named in the table.

Saves are made at the "All Store Views" scope — the default values, as in
the Magento admin with no store view chosen. A store view that overrides a
value (a translated name, say) keeps its own.

### Setup (one time)

1. Magento admin → System → Extensions → **Integrations** → Add New
   Integration. Name it (e.g. "Mioumuse"), and under API give it
   **Catalog → Inventory → Products** and **Categories**. Save, then
   **Activate** → Allow, and copy the **Access Token**.
2. Magento 2.4.4 and later: Stores → Configuration → Services → OAuth →
   Consumer Settings → **Allow OAuth Access Tokens to be used as standalone
   Bearer tokens** → Yes.
3. Add the secrets in Supabase (Project → Edge Functions → Secrets):
   `MAGENTO_BASE_URL` (the store's address, e.g. `https://shop.example.com`)
   and `MAGENTO_ACCESS_TOKEN`.
4. Deploy the function:

```bash
supabase functions deploy magento --project-ref anzrcautqhbxdyobdyxp --use-api
```

Until then the tab shows "Not connected" with the reason.

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
**Import Excel** (header menu ⋮) reads the .xlsx in the browser (SheetJS, loaded only when
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
and blank rows between styles) is skipped. Before anything is saved, every
change is listed under three tabs — the count boxes across the top (the file and a search box sit in the window's header):

- **Update** — a Style # + Color already there whose fields changed, each
  change side by side (Status ACTIVE → SOLDOUT).
- **New Styles** — a Style # seen for the first time (every color of it).
- **New Colors** — a new color of a Style # that's already there in another
  color; the row lists the colors it already has.

Confirming saves only new and changed styles. Styles missing from a newer file are left as they are.

Each import that saves anything is recorded in full. **Update history**
(header menu ⋮, on the Styles tab) lists them newest first — when, which
file, and how many updated / new / unchanged — and opening one shows its
Update, New Styles and New Colors tabs again — click a row for the style's detail window. Each row has the Styles table's **+ Need to Shoot**, and the two New tabs have **Add all to Need to Shoot** (everything on the tab, as searched; ones already waiting are skipped). Records live in the `style_imports` table (see
`supabase-schema.sql`); imports made before it was added aren't recorded.

**IHD** (in-house date) is edited right in the Styles table. It shows as
MM/DD/YY, and the first click selects the whole date, so it can be copied
or pasted over. A typed or pasted date (10/28/26, 10/28/2026, 2026-10-28,
10/28 for this year, or bare digits: 1028, 102826, 10282026) saves on Enter or when you leave the cell, and Esc
undoes it. The calendar button picks a date, and ✕ (on hover) clears it.
It isn't part of the ATS export, and re-importing never touches it.

Banner Style # fields look styles up as you type: suggestions, the style's
colours, and its description and status under the row and in the banner pane.

Styles live in the `styles` table (see `supabase-schema.sql`), keyed by
user + Style # + Color, and are loaded 1,000 rows at a time.

### Style photos

Photos come straight from a folder on the network — nothing is uploaded.
In the Styles tab, the header menu's **Link image folder** picks the folder (Chrome or Edge;
browsers only let a website read a folder the user chooses). Subfolders are
searched too. File names say what each photo is:

```
STYLE COLOR NUMBER.ext        D1898 WHITE.BROWN 4.jpg
```

Separated by spaces; a `/` in the colour is written `.` (so `WHITE.BROWN`
is `WHITE/BROWN`); colours can contain spaces; the number is optional and
orders a style's photos. jpg, jpeg, png, webp and gif are read; anything
else is ignored.

Photos show as thumbnails in the Styles table (click a row for all of
them), beside each Style # in the banner form, and in the banner pane. The
folder and its list of file names are remembered in the browser; after a
restart the browser may ask for permission again (**Reconnect image
folder** in the header menu, one click — or choose "Allow on every visit"). **Rescan image folder** picks up
new or renamed files straight away; a rescan also runs in the background on
each visit. Only computers that can reach the server see the photos.

## Photoshoots

**Need to Shoot** is a flag on a Style # + Color. Tick styles in the Styles
tab (the header box ticks everything in the current view) and use **Add to
Need to Shoot**, or add one style at a time with the **+ Need to Shoot**
button in its Shoot cell (**+ Shoot again** for one that's been shot). The
Photoshoots tab lists them with where each stands:

| Status | Meaning |
|---|---|
| To shoot | On the list, not in any planned shoot |
| Scheduled · date | In a planned shoot — the earliest one's (tentative) date |
| Shot · date | In a shoot that was marked complete — off the list (shown with **Show shot**) |

From the list, ticked styles can go into a **new photoshoot** (date, studio
or editorial, model, optional name, notes), be **added to an existing**
planned shoot, or be **removed from the list**. A shoot opens in a side
pane, where styles that weren't shot can be taken out before **Mark shoot
complete**, which records every style left in it as shot. **Reopen** undoes
that and puts them back on the list; deleting a completed shoot does the
same. Adding a shot style to the list again flags it to be shot again.

IHD shows (and can be edited) on Need to Shoot and in the shoot pane, and
the Shoots list shows each shoot's latest IHD. A style whose IHD is after its
shoot date is flagged **IHD after shoot** — the goods won't be in yet.

IHD (and Latest IHD on Shoots) also filters by month: click the funnel at
the right of the header and tick the months to show. **No IHD** covers
styles without one. A filtered header turns dark; tick everything (Select
all) to remove the filter. The Need to Shoot PDF names the months it covers.

Need to Shoot and Shoots sort by clicking a column header: ascending, then
descending, then back to the default order. Blank values always sort last.

### Exports

- **Need to Shoot**: the header menu's **Export CSV** or **Export PDF**. Both cover
  the list as it's showing, with the filters and search applied. The PDF
  is sorted by IHD, earliest first, with styles that have no IHD at the end.
- **A shoot's ⋯ menu**: **Export CSV** (every style in the shoot) or **PDF
  report**. The report has the shoot details and notes, plus a ☐ Shot
  column to tick on set.
- PDF reports open the print window: choose **Save as PDF**. Style photos are
  included when the image folder is linked, and late IHDs print in red.
  Reports print on Letter paper (portrait) with dates as MM/DD/YY.
- The header menu's **Export CSV** follows the page you're on:
  - Need to Shoot: the list.
  - Shoots: the open shoot, or every shoot with its styles.
  - Styles: the filtered styles.
  - Platforms: banners.
  - Magento → Products: every product matching the filters, search and
    sort (all pages, fetched from Magento 200 at a time), with color,
    each Grouped item's simple-item count and SKUs, category paths, prices,
    stock and image URLs.
  - Magento → Categories: the category tree as shown.
  - Anywhere else: the campaign and trade show schedule.

Data: `shoot_list` (the flag, plus which shoot it was shot in) and
`photoshoots` (see `supabase-schema.sql`).
