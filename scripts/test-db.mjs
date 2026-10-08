// Runs every migration against an in-process Postgres (PGlite) with small
// stand-ins for Supabase's auth / storage / realtime schemas, then exercises
// the security rules and RPCs. Usage: npm run test:db
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMenu, uid } from './generate-seed.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;

create schema realtime;
create table realtime.sent (payload jsonb, event text, topic text, private boolean, at timestamptz default now());
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent values (payload, event, topic, private) $$;
create publication supabase_realtime;
`

let passed = 0
let failed = 0
const ok = (cond, name) => {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}
async function expectError(pg, sql, params, match, name) {
  try {
    await pg.query(sql, params)
    ok(false, `${name} (expected error, got success)`)
  } catch (e) {
    const hit = match ? new RegExp(match, 'i').test(e.message) : true
    if (!hit) console.log(`      got: ${e.message}`)
    ok(hit, name)
  }
}

process.on('unhandledRejection', (e) => {
  console.error('\nUNEXPECTED ERROR:', e.message)
  process.exit(1)
})
const pg = new PGlite({ extensions: { pgcrypto } })
await pg.exec(SUPABASE_STUBS)

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await pg.exec(readFileSync(path.join(migrationsDir, file), 'utf8'))
    console.log(`applied ${file}`)
  } catch (e) {
    console.error(`FAILED ${file}: ${e.message}`)
    process.exit(1)
  }
}
// Running everything twice proves the migrations are re-runnable.
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  await pg.exec(readFileSync(path.join(migrationsDir, file), 'utf8'))
}
console.log('re-applied all migrations (idempotent)')

const asRole = async (role, sub = null, email = null) => {
  await pg.exec(`reset role;`)
  await pg.query(`select set_config('request.jwt.claims', $1, false)`, [
    sub ? JSON.stringify({ sub, email, role }) : '',
  ])
  await pg.exec(`set role ${role};`)
}
const asSuper = () => pg.exec('reset role;')

// ---------------------------------------------------------------------
console.log('\nSeeded prices')
const stores = parseMenu()
const variants = (await pg.query('select id, price::text, addon_price::text from product_variants')).rows
const byId = new Map(variants.map((v) => [v.id, v]))
let mismatches = 0
let expected = 0
stores.forEach((s) =>
  s.sections.forEach((sec, ci) =>
    sec.products.forEach((p, pi) =>
      p.variants.forEach((v, vi) => {
        expected++
        const row = byId.get(uid(`variant:${s.slug}:${ci}:${pi}:${vi}`))
        if (!row || row.price !== v.price.toFixed(2) || (row.addon_price ?? null) !== (v.addon === null ? null : v.addon.toFixed(2))) {
          mismatches++
          console.log('      mismatch', s.slug, p.name, v.label)
        }
      }),
    ),
  ),
)
ok(mismatches === 0 && variants.length === expected, `all ${expected} variant prices match the menu data`)
const productsWithoutVariant = (await pg.query(
  'select count(*)::int n from products p where not exists (select 1 from product_variants v where v.product_id = p.id)',
)).rows[0].n
ok(productsWithoutVariant === 0, 'every product has at least one variant')
const spot = async (store, product, label) =>
  (await pg.query(
    `select v.price::text from product_variants v join products p on p.id = v.product_id join stores s on s.id = p.store_id
     where s.slug = $1 and p.name = $2 and v.label = $3`, [store, product, label])).rows.map((r) => r.price)
ok((await spot('hazels-special-puto', 'Mix', '12pcs'))[0] === '417.60', "Hazel's Mix 12pcs = 417.60")
ok((await spot('original-benjie-puto-pao', 'Puto', 'Regular'))[0] === '28.80', 'Benjie Puto = 28.80')
ok((await spot('aurings-special-pancit-malabon', 'Pancit Malabon Bilao', 'For 30 persons'))[0] === '3600.00', "Auring's 30 persons = 3600.00")
ok((await spot('raves-diner', 'Beef Belly', '1kg'))[0] === '2340.00', 'Raves Beef Belly 1kg = 2340.00')

// ---------------------------------------------------------------------
console.log('\nPrice lock')
await expectError(pg, `update product_variants set price = price + 1 where id = (select id from product_variants limit 1)`, [], 'Prices are fixed', 'superuser cannot change a variant price')
await expectError(pg, `update product_variants set addon_price = 1 where addon_price is not null and id = (select id from product_variants where addon_price is not null limit 1)`, [], 'Prices are fixed', 'superuser cannot change an addon price')
await expectError(pg, `update option_choices set price_delta = 5 where id = (select id from option_choices limit 1)`, [], 'Prices are fixed', 'superuser cannot change an option price')

// ---------------------------------------------------------------------
console.log('\nAnonymous access')
await asRole('anon')
ok((await pg.query('select count(*)::int n from products')).rows[0].n === 414, 'anon can read products')
await expectError(pg, 'select * from orders', [], 'permission denied', 'anon cannot select orders')
await expectError(pg, `insert into orders (order_number) values ('x')`, [], 'permission denied', 'anon cannot insert orders')
await expectError(pg, 'select * from settings', [], 'permission denied', 'anon cannot read settings table')
await expectError(pg, 'update products set is_sold_out = true', [], 'permission denied', 'anon cannot update products')
await expectError(pg, `select admin_order_action(gen_random_uuid(), 'confirm')`, [], 'permission denied', 'anon cannot call admin_order_action')
const info = (await pg.query('select get_checkout_info() as i')).rows[0].i
ok(['gcash', 'maribank', 'gotyme'].every((m) => info.payment_accounts?.[m] && 'number' in info.payment_accounts[m]), 'checkout info lists GCash, MariBank and GoTyme accounts')
ok(info.ordering_guidelines.some((g) => g.includes('MariBank') && g.includes('GoTyme')), 'guidelines mention MariBank and GoTyme')
const storeOrder = (await pg.query('select slug from stores order by sort')).rows.map((r) => r.slug)
ok(storeOrder[0] === 'sisig-ni-mutik' && storeOrder[1] === 'judy-anns-crispy-pata', 'Sisig ni Mutik first, Judy Ann\'s Crispy Pata second')
ok(storeOrder.at(-2) === 'aling-melys-carinderia' && storeOrder.at(-1) === 'raves-diner', 'Aling Mely\'s and Raves Diner last')
const dashText = (await pg.query(`select count(*)::int n from (select tagline t from stores union all select name from products) x where t ~ '[–—]'`)).rows[0].n
ok(dashText === 0, 'no dashes in store taglines or product names')
ok(Array.isArray(info.ordering_guidelines) && info.ordering_guidelines.length === 6, 'checkout info includes the 6 ordering guidelines')
ok(info.min_date > info.today, `checkout min date (${info.min_date}) is after today (${info.today})`)

const variantOf = async (store, product, label = 'Regular') =>
  (await pg.query(
    `select v.id from product_variants v join products p on p.id = v.product_id join stores s on s.id = p.store_id
     where s.slug = $1 and p.name = $2 and v.label = $3`, [store, product, label])).rows[0].id
const choiceOf = async (store, product, choice) =>
  (await pg.query(
    `select c.id from option_choices c join option_groups g on g.id = c.group_id join products p on p.id = g.product_id
     join stores s on s.id = p.store_id where s.slug = $1 and p.name = $2 and c.label = $3`, [store, product, choice])).rows[0].id

const base = {
  device_id: 'device-a',
  customer_name: 'Juan Dela Cruz',
  phone: '09171234567',
  email: 'juan@gmail.com',
  social_media: 'fb.com/juan',
  address: '12 Rizal St.',
  barangay: 'Niugan',
  city: 'Malabon',
  delivery_date: info.min_date,
  delivery_slot: '10:30-11:30', // Okoy opens 7:30, so its slots start on the half hour
  payment_method: 'cod',
  agree_terms: true,
}
const place = (payload) => pg.query('select place_order($1::jsonb) as r', [JSON.stringify(payload)])

console.log('\nplace_order')
const okoy = await variantOf('okoy-ni-jay-r', 'Special Okoy')
const r1 = (await place({ ...base, items: [{ variant_id: okoy, quantity: 2, unit_price: 1, price: 1 }] })).rows[0].r
ok(/^MGL-\d{6}-[2-9A-HJ-NP-Z]{4}$/.test(r1.order_number), `order number format (${r1.order_number})`)
ok(/^[A-Za-z0-9_-]{32}$/.test(r1.tracking_token), 'tracking token is 32 url-safe chars')
const o1 = (await pg.query('select get_order_by_token($1) as o', [r1.tracking_token])).rows[0].o
ok(Number(o1.subtotal) === 240, 'server recomputed subtotal (2 × ₱120) ignoring client price')
ok(!('admin_notes' in o1) && !('email' in o1) && !('device_id' in o1), 'tracking payload hides admin notes / email / device id')
ok(o1.order_status === 'processing' && o1.payment_status === 'cod_unpaid', 'COD order starts as processing / cod_unpaid')
ok(o1.history.length === 1 && o1.history[0].status === 'processing', 'first status history row created')
ok((await pg.query('select get_order_by_token($1) as o', ['x'.repeat(32)])).rows[0].o === null, 'unknown token returns nothing')

const r2 = (await place({ ...base, device_id: 'device-b', customer_name: 'Maria', phone: '+639181112222', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
ok(r2.tracking_token !== r1.tracking_token && r2.order_number !== r1.order_number, 'two simultaneous customers get separate orders')

await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_date: info.today, items: [{ variant_id: okoy, quantity: 1 }] })], 'Same day', 'today is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_date: '2099-01-01', items: [{ variant_id: okoy, quantity: 1 }] })], 'up to', 'date beyond max days is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, delivery_slot: '06:00-07:00', items: [{ variant_id: okoy, quantity: 1 }] })], 'outside the store hours', 'slot before store opens is rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '12345', items: [{ variant_id: okoy, quantity: 1 }] })], 'valid PH mobile', 'bad phone rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, email: 'nope', items: [{ variant_id: okoy, quantity: 1 }] })], 'valid email', 'bad email rejected')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, website: 'spam', items: [{ variant_id: okoy, quantity: 1 }] })], 'could not place', 'honeypot rejects bots')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, agree_terms: false, items: [{ variant_id: okoy, quantity: 1 }] })], 'acknowledgement', 'acknowledgement checkbox required')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, items: [] })], 'empty', 'empty cart rejected')

// Hazel's (7–12) + Raves (11–23): only 11:00–12:00 allowed
const hazel = await variantOf('hazels-special-puto', 'Puto Pao', '10pcs')
const raves = await variantOf('raves-diner', 'Classic')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000001', delivery_slot: '10:00-11:00', items: [{ variant_id: hazel, quantity: 1 }, { variant_id: raves, quantity: 1 }] })], 'outside the store hours', "Hazel's + Raves rejects 10–11 slot")
const r3 = (await place({ ...base, phone: '09170000001', delivery_slot: '11:00-12:00', items: [{ variant_id: hazel, quantity: 1 }, { variant_id: raves, quantity: 1 }] })).rows[0].r
ok(!!r3.order_number, "Hazel's + Raves accepts the 11–12 overlap slot")

// Required option + extra toppings
const peachy = await variantOf('anny-dading-peachy-peachy', 'Peachy-Peachy', 'Small 10 pcs')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000002', delivery_slot: '10:00-11:00', items: [{ variant_id: peachy, quantity: 1 }] })], 'choose a topping', 'required option enforced')
const cheese = await choiceOf('anny-dading-peachy-peachy', 'Peachy-Peachy', 'Cheese')
const benjieYema = await choiceOf('original-benjie-puto-pao', 'Flavored Puto Pao', 'Yema')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000002', delivery_slot: '10:00-11:00', items: [{ variant_id: peachy, quantity: 1, choice_ids: [benjieYema] }] })], 'Invalid option', "another product's option is rejected")
const r4 = (await place({ ...base, phone: '09170000002', delivery_slot: '10:00-11:00', items: [{ variant_id: peachy, quantity: 1, choice_ids: [cheese], extra_toppings: true }] })).rows[0].r
const o4 = (await pg.query('select get_order_by_token($1) as o', [r4.tracking_token])).rows[0].o
ok(Number(o4.subtotal) === 168, 'Peachy Small 10 pcs + extra toppings = ₱168.00')
ok(o4.items[0].options.length === 2, 'options snapshot stores topping + extra toppings')

// Anti-spam: 5 per phone per day
for (let i = 0; i < 4; i++) await place({ ...base, phone: '09175550000', items: [{ variant_id: okoy, quantity: 1 }] })
await place({ ...base, phone: '09175550000', items: [{ variant_id: okoy, quantity: 1 }] })
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '0917-555-0000', items: [{ variant_id: okoy, quantity: 1 }] })], 'limit of 5', '6th order from the same phone in a day is blocked')

// find_order / cancellation
ok((await pg.query('select find_order($1, $2) t', [r1.order_number.toLowerCase(), '0917 123 4567'])).rows[0].t === r1.tracking_token, 'find_order matches number + phone')
ok((await pg.query('select find_order($1, $2) t', [r1.order_number, '09999999999'])).rows[0].t === null, 'find_order with wrong phone returns nothing')
await pg.query('select request_cancellation($1, $2)', [r2.tracking_token, 'Changed my mind'])
const o2 = (await pg.query('select get_order_by_token($1) as o', [r2.tracking_token])).rows[0].o
ok(o2.cancel_requested === true && o2.history.at(-1).status === 'cancel_requested', 'cancellation request recorded')

// GCash: proof upload (insert-only) + order
console.log('\nGCash + storage')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-a/proof1.png')`)
ok(true, 'anon can upload a payment proof')
ok((await pg.query(`select count(*)::int n from storage.objects`)).rows[0].n === 0, 'anon cannot read payment proofs back')
await expectError(pg, `insert into storage.objects (bucket_id, name) values ('product-images', 'x.png')`, [], 'row-level security', 'anon cannot upload product images')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000003', payment_method: 'gcash', gcash_reference: '1234567890', gcash_proof_path: 'proofs/device-a/missing.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'screenshot', 'GCash requires an uploaded proof')
const r5 = (await place({ ...base, phone: '09170000003', payment_method: 'gcash', gcash_reference: '1234 567 890', gcash_proof_path: 'proofs/device-a/proof1.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const o5 = (await pg.query('select get_order_by_token($1) as o', [r5.tracking_token])).rows[0].o
ok(o5.payment_status === 'pending_verification' && o5.gcash_reference === '1234567890', 'GCash order starts as pending_verification')

// ---------------------------------------------------------------------
console.log('\nAdmin')
await asSuper()
const adminId = (await pg.query(`insert into auth.users (email) values ('admin@mgl.ph') returning id`)).rows[0].id
const userId = (await pg.query(`insert into auth.users (email) values ('random@x.ph') returning id`)).rows[0].id
await pg.query('insert into admin_users (user_id) values ($1)', [adminId])
const orderId = async (token) => (await pg.query('select id from orders where tracking_token = $1', [token])).rows[0].id
const id1 = await orderId(r1.tracking_token)
const id5 = await orderId(r5.tracking_token)

await asRole('authenticated', userId, 'random@x.ph')
ok((await pg.query('select count(*)::int n from orders')).rows[0].n === 0, 'non-admin user sees no orders')
await expectError(pg, `select admin_order_action($1, 'confirm')`, [id1], 'Not authorized', 'non-admin cannot change orders')
ok((await pg.query('select is_admin() a')).rows[0].a === false, 'is_admin() false for normal user')

await asRole('authenticated', adminId, 'admin@mgl.ph')
ok((await pg.query('select is_admin() a')).rows[0].a === true, 'is_admin() true for admin')
ok((await pg.query('select count(*)::int n from orders')).rows[0].n > 5, 'admin sees all orders')
await expectError(pg, `update product_variants set price = 1 where id = $1`, [okoy], 'permission denied', 'admin cannot edit prices (column grant)')
await expectError(pg, `update products set name = 'x' where id = (select product_id from product_variants where id = $1)`, [okoy], 'permission denied', 'admin cannot rename products')
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])
ok(true, 'admin can toggle variant sold out')
await pg.query(`update orders set admin_notes = 'VIP' where id = $1`, [id1])
await expectError(pg, `update orders set subtotal = 1 where id = $1`, [id1], 'permission denied', 'admin cannot edit order totals directly')

await expectError(pg, `select admin_order_action($1, 'preparing')`, [id1], 'confirmed', 'cannot skip straight to preparing')
await pg.query(`select admin_order_action($1, 'confirm')`, [id1])
await pg.query(`select admin_order_action($1, 'set_delivery_fee', null, 80)`, [id1])
await pg.query(`select admin_order_action($1, 'preparing')`, [id1])
await pg.query(`select admin_order_action($1, 'out_for_delivery')`, [id1])
await pg.query(`select admin_order_action($1, 'delivered')`, [id1])
await expectError(pg, `select admin_order_action($1, 'reject_payment')`, [id5], 'reason is required', 'rejecting a payment requires a reason')
await pg.query(`select admin_order_action($1, 'reject_payment', 'Blurry')`, [id5])
await pg.query(`insert into call_logs (order_id, result, note) values ($1, 'answered', 'ok')`, [id1])
const log = (await pg.query('select created_by::text, created_by_email from call_logs limit 1')).rows[0]
ok(log.created_by === adminId && log.created_by_email === 'admin@mgl.ph', 'call log records the admin')

await asRole('anon')
const d1 = (await pg.query('select get_order_by_token($1) as o', [r1.tracking_token])).rows[0].o
ok(d1.order_status === 'delivered' && Number(d1.delivery_fee) === 80 && Number(d1.total) === 320, 'delivered with fee; total = subtotal + fee')
ok(d1.history.map((h) => h.status).join(',') === 'processing,confirmed,delivery_fee_updated,preparing,out_for_delivery,delivered', 'full history visible to customer')
ok(!JSON.stringify(d1).includes('VIP'), 'admin notes never reach the tracking page')

// GCash reject → re-upload → mark paid
await asRole('authenticated', adminId, 'admin@mgl.ph')
const o5r = (await pg.query('select payment_status from orders where id = $1', [id5])).rows[0]
ok(o5r.payment_status === 'rejected', 'admin rejected GCash payment')
await asRole('anon')
const o5c = (await pg.query('select get_order_by_token($1) as o', [r5.tracking_token])).rows[0].o
ok(o5c.payment_rejection_reason === 'Blurry', 'customer sees the rejection reason')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-a/proof2.png')`)
await pg.query('select resubmit_gcash_proof($1, $2, $3)', [r5.tracking_token, 'ABC123456', 'proofs/device-a/proof2.png'])
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'mark_paid')`, [id5])
const o5p = (await pg.query('select payment_status, order_status from orders where id = $1', [id5])).rows[0]
ok(o5p.payment_status === 'paid' && o5p.order_status === 'confirmed', 'mark paid → paid / confirmed')
const proofs = (await pg.query(`select count(*)::int n from storage.objects where bucket_id = 'payment-proofs'`)).rows[0].n
ok(proofs === 2, 'admin can read payment proofs')
await expectError(pg, `select admin_order_action($1, 'confirm')`, [id5], 'awaiting confirmation', 'an already-confirmed order cannot be confirmed twice')

// "Confirm Order" also works for GCash (verifies the payment in one step)
await asRole('anon')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-c/proof3.png')`)
await asSuper()
await pg.query(`update product_variants set is_sold_out = false where id = $1`, [okoy])
await asRole('anon')
const r6 = (await place({ ...base, phone: '09170000006', payment_method: 'gcash', gcash_reference: '7788990011', gcash_proof_path: 'proofs/device-c/proof3.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
await asSuper()
const id6 = await orderId(r6.tracking_token)
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'confirm')`, [id6])
const o6 = (await pg.query('select payment_status, order_status from orders where id = $1', [id6])).rows[0]
ok(o6.payment_status === 'paid' && o6.order_status === 'confirmed', 'Confirm Order on a GCash order → paid + confirmed')
await asRole('anon')
const t6 = (await pg.query('select get_order_by_token($1) as o', [r6.tracking_token])).rows[0].o
ok(t6.history.at(-1).status === 'payment_confirmed', 'customer sees "Payment Confirmed" after Confirm Order')
await asRole('authenticated', adminId, 'admin@mgl.ph')
await asSuper()
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])
await asRole('authenticated', adminId, 'admin@mgl.ph')

// MariBank and GoTyme work like GCash: reference + screenshot, admin verifies
console.log('\nMariBank + GoTyme')
await asSuper()
await pg.query(`update product_variants set is_sold_out = false where id = $1`, [okoy])
await asRole('anon')
await pg.query(`insert into storage.objects (bucket_id, name) values ('payment-proofs', 'proofs/device-d/mari.png'), ('payment-proofs', 'proofs/device-d/goty.png'), ('payment-proofs', 'proofs/device-d/goty2.png')`)
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'maribank', gcash_reference: '', gcash_proof_path: 'proofs/device-d/mari.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'MariBank reference', 'MariBank requires a reference number')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'gotyme', gcash_reference: '55556666', gcash_proof_path: 'proofs/device-d/nope.png', items: [{ variant_id: okoy, quantity: 1 }] })], 'GoTyme payment', 'GoTyme requires an uploaded screenshot')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000007', payment_method: 'paypal', items: [{ variant_id: okoy, quantity: 1 }] })], 'choose a payment method', 'unknown payment method rejected')
const r7 = (await place({ ...base, phone: '09170000007', payment_method: 'maribank', gcash_reference: 'MB 123 456', gcash_proof_path: 'proofs/device-d/mari.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const r8 = (await place({ ...base, phone: '09170000008', payment_method: 'gotyme', gcash_reference: 'GT998877', gcash_proof_path: 'proofs/device-d/goty.png', items: [{ variant_id: okoy, quantity: 1 }] })).rows[0].r
const o7 = (await pg.query('select get_order_by_token($1) as o', [r7.tracking_token])).rows[0].o
const o8 = (await pg.query('select get_order_by_token($1) as o', [r8.tracking_token])).rows[0].o
ok(o7.payment_method === 'maribank' && o7.payment_status === 'pending_verification' && o7.gcash_reference === 'MB123456', 'MariBank order placed, waiting for verification')
ok(o8.payment_method === 'gotyme' && o8.payment_status === 'pending_verification', 'GoTyme order placed, waiting for verification')
ok(o7.history[0].note.startsWith('MariBank payment submitted') && o8.history[0].note.startsWith('GoTyme payment submitted'), 'history notes name the right bank')
await asSuper()
const id7 = await orderId(r7.tracking_token)
const id8 = await orderId(r8.tracking_token)
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'confirm')`, [id7])
const p7 = (await pg.query('select payment_status, order_status from orders where id = $1', [id7])).rows[0]
ok(p7.payment_status === 'paid' && p7.order_status === 'confirmed', 'Confirm Order on MariBank → paid + confirmed')
await pg.query(`select admin_order_action($1, 'reject_payment', 'Wrong amount')`, [id8])
await asRole('anon')
await pg.query('select resubmit_gcash_proof($1, $2, $3)', [r8.tracking_token, 'GT111222', 'proofs/device-d/goty2.png'])
const t8 = (await pg.query('select get_order_by_token($1) as o', [r8.tracking_token])).rows[0].o
ok(t8.payment_status === 'pending_verification' && t8.history.at(-1).note.startsWith('New GoTyme payment proof'), 'GoTyme: rejected → customer sends a new proof')
await asRole('authenticated', adminId, 'admin@mgl.ph')
await pg.query(`select admin_order_action($1, 'mark_paid')`, [id8])
const t8b = (await pg.query('select payment_status, order_status from orders where id = $1', [id8])).rows[0]
ok(t8b.payment_status === 'paid' && t8b.order_status === 'confirmed', 'GoTyme: Mark as Paid → paid + confirmed')
await expectError(pg, `select admin_order_action($1, 'reject_payment', 'x')`, [id1], 'no online payment', 'cannot reject payment on a COD order')
await asSuper()
await pg.query(`update product_variants set is_sold_out = true where id = $1`, [okoy])

// Sold-out variant is rejected at checkout
await asRole('anon')
await expectError(pg, 'select place_order($1::jsonb)', [JSON.stringify({ ...base, phone: '09170000009', items: [{ variant_id: okoy, quantity: 1 }] })], 'SOLD OUT', 'sold-out item rejected')

await asSuper()
const sent = (await pg.query(`select count(*)::int n from realtime.sent where topic = 'order:' || $1 and private = false`, [r1.tracking_token])).rows[0].n
ok(sent >= 6, `realtime ping sent on the order's token channel (${sent} pings)`)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
