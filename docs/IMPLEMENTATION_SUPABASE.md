# Phase 1 — Supabase Database Schema

> Everything needed to set up the database before any frontend work begins.

---

## Overview

Create 4 new tables in Supabase for the driver order system. These are **separate** from the existing `orders` table used by the customer storefront.

---

## Tables

### `drivers`

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | Primary key |
| `code` | text | — | **Unique**. Login code (e.g., `carlos01`, `maria02`). Case-insensitive lookup |
| `name` | text | — | Display name (e.g., "Carlos") |
| `phone` | text | `null` | Optional phone number |
| `is_active` | boolean | `true` | `false` = disabled (can't log in, but history is kept) |
| `language` | text | `'en'` | Preferred language: `'en'` or `'es'` |
| `created_at` | timestamptz | `now()` | Auto |
| `updated_at` | timestamptz | `now()` | Auto-update via trigger |

---

### `driver_prices`

Each row = one product's price for one driver. Every product must have a price entry per driver.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | Primary key |
| `driver_id` | uuid | — | FK → `drivers.id` (CASCADE delete) |
| `product_key` | text | — | Unique identifier (e.g., `redondo_inside_pina`, `tresleche_hershey`) |
| `product_label` | text | — | Human-readable (e.g., "Redondo · Piña Inside") |
| `price` | numeric(10,2) | — | This driver's price for this product |
| `created_at` | timestamptz | `now()` | |
| `updated_at` | timestamptz | `now()` | Auto-update via trigger |

**Unique constraint**: `(driver_id, product_key)` — one price per product per driver.

---

### `driver_orders`

Each row = one individual order. Multiple orders submitted together share a `batch_id`.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | Primary key |
| `order_number` | serial | auto-increment | System order number (#1001, #1002...). **Never shown to driver during ordering** — only visible in driver's order history and to admin |
| `driver_id` | uuid | — | FK → `drivers.id` |
| `batch_id` | uuid | — | Groups orders submitted together. All orders in one submission share this |
| `batch_index` | integer | — | Position within batch (1, 2, 3...) — for "Order #1, Order #2" display |
| `driver_ref` | text | `null` | Driver's own order reference (optional, whatever they want to type) |
| `business_name` | text | `null` | Optional "delivering to" field |
| `pickup_date` | date | `null` | `null` = use submitted_at date. Label shows "Date Ordered: Mar 24" |
| `pickup_time` | time | `null` | `null` = use submitted_at time. Label shows "Time Ordered: 4:30 PM" |
| `notes` | text | `null` | Driver's notes for this order |
| `status` | text | `'pending'` | `'pending'` → `'confirmed'` → `'sent'` (sent = pushed to driver dashboard) |
| `payment_status` | text | `'not_paid'` | `'not_paid'` / `'paid'` / `'partial'` |
| `payment_amount` | numeric(10,2) | `0` | Amount paid so far. For partial: shows how much was paid. For paid: equals total |
| `total_amount` | numeric(10,2) | `0` | Calculated server-side from items × `price_at_order` |
| `submitted_at` | timestamptz | `now()` | When driver hit submit |
| `confirmed_at` | timestamptz | `null` | When admin hit Confirm & Send |
| `editable_until` | timestamptz | — | `submitted_at + 30 minutes`. Driver can edit/add orders until this time |
| `admin_editable_until` | timestamptz | `null` | `confirmed_at + 30 minutes`. Admin can correct after sending |
| `created_at` | timestamptz | `now()` | |

**Date/time display logic (for admin view):**
- If `pickup_date` is `null` → show "Date Ordered: [submitted_at date]"
- If `pickup_date` is filled → show "Pickup Date: [pickup_date]"
- If `pickup_time` is `null` → show "Time Ordered: [submitted_at time]"
- If `pickup_time` is filled → show "Pickup Time: [pickup_time]"

---

### `driver_order_items`

Each row = one line item in an order.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | `gen_random_uuid()` | Primary key |
| `order_id` | uuid | — | FK → `driver_orders.id` (CASCADE delete) |
| `product_key` | text | — | Matches `driver_prices.product_key` |
| `product_label` | text | — | Human-readable, snapshot at time of order |
| `quantity` | integer | — | Original quantity ordered by driver |
| `price_at_order` | numeric(10,2) | — | **Price snapshot at time of order. NEVER changes even if admin updates driver's prices later** |
| `adjusted_quantity` | integer | `null` | `null` = no adjustment. If admin changes qty at pickup, new value goes here |
| `adjustment_note` | text | `null` | e.g., "(+2 added at pickup)" — auto-generated when admin adjusts |
| `adjusted_at` | timestamptz | `null` | When adjustment was made |

**Effective quantity** = `adjusted_quantity ?? quantity` (use adjusted if exists, otherwise original).

---

## Product Key Reference

Every product in the order form needs a unique `product_key`. Here's the full list:

| Section | Product | product_key |
|---------|---------|-------------|
| **Redondo** | Piña Inside | `redondo_inside_pina` |
| | Piña Inside (No Ticket) | `redondo_inside_pina_nt` |
| | Piña Top | `redondo_top_pina` |
| | Piña Top (No Ticket) | `redondo_top_pina_nt` |
| | Guava Inside | `redondo_inside_guava` |
| | Guava Inside (No Ticket) | `redondo_inside_guava_nt` |
| | Guava Top | `redondo_top_guava` |
| | Guava Top (No Ticket) | `redondo_top_guava_nt` |
| | Dulce De Leche Inside | `redondo_inside_dulce` |
| | Dulce De Leche Inside (No Ticket) | `redondo_inside_dulce_nt` |
| **Plain** | Plain | `plain_plain` |
| | Plain (No Ticket) | `plain_plain_nt` |
| | Raisin | `plain_raisin` |
| | Raisin (No Ticket) | `plain_raisin_nt` |
| **Tres Leche** | Tres Leche | `tresleche_tresleche` |
| | Tres Leche (No Ticket) | `tresleche_tresleche_nt` |
| | Tres Hershey | `tresleche_hershey` |
| | Tres Hershey (No Ticket) | `tresleche_hershey_nt` |
| | Cuatro Leche | `tresleche_cuatro` |
| | Cuatro Leche (No Ticket) | `tresleche_cuatro_nt` |
| | TL Strawberry | `tresleche_strawberry` |
| | TL Strawberry (No Ticket) | `tresleche_strawberry_nt` |
| | TL Piña | `tresleche_pina` |
| | TL Piña (No Ticket) | `tresleche_pina_nt` |
| **Piezas** | Red Velvet | `piezas_redvelvet` |
| | Red Velvet (No Ticket) | `piezas_redvelvet_nt` |
| | Carrot Cake | `piezas_carrotcake` |
| | Carrot Cake (No Ticket) | `piezas_carrotcake_nt` |
| | Cheesecake | `piezas_cheesecake` |
| | Cheesecake (No Ticket) | `piezas_cheesecake_nt` |
| | Pudin | `piezas_pudin` |
| | Pudin (No Ticket) | `piezas_pudin_nt` |
| | Piña | `piezas_pina` |
| | Piña (No Ticket) | `piezas_pina_nt` |
| | Guava | `piezas_guava` |
| | Guava (No Ticket) | `piezas_guava_nt` |
| | Chocoflan | `piezas_chocoflan` |
| | Chocoflan (No Ticket) | `piezas_chocoflan_nt` |
| | Flan | `piezas_flan` |
| | Flan (No Ticket) | `piezas_flan_nt` |
| **Piezas Frostin** | Guava | `frostin_guava` |
| | Guava (No Ticket) | `frostin_guava_nt` |
| | Piña | `frostin_pina` |
| | Piña (No Ticket) | `frostin_pina_nt` |
| | Dulce De Leche | `frostin_dulce` |
| | Dulce De Leche (No Ticket) | `frostin_dulce_nt` |
| | Chocolate | `frostin_chocolate` |
| | Chocolate (No Ticket) | `frostin_chocolate_nt` |
| **HB Big** | Piña | `hb_big_pina` |
| | Piña (No Ticket) | `hb_big_pina_nt` |
| | Guava | `hb_big_guava` |
| | Guava (No Ticket) | `hb_big_guava_nt` |
| | Dulce De Leche | `hb_big_dulce` |
| | Dulce De Leche (No Ticket) | `hb_big_dulce_nt` |
| | Chocolate | `hb_big_chocolate` |
| | Chocolate (No Ticket) | `hb_big_chocolate_nt` |
| | Strawberry | `hb_big_strawberry` |
| | Strawberry (No Ticket) | `hb_big_strawberry_nt` |
| **HB Small** | Piña | `hb_small_pina` |
| | Piña (No Ticket) | `hb_small_pina_nt` |
| | Guava | `hb_small_guava` |
| | Guava (No Ticket) | `hb_small_guava_nt` |
| | Dulce De Leche | `hb_small_dulce` |
| | Dulce De Leche (No Ticket) | `hb_small_dulce_nt` |
| | Chocolate | `hb_small_chocolate` |
| | Chocolate (No Ticket) | `hb_small_chocolate_nt` |
| | Strawberry | `hb_small_strawberry` |
| | Strawberry (No Ticket) | `hb_small_strawberry_nt` |
| **Cuadrao** | Pudin | `cuadrao_pudin` |
| | Pudin (No Ticket) | `cuadrao_pudin_nt` |
| | Plain | `cuadrao_plain` |
| | Plain (No Ticket) | `cuadrao_plain_nt` |
| | Raisin | `cuadrao_raisin` |
| | Raisin (No Ticket) | `cuadrao_raisin_nt` |
| | Maiz | `cuadrao_maiz` |
| | Maiz (No Ticket) | `cuadrao_maiz_nt` |
| **Basos** | Tres Leche | `basos_tresleche` |
| | Tres Leche (No Ticket) | `basos_tresleche_nt` |
| | Cuatro Leche | `basos_cuatro` |
| | Cuatro Leche (No Ticket) | `basos_cuatro_nt` |
| | Hershey | `basos_hershey` |
| | Hershey (No Ticket) | `basos_hershey_nt` |

---

## Row-Level Security (RLS)

### `drivers`
- **Drivers**: can read only their own row (matched by auth or code lookup)
- **Admin**: full read/write

### `driver_prices`
- **Drivers**: can read only their own prices
- **Admin**: full read/write

### `driver_orders`
- **Drivers**: can read/write only their own orders + only within `editable_until` window for writes
- **Admin**: full read/write (within `admin_editable_until` for post-confirm edits)

### `driver_order_items`
- **Drivers**: can read only items belonging to their orders
- **Admin**: full read/write

---

## Realtime

Enable Supabase Realtime on:
- `driver_orders` — so admin dashboard gets live updates when new orders come in
- `driver_orders.status` changes — so driver dashboard gets notified when admin confirms and sends

---

## Checklist
- [x] Create `drivers` table with all columns
- [x] Create `driver_prices` table with unique constraint
- [x] Create `driver_orders` table with all columns
- [x] Create `driver_order_items` table
- [x] Create `updated_at` auto-update triggers
- [x] Set up RLS policies for all 4 tables
- [x] Enable Realtime on `driver_orders`
- [x] Insert a test driver (code: `test01`, name: "Test Driver")
- [ ] Insert test prices for all products for the test driver
- [x] Verify insert/select/update queries work correctly
