# MGL Food Hub

Multi-store food ordering site: 13 partner stores, one cart, **scheduled delivery only**.
Customers never log in. Admins sign in at a hidden URL.

React + Vite + TypeScript + Tailwind (shadcn-style components) · Supabase (Postgres, Auth, Storage, Realtime, RPC).

---

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Quickest: paste **`supabase/setup-all.sql`** (all three files combined; safe to re-run) into **SQL Editor → Run**. If you change a migration, rebuild that file. Otherwise, run the three migrations **in order**. Either paste each one into **SQL Editor → Run**, or use the CLI (`supabase link` then `supabase db push`):
   - `supabase/migrations/20261007000100_schema.sql`: tables, RLS, grants, the price-lock trigger, storage buckets, realtime
   - `supabase/migrations/20261007000200_functions.sql`: `place_order`, `get_order_by_token`, `find_order`, `request_cancellation`, `resubmit_gcash_proof`, `get_checkout_info`, `admin_order_action`
   - `supabase/migrations/20261007000300_seed_menu.sql`: all 13 stores, 76 sections, 414 products, 527 variants (generated, see §5)
3. **Auth → Providers → Email**: turn **off** "Allow new users to sign up".
4. Create the admin account(s): **Authentication → Users → Add user** (email + password, auto-confirm), then in the SQL editor:
   ```sql
   insert into admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   Anyone who signs in without a row in `admin_users` is signed out immediately.

## 2. Run the site

```bash
cp .env.example .env      # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

| Env var | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | anon / publishable key |
| `VITE_ADMIN_PATH` | Hidden admin login route (default `/mgl-hub-admin-portal`). **Change it** to something only your team knows. |

Admin login: `https://your-domain/<VITE_ADMIN_PATH>`. After sign-in you land on `/admin`. It isn't linked anywhere, it's `noindex`, and `/admin/*` shows a normal 404 to anyone who isn't an admin.

## 3. Add the images

| File | Used for |
| --- | --- |
| `public/logo.png` | Navbar, footer, admin login, Apple touch icon. A vector stand-in is shown until this file exists. |
| `public/menus/<slug>.jpg` | Each store's cover and "View original menu" photo |

Store slugs: `hazels-special-puto`, `aling-melys-carinderia`, `okoy-ni-jay-r`, `aurings-special-pancit-malabon`, `normas-special-pancit-bilao`, `balsa-sa-niugan`, `original-benjie-puto-pao`, `raves-diner`, `mary-jay`, `rody-days`, `anny-dading-peachy-peachy`, `judy-anns-crispy-pata`, `sisig-ni-mutik`.

Admins can also replace any store cover, menu photo or product photo from **Admin → Products & Stores** (uploads go to Supabase Storage).

## 4. Admin settings to fill in first

**Admin → Settings**: account name, number and QR image for GCash, MariBank and GoTyme (each works the same way: the customer pays, then sends the reference number and a screenshot); cutoff time (default 8:00 PM); max days ahead (default 30); blocked dates; email toggle.

## 5. Prices (fixed)

- All prices live in **`scripts/menu-data.mjs`**, transcribed from the menus. `npm run seed:generate` rebuilds the seed migration from it.
- Prices **cannot** be changed from the admin UI (column-level grants) or even from the SQL editor (a `BEFORE UPDATE` trigger on `product_variants.price/addon_price` and `option_choices.price_delta`).
- `place_order` ignores any price sent by the browser and recomputes everything from the database.

> **Needs your input:** Balsa sa Niugan → *Balsa Chicken → Buttered Half* was marked `₱[CONFIRM]` on the menu, so it is **not seeded**. When you have the price, run the `insert` shown at the bottom of `scripts/menu-data.mjs`.

## 6. Optional: email confirmations (Resend)

```bash
supabase functions deploy send-order-email --no-verify-jwt
supabase secrets set RESEND_API_KEY=re_xxx RESEND_FROM="MGL Food Hub <orders@yourdomain.com>" SITE_URL=https://yourdomain.com
```
Then turn on **Email confirmations** in Admin → Settings. The function only emails the address on the order, only once, and only within 15 minutes of the order being placed.

## 7. Deploy

Any static host works. `npm run build` outputs `dist/`. SPA rewrites are included for Vercel (`vercel.json`) and Netlify (`public/_redirects`).

---

## How it works

- **Carts are per device.** A random `device_id` and the cart live only in `localStorage` (`mgl_cart_v1`). Nothing is shared server-side, so two phones can never merge carts. The cart clears only after an order succeeds. Sold-out or unavailable items are flagged and block checkout.
- **Scheduling.** The earliest date is tomorrow (Asia/Manila), or the day after once the cutoff passes. Blocked dates and max days are enforced in the date picker and again on the server. Slots are 1-hour windows inside the overlap of every cart store's hours. If the stores don't overlap, checkout is blocked with a message naming the stores.
- **Orders.** `place_order` re-validates everything: prices, sold-out, store availability, date, slot, phone and email format, the honeypot, and 5 orders per phone per day. It then returns `MGL-YYMMDD-XXXX` plus a 32-character random tracking token.
- **Tracking.** `/track/<token>` reads one order via `get_order_by_token` (customer-safe fields only). Anon users have no table access to orders at all. Every change pings a Realtime broadcast channel named after the token, and the page re-fetches, so status updates appear live.
- **Admin.** Every status change goes through `admin_order_action`, which validates the transition, writes `order_status_history` with the admin's email, and pushes the update to the customer.

## Tests

```bash
npm run test:db     # runs every migration in an in-process Postgres (PGlite) and checks prices, RLS, RPCs, scheduling, anti-spam, the admin flow
npm run typecheck
```
