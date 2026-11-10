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
| `js/styles.js` | Styles tab — the style database table, Category / Season / N41 Status / IHD header filters, No photos button, search |
| `js/style-import.js` | Import CSV — reads the N41 style export in the browser, lists every change under Update / New Styles / New Colors tabs, saves, and records it for Update history |
| `js/style-images.js` | Style photos from a linked network folder — matched by file name, thumbnails, gallery |
| `js/sample-photos.js` | Sample photos: a second linked folder, written to when an image file is dropped on a style with no model photos |
| `js/style-pane.js` | The style pane — a style's details, POs and photos, opened from Styles, Need to Shoot and POs |
| `js/photoshoots.js` | The Photoshoots and Need to Shoot pages — the shoots list, the Need to Shoot list, the shoot side pane, shoot status badges |
| `js/complete.js` | The Complete page — the history of styles shot (photoshoot) or made in CG, filtered by how |
| `js/production-import.js` | Import Production Sheet — reads the production .xlsx and marks each Style # + Color with a TOP date as TOP |
| `js/purchase-orders.js` | The POs page — importing N41's PO export, New / Recut / New Color, the month list (counts of styles without photos, auto-archiving), POs by ETA month with each colour and its shoot buttons |
| `js/photoshoot-form.js` | Create / edit photoshoot modal |
| `js/magento-sales.js` | Magento → Orders and Customers (read-only): lists with Status / Group filters, date quick filters, search, sort, paging; the order / customer pane |
| `js/magento-n41.js` | Magento → Orders against N41: Import N41 Sales Orders, N41 Status, the Closed on N41 filter, tick orders and cancel them on Magento |
| `js/magento-groups.js` | ⋮ menu on Magento Products → Import Groups: reads a Magento product export's `associated_skus` and saves the exact group links; the "Not in group" flag |
| `js/magento.js` | Magento tab — live products (filters, sort, paging, status switch, bulk changes, edit pane) and categories (rename, active, jump to products) |
| `supabase/functions/magento/` | Edge Function the app calls for Magento; holds the store address and token (secrets `MAGENTO_BASE_URL`, `MAGENTO_ACCESS_TOKEN`) |
| `js/column-filter.js` | Header filters (the PO app's design): click a column's funnel to tick which values show — used for IHD by month and the Magento products table |
| `js/shortcuts.js` | Keyboard shortcuts on table pages: ← / → turn pages, Space jumps to search |
| `js/row-quick-select.js` | Quick select: click / Ctrl / Shift / drag to pick rows on tables with tick boxes, Space ticks them |
| `js/copy-menu.js` | Right-click → Copy: style numbers (Styles, Need to Shoot, the shoot pane) and Magento product names |
| `js/table-view.js` | Header menu → Table view: show / hide and reorder any table's columns, saved as that table's default to your account (`table_views`) |
| `js/table-pager.js` | Paging for Styles and Need to Shoot: the footer's First / Prev / Next / Last and rows per page (remembered per table) |
| `js/exports.js` | CSV downloads and printable (Save as PDF) reports — each photoshoot, Need to Shoot, the banners, and the header menu's Export CSV / PDF |
| `js/calendar.js` | Home calendar of every campaign, show, and task, with the upcoming rail |
| `js/main.js` | Boot |

## Keyboard shortcuts

On the table pages (`js/shortcuts.js`):

| Key | Does |
|---|---|
| ← / → | Previous / next page — Magento Products, Orders, Customers, Styles and Need to Shoot. Tables that fit on one page ignore them. |
| Space | Jumps to the page's search box; text already there is selected, to type over or edit. |

They stand aside while you're typing (a text box, dropdown or checkbox),
while a window, filter or menu is open, and when Ctrl / Alt / Shift / Cmd is
held. Space on a button reached with Tab still presses it.

**Quick select** (`js/row-quick-select.js`, from the PO app) — on any table
with tick boxes (Styles, Need to Shoot, Magento Products and Orders), pick
rows like a spreadsheet, then press Space to tick them:

| Do | Picks |
|---|---|
| Click | That row (it still opens the side pane) |
| Ctrl-click (Cmd on a Mac) | Adds or takes out one row |
| Shift-click | Every row from the last one clicked; Ctrl+Shift adds the range |
| Drag over rows | The rows dragged over |
| ↑ / ↓ | Moves a single picked row |
| Space | Ticks the picked rows, or unticks them if they're all ticked (mixed: whichever most of them are) |
| Esc, or a click outside the table | Drops the picks |

Picked rows are light blue and ticked rows light green. While rows are
picked, Space ticks instead of jumping to search. Ctrl-, Shift-clicks and
drags don't open the side pane.

## Header menus

**Home**, then three menus that open on hover: **Marketing** (Campaigns, Trade
Shows, Platforms), **Photoshoots** (Styles, POs, Need to Shoot, Photoshoots, Complete) and **Magento**
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
Shoot, POs, Shoots, Magento Products).

- **Show columns**: tick or untick. The tick-box column (and on POs, the PO
  column) always stays first, and at least one other column has to.
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
  - a **Simple item** is available when it's Enabled, Salable Qty is above
    0 and In Stock (Qty ≥ 1 stands in until Salable Qty is read, or if it can't be),
    *and* its group is Enabled and In Stock — an item in no group, or in an
    unavailable group, doesn't show;
  - a **Grouped style** is available when it's Enabled and In Stock (it has
    no qty), *and* at least one of its items is available.
  The column says Available / Not available and why not ("ATS 0", "Group
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
  links come from a product export instead. **Import Groups** (⋮ menu on
  Products) reads the file in the browser — it's never uploaded — and saves only the
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

**Orders** lists the store's orders, newest first: order #,
placed (your local time), customer (Guest when they didn't sign in), email,
status, items, total, ship-to, payment and shipping. Filter by **Status**
(the header funnel — only statuses in use, with counts) and when placed
(All / Today / 7 / 30 days); search order #, name or email; sort by a
column; page through. Click an order for its items (shipped, canceled,
refunded), totals, billing and shipping addresses, shipments with tracking
numbers, and its comment history. Each item shows a thumbnail (its group's
if it has none of its own); click it to open the product in Products.

**Orders against N41.** Canceling on N41 doesn't reach Magento, so those
orders stay Pending or Processing there. **Import N41 Sales Orders** (⋮ menu
on Orders) reads N41's Sales Orders report in the browser (.xlsx, .xls or
.csv): column C Cust. Name, column H Order # (the SO #), column I Status,
column P Cust. PO #. Only
`Web:00000061`-style POs count; each is matched to the Magento order number,
leading zeros aside. An order on several rows is Closed only if every row
is. A preview shows the counts before **Update N41 Status** saves them
(`n41_orders`); orders not on the report keep the status they have.

Orders then shows **N41 Status**, **N41 Customer** and **N41 Order #**, and
an order that's Closed on N41 but
Pending or Processing on Magento is flagged in red. **Closed on N41 (n)**
filters to those. Tick orders (Pending and Processing ones have a box; ticks
stay across pages) and **Cancel orders** cancels them on Magento, after a
confirmation — this can't be undone. Magento cancels everything not invoiced
yet: with nothing invoiced the order becomes Canceled; with invoiced items
it becomes Complete, or stays Processing while invoiced items are still to
ship. An order with every item invoiced has nothing to cancel and is
reported as such. Import a fresh report after N41's invoices have reached
Magento: an invoice that hasn't arrived yet looks uninvoiced, and those
items would be canceled. Needs the integration's **Sales → Operations →
Orders → Actions → Cancel** permission.

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
deactivating asks first. **Company** can be edited in the customer's pane
(Enter or clicking away saves, Esc undoes): it changes the main address's
company, which is what Magento's Customers table shows, and the account's
Company field if the store has one. Existing orders keep their own copy.
Both edits need the **Customers → All Customers → Actions → Edit** permission. If
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

**Events** (Magento menu → Events) are the store's events — from its events
extension, not Magento itself — and each one is a trade show. Add, edit and
delete them here: Title, Content, Start, End and Status save straight to
Magento. The extension's routes and field names aren't known ahead, so the
helper reads them from the store's own API map (`eventsApi` shows what it
found). Each event's **Trade show** comes from the app's trade show on the
same dates, or else from its name ("MAGIC Las Vegas Feb 2027" → Magic Las
Vegas); saving an event adds or moves that trade show in the app, and
**Add to Trade Shows** does it for an existing one. Deleting an event
leaves the app's trade show alone.

Dates: the extension keeps a date and time in UTC and the admin shows it in
the store's time zone, so an event saved at UTC midnight shows the evening
before (Oct 19 → "Oct 18, 5:00 PM"). The app saves the store's midnight
instead, and **Fix dates** re-saves the events saved the old way — the days
don't change. The time zone is the store's (Stores permission), else the
`MAGENTO_TIMEZONE` secret, else America/Los_Angeles. Needs the
integration's **Events** and **Manage Events** permissions.

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

The **Styles** tab holds every Style # + Color from N41's Style Master.
**Import CSV** (header menu ⋮) reads it in the browser (SheetJS, loaded
only when importing) — the file itself is never uploaded. The Style Master
(.csv or .xlsx, headings in row 1: style, color, status, availableDate…):

| Column | Field |
|---|---|
| A | Style # |
| B | Color |
| C | N41 Status |
| D | Available — the month only, shown as a JUL 26 pill |
| F | Season |
| J | Description |
| K | Memo — the "updated by Mass Update" notes N41 adds are dropped |
| R | Received qty |

The CSV has no category, so a style keeps the category it has (new ones get
none). Available shows as a column in the Styles table; Available, Rcvd Qty
and Memo show in the style pane. They need three columns on the styles table
— run the `available_date` / `memo` / `received_qty` lines in
`supabase-schema.sql` first.

**Magento Status** (Styles table, sits left so the style pane fits beside it;
also in the style pane): is the colour showing on the webstore? Its Magento
item is the SKU `STYLE#-COLOR` (or `STYLE#ST-COLOR`), checked by the same
rules as the Magento tab's Available column — *Available*, *Not available*
(why not in the tooltip) or *Not on Magento*. Last time's Magento catalog
shows at once; a fresh check runs once per visit.

Only the Style Master is read — the old ATS report isn't accepted any more.
Any row without a Style # is skipped. Before anything is saved, every
change is listed under three tabs — the count boxes across the top (the file and a search box sit in the window's header):

- **Update** — a Style # + Color already there whose fields changed, each
  change side by side (Status ACTIVE → SOLDOUT).
- **New Styles** — a Style # seen for the first time (every color of it).
- **New Colors** — a new color of a Style # that's already there in another
  color; the row lists the colors it already has.

Confirming saves only new and changed styles. Styles missing from a newer file are left as they are.
Deleted styles in the file are skipped (the line under the title counts them).

**Deleting styles:** tick them in the Styles table and click **Delete**. A
deleted Style # + Color stays in the database, marked with `deleted_at`, but
it's left out everywhere in the app (Styles, Need to Shoot, POs, banners),
and an import skips it, so it doesn't come back. Any still waiting on Need to Shoot come
off it. The trash button in the toolbar (there once something's deleted)
shows the deleted styles instead; tick some and **Restore** brings them
back. Needs the `deleted_at` SQL in `supabase-schema.sql`.

Each import that saves anything is recorded in full. **Update History**
(header menu ⋮, on the Styles tab) lists them newest first — when, which
file, and how many updated / new / unchanged — and opening one shows its
Update, New Styles and New Colors tabs again — click a row for the style's detail window. Each row has the Styles table's shoot buttons, and the two New tabs have **Add all to Need to Shoot** (as New Style or New Color) (everything on the tab, as searched; ones already waiting are skipped). Records live in the `style_imports` table (see
`supabase-schema.sql`); imports made before it was added aren't recorded.

**Notes** on each Style # + Color are typed right in the Notes column of
the Styles, Need to Shoot or POs table, or in the style pane's bigger box.
They save when you leave the box (or press Enter in the table); Esc undoes.
The Styles search covers them, and importing never touches them. Needs
the `notes` SQL in `supabase-schema.sql`.

**IHD** (in-house date) is edited right in the Styles table. It shows as
MM/DD/YY, and the first click selects the whole date, so it can be copied
or pasted over. A typed or pasted date (10/28/26, 10/28/2026, 2026-10-28,
10/28 for this year, or bare digits: 1028, 102826, 10282026) saves on Enter or when you leave the cell, and Esc
undoes it. The calendar button picks a date, and ✕ (on hover) clears it.
It isn't part of the Style Master, and re-importing never touches it.

The table filters from its **Category**, **Season**, **N41 Status** and
**IHD** headers (COMPANY, CANCEL and INACTIVE start unticked under N41 Status). The
**No photos** button (crossed-out picture) shows only colours with no photos
that aren't COMPANY, CANCEL or INACTIVE; it needs the image folder linked.

**TOP** comes from the production sheet: menu ⋮ → **Import Production
Sheet** (Styles or POs) and pick the .xlsx. Every tab is read; columns are
found by their headings (STYLE #, PO#, COLOR, TOP 1 … IN DATE — H, I, J and
Z if not), merged cells are filled in from their top cell, a colour's code
after a line break ("COCOA BEAN
#CA049") is dropped, and blank rows are
skipped. A date in the TOP column marks that Style # + Color as TOP; a blank
changes nothing, so TOP is never taken away. Rows match by Style # (with or
without a trailing ST) and colour, compared on letters and digits only; when
the colour doesn't match, the PO # is looked up in the N41 POs for that
style's colour. The window lists what will be marked, dated rows that match
no style, and TOP cells that aren't dates, and saves only on confirm
(`top_date` / `top_po` — run the styles SQL in `supabase-schema.sql`; the
latest date wins). A yellow **TOP** pill then shows in the Shoot column
everywhere, with the date and PO on hover.

Banner Style # fields look styles up as you type: suggestions, the style's
colours, and its description and status under the row and in the banner pane.

Styles live in the `styles` table (see `supabase-schema.sql`), keyed by
user + Style # + Color, and are loaded 1,000 rows at a time.

### Style photos

Photos come straight from a folder on the network — nothing is uploaded.
In the Styles tab, the header menu's **Link image folder** picks the folder (Chrome or Edge;
browsers only let a website read a folder the user chooses). Subfolders are
searched too, except ones that never hold style photos: `00 SHOOTS`,
`01 EDITORIAL SHOOTS`, `EDITORIAL edits`, `STYLE NOT IN DATABASE` and
`DUPLICATES` (`STYLE_IMAGE_SKIP_FOLDERS` in `js/style-images.js`; matched by
name, so renaming one of them means updating that list). File names say what
each photo is:

```
STYLE COLOR NUMBER.ext        D1898 WHITE.BROWN 4.jpg
```

Separated by spaces; a `/` in the colour is written `.` (so `WHITE.BROWN`
is `WHITE/BROWN`); colours can contain spaces; the number is optional and
orders a style's photos. jpg, jpeg, png, webp and gif are read; anything
else is ignored.

**Reshoots:** a photo with RESHOOT in its name (`D2927 BLACK 1 - RESHOOT.jpg`,
`P3791 BLACK 1 - RESHOOT (3).jpg`, `… (RESHOOT) 2.jpg`, `… 2 (RESHOOT).jpg`)
replaces the original shoot: once a colour has any RESHOOT photos, only
those show, thumbnail included, in number order (a `(3)` copy number after
the tag orders copies of one number).

Photos show as thumbnails in the Styles, Need to Shoot and POs tables, beside each Style # in the banner form, and in the banner pane. The
folder and its list of file names are remembered in the browser; after a
restart the browser may ask for permission again (**Reconnect image
folder** in the header menu, one click — or choose "Allow on every visit"). **Rescan image folder** picks up
new or renamed files straight away; a rescan also runs in the background on
each visit. Only computers that can reach the server see the photos.

### Sample photos

Styles whose studio / CG pictures aren't in the model photo folder yet can
have a **sample photo** standing in. Make a separate folder for them on the
server (e.g. SAMPLE PHOTOS — not inside the model photo folder, or they'd
be read as model photos), then Styles → menu ⋮ → **Link Sample Photo
Folder** (or the button in the style pane) and allow editing when Chrome
asks. Reconnect, Rescan and Unlink work like the model photo folder.

**Linking by hand** — the photos can be called anything (IMG_4412.JPG).
Click a style's empty photo box (in any table or a shoot's style list), or
open its pane and, under Photos, click **Browse sample photos…**. The browser shows the image files directly
in the folder (subfolders are skipped), and it opens already searching file names for the style number
(clear the search box to see every photo). **Hide linked** leaves out photos already used. Click a photo
to see it larger, then **Use for STYLE · COLOR** (or double-click it).
Photos already linked say which style they're for. **Change…** /
**Unlink** in the pane swap or remove a link; the file itself is never
touched. Links are saved in Supabase (the `sample_photo_links` table, in
`supabase-schema.sql`), so they show on any computer with the folder linked.

**Dropping a file** — drag an image file from Explorer onto a style's empty
photo box (Styles, Need to Shoot, POs, Complete, a shoot's style list) or
onto the box under Photos in the style pane. It's saved into the folder as
`STYLE COLOR.jpg` and linked. A photo named `STYLE COLOR.jpg` is also used
without linking. Samples show
with a gold "Sample" tag, open in the gallery and style pane, and print in
the PDF reports. Once the style has model photos those show instead — the
sample file stays in its folder. A sample doesn't count as a photo for
"no photos" checks (POs, Need to Shoot).

## Photoshoots

**Need to Shoot** is a flag on a Style # + Color, with a reason: **New
Style**, **New Color** or **Reshoot**. Any of the three puts the style on the
list. In the Shoot cell (Styles, Need to Shoot, POs) they're icons — a
T-shirt for New Style, a paint bucket for New Color, a camera for Reshoot —
and the filled one is the reason it's waiting: click it again to take the
style off, or another to change the reason. A dashed outline is the
suggested reason. To flag many,
tick styles in the Styles tab and use the **Need to Shoot: New Style / New
Color / Reshoot** buttons. Need to Shoot also filters by reason (the same three icons).
The months down the left of Need to Shoot filter the list: **Show
all**, **No month**, then each month some style on the list arrives in, in a
folder per year (click a year to open or close it), with its style count.
A style's month is its **Available** month (N41 keeps an ETA at 1/1 of the
year until the real in-house date is set), or its IHD's month when it has
no Available. Available belongs to the colour, not the PO, so a recut can
carry an old one: an Available month before the PO's own date doesn't
count, and the ETA's month is used.

After the buttons, a scheduled or shot date shows with a camera, lined up
at the left of its half of the cell — click it to open that photoshoot on
the Photoshoots page. The yellow **TOP** pill (from the production sheet)
has its own narrow space after that, there and in a shoot's style list, so
the buttons and dates line up whether a style has TOP or not.

The **⋮** after the shoot buttons (Styles, Need to Shoot, POs, the style
pane) has **Add to Photoshoot** — a planned shoot, or a new one — and **Mark
as Complete**, for pictures made in Photoshop or with AI: the style is done
and logged as CG today.

**Complete** (Photoshoots → Complete) is the history of every style that got
its pictures from now on: one row each time, newest first, with how —
**Photoshoot** (when its shoot is marked complete; reopening the shoot takes
those rows back out) or **CG** — the reason, the shoot and the date. Filter
by Photoshoot or CG, search, sort by any column. A CG row has **Undo**, which
puts the style back on Need to Shoot. Needs the `style_completions` SQL in
`supabase-schema.sql`.

**Style pane**: click a style on Styles, Need to Shoot or POs and it opens on
the right — description, category, season, N41 status, IHD (editable unless
it comes from POs), the shoot buttons and the colour's POs (folded to a
count — click to see each PO with its PO date and ETA), then every photo of it, one under
the other (click one for full size). Esc or ✕ closes it.

### POs

The **POs** page (under Photoshoots) shows N41's PO lines a month at a time.
How the dates fit together:

- A style colour's **Available** month (Style Master) is its tentative IHD.
- A PO's **ETA** is 1/1 of a year until it's confirmed (shown as "–");
  confirmed, it should fall in the Available month.
- **Closed** means the PO was received.

A PO is filed under **one month**, all of its styles and colours together:

- a confirmed ETA → that ETA's month;
- a **Closed** PO still on a 1/1 ETA → the date it was received
  (`first_rcv_date`), shown as its ETA;
- an Open PO still on 1/1 → the Available month most of its colours share
  (an Available from before the PO date belongs to an older cut and doesn't
  count), else the 1/1's month.

A small amber **flag** by the ETA (hover for why) marks a Closed PO whose
N41 ETA was never updated from 1/1, and a Closed PO whose ETA is still in
the future. An Open PO on a 1/1 ETA is just waiting and isn't flagged.

A colour's **Available** pill turns **amber** (POs, Styles, the style pane)
when its newest PO is still **Open** and filed under another month — hover
for the PO and its ETA. Once the PO is received, it goes back to grey.

A flagged PO has a **delete** (bin) button at the end of its line. Deleting
a PO # for a style hides it from the POs page, its month counts, the IHDs and
New / Recut / New Color; it's kept in its own table (`n41_po_deleted`), so
importing N41's POs again doesn't bring it back. Tick **Show deleted POs** to
list them (every month) and restore one.

Each style has a row with its Style # and description, then the
colours on its POs that month under it (photo, Available pill, shoot buttons, N41 status),
with its POs in a box down the first column: **PO #**, its IHD (the ETA) and
a **New** / **Recut** / **New Color** pill (**Recut + NC** when a PO has
both; hover for the PO date and colours). Filter by **New** / **Recut** /
**New Color**, by **All** / **Has photos** / **No photos** (needs the image
folder linked). **No photos** lists every colour without a model photo; tick **Show same
style** to also list the colours of those styles that already have one. **Export PDF**
(menu ⋮) prints the month as it's showing — one row per colour with its
photo, PO # · ETA and status, type, Available, N41 status and shoot status.
Colours with N41 status COMPANY — and POs with only those — are
hidden unless **Show Company POs** is ticked.

**Search** looks through every month's POs (Style #, PO #, colour,
description, status), each style with all of its POs; the menu beside the
search box switches to **This month** to search just the month picked.

**Importing:** menu ⋮ → **Import N41 POs** and pick N41's PO export
(`po.xls`, headings in row 1). It's the only layout read; these columns are
used, found by their headings (the letters if a heading moves):

| Column | Heading | Field |
|---|---|---|
| A | dstatus | Status — Open / Closed (received) |
| B | pono | PO # |
| D | eta | ETA |
| E | style | Style # |
| F | color | Color |
| — | po_date | PO date (orders the POs for New / Recut / New Color) |
| — | first_rcv_date | Received date — the ETA of a Closed PO never updated from 1/1 |

An ETA typed with a wrong year (4021 for 2021) gets the year nearest its PO
date. Each PO shows its status (**Open**, **Closed**, or **Part closed** when
its colours differ) beside its ETA. The POs in the file replace the
saved ones and every other PO is kept, in the `n41_po_lines` table (see
`supabase-schema.sql`). The cost sheet and the old N41 PO report
(`po_lines`, `po_colors`) aren't used any more.

**New / Recut / New Color** is worked out per style, from its POs in PO-date
order: everything on the style's first PO is **New**; on a later PO, a colour
that was on an earlier one is a **Recut**, and one that wasn't is a **New
Color**.

**IHD comes from the ETAs.** A style + colour on any PO shows the next ETA
from today as its IHD, or the latest if they've all passed (shown grey). It
moves on by itself the day after an ETA passes. It's shown, not typed in —
hover it for every PO and its ETA. A style + colour on no PO keeps the IHD
typed in for it.

The months are listed down the left of the page, oldest first, in a folder per
year (click a year to open or close it); click one to show it. Each month's
count is its styles that still have a colour **without model photos** —
skipped are COMPANY, CANCEL and INACTIVE colours, Style #s made for another
company (a name after a hyphen, like MMP469-VESTIQUE — but not a single
letter or number, like MMT1290-1), and colours not in the Styles database.
Those are never suggested for Need to Shoot either. A month where every colour has model photos is **archived on its
own** (shown with a ✓): it moves to the **Archived** group at the bottom of
the list (click it to open), still viewable, and comes back if a colour there
needs photos again. Without the image folder linked, photos aren't known: the
count is all of the month's styles and nothing is archived. (The old
`po_month_archive` table isn't used any more.)

Suggestions (a pale fill on the button) are only for colours with no photos:
**New Style** for a New colour, **New Color** for a Recut or New Color one. Colours already
waiting or with N41 status CANCEL or INACTIVE aren't suggested, and nothing is without the image folder linked.
A note under the toolbar counts the month's colours with no photos that aren't
on Need to Shoot; **Show them** (or **Suggested**) filters the page to just
those, and then **Add suggested to Need to Shoot** appears to add them all. Reshoot is
always chosen by hand. **Need to Shoot** filters the page to the colours already
waiting on Need to Shoot (not yet shot).

A cost-sheet style is matched to the Styles database by its base Style #
(`T6941-RE4` → `T6941`, `J5937(B)` → `J5937`, and `P5674ST` falls back to
`P5674`). One that doesn't match shows **Not in the Styles database**.

Styles with N41 status **COMPANY** never need a shoot (`NO_SHOOT_STATUSES`
in `js/config.js`). They show "No shoot needed", every add skips them, and
they can't go into a photoshoot. One that was on the list before is hidden.

The Photoshoots tab lists them with where each stands:

| Status | Meaning |
|---|---|
| New Style / New Color / Reshoot | On the list, not in any planned shoot |

| Scheduled · date | In a planned shoot — the earliest one's (tentative) date |
| Shot · date | In a shoot that was marked complete — off the list, on **Complete** |
| CG · date | Marked complete by hand (made in Photoshop or with AI) — off the list, on **Complete** |

From the list, ticked styles can go into a **new photoshoot** (date, studio
or editorial, model, optional name, notes), be **added to an existing**
planned shoot, or be **removed from the list**.

The **Photoshoots** page lists the shoots down the left (date as M/D, name,
type and how many styles) under Planned / Complete / All and the search. The
one picked fills the rest of the page; the first one listed is picked when
you open the page. Its date, type, model, style count (and when it was
completed) are on the line under its name, with its notes below. Its styles
are numbered, in columns: photo, Style # (its Color beside it), the New
Style / New Color / Reshoot buttons (as on Need to Shoot; fixed on a
completed shoot), Description, Category and IHD. To change the order, drag
a style by its grip (⋮⋮), or click the small ↑ / ↓ buttons beside its number
to swap it with the one above or below. Clicking a style's row opens its
style pane on the right (the shoot moves over to make room, dropping
Description and Category, then IHD, when it gets narrow). The new order is saved with the shoot (the CSV and
PDF follow it).
Styles that weren't shot can be taken out before **Mark shoot complete** (in
the shoot's ⋮ menu), which records every style left in it as shot. **Reopen
shoot** (same menu) undoes that and
puts them back on the list; deleting a completed shoot does the same. Adding
a shot style to the list again flags it to be shot again. Opened from the
Home calendar, a shoot still shows in a side pane.

IHD shows (and can be edited) on Need to Shoot and in the shoot's style list.

IHD also filters by month: click the funnel at
the right of the header and tick the months to show. **No IHD** covers
styles without one. A filtered header turns dark; tick everything (Select
all) to remove the filter. 

Need to Shoot and Shoots sort by clicking a column header: ascending, then
descending, then back to the default order. Blank values sort last — except
IHD: soonest first puts the ones with no IHD at
the top.
Need to Shoot's default order is IHD, soonest first (no IHD on top).

### Exports

- **Need to Shoot**: the header menu's **Export CSV** or **Export PDF** covers
  the list as it's showing, with the filters and search applied. The PDF
  has each style's photo, shoot type, IHD and whether it's scheduled.
- **Platforms**: the header menu's **Export PDF** lists the banners showing,
  with their images.
- **A shoot's ⋯ menu**: **Export CSV** (every style in the shoot) or **PDF
  report**. The report has the shoot details and notes, plus a ☐ Shot
  column to tick on set, the styles in the shoot's order.
- PDF reports open the print window: choose **Save as PDF**. Style photos are
  included when the image folder is linked. The shoot
  type prints as the three New Style / New Color / Reshoot icons, the
  style's one lit, with a key above the table.
  Reports print on Letter paper (portrait) with dates as MM/DD/YY.
- The header menu ⋮ follows the page you're on (Sign Out is always there,
  and pages with a table also get **Table View**):
  - Home, Photoshoots, Magento → Categories: nothing else.
  - Campaigns, Trade Shows: **Export CSV**, that page's records and tasks.
  - Platforms: **Export PDF**.
  - Need to Shoot: **Export CSV** and **Export PDF**, the list.
  - POs: **Import N41 POs** and **Import Production Sheet**.
  - Styles: **Import CSV**, **Import Production Sheet**, **Export CSV** (the filtered styles), **Update
    History**, and the image folder's Link / Reconnect / Rescan and Unlink.
  - Magento → Products, Orders, Customers: **Export CSV**. Products: every
    product matching the filters, search and sort (all pages, fetched from
    Magento 200 at a time), with color, each Grouped item's simple-item
    count and SKUs, category paths, prices, stock and image URLs.

Data: `shoot_list` (the flag and its reason, plus which shoot it was shot in),
`photoshoots` and `n41_po_lines` (see `supabase-schema.sql`).
