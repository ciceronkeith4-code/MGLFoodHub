-- MGL Food Hub — complete database setup (schema + functions + menu).
-- Combined copy of supabase/migrations/*.sql. Safe to run more than once.
-- Paste into Supabase → SQL Editor → New query → Run.


-- ===================== migrations/20261007000100_schema.sql =====================
-- =====================================================================
-- MGL Food Hub — schema, security (RLS), storage, realtime
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.payment_method as enum ('cod', 'gcash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('cod_unpaid', 'pending_verification', 'paid', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('processing', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------
create table if not exists public.hub_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort int not null default 0
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text,
  hub_category_id uuid not null references public.hub_categories(id),
  open_time time not null,
  close_time time not null,
  address text,
  contact_note text,
  cover_image_url text,
  menu_image_url text,
  is_accepting_orders boolean not null default true,
  sort int not null default 0,
  constraint stores_hours_check check (close_time > open_time)
);

create table if not exists public.menu_sections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  note text,
  sort int not null default 0
);
create index if not exists menu_sections_store_idx on public.menu_sections(store_id);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  section_id uuid not null references public.menu_sections(id) on delete cascade,
  name text not null,
  description text,
  badge text check (badge in ('best_seller', 'new', 'all_time_favorite')),
  image_url text,
  is_sold_out boolean not null default false,
  sort int not null default 0
);
create index if not exists products_store_idx on public.products(store_id);
create index if not exists products_section_idx on public.products(section_id);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  price numeric(10,2) not null check (price >= 0),
  addon_price numeric(10,2) check (addon_price is null or addon_price >= 0),
  is_sold_out boolean not null default false,
  sort int not null default 0
);
create index if not exists product_variants_product_idx on public.product_variants(product_id);

create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  is_required boolean not null default true
);
create index if not exists option_groups_product_idx on public.option_groups(product_id);

create table if not exists public.option_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id) on delete cascade,
  label text not null,
  price_delta numeric(10,2) not null default 0,
  sort int not null default 0
);
create index if not exists option_choices_group_idx on public.option_choices(group_id);

-- ---------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  tracking_token text not null unique,
  device_id text,
  customer_name text not null,
  phone text not null,
  email text not null,
  social_media text not null,
  address text not null,
  barangay text not null,
  city text not null,
  landmark text,
  delivery_date date not null,
  delivery_slot text not null,
  payment_method public.payment_method not null,
  payment_status public.payment_status not null,
  order_status public.order_status not null default 'processing',
  gcash_reference text,
  gcash_proof_path text,
  payment_rejection_reason text,
  subtotal numeric(10,2) not null,
  delivery_fee numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  customer_notes text,
  admin_notes text,
  cancel_reason text,
  cancel_requested boolean not null default false,
  cancel_request_reason text,
  email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_delivery_date_idx on public.orders(delivery_date);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_phone_idx on public.orders(phone);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.product_variants(id),
  store_name_snapshot text not null,
  section_name_snapshot text,
  product_name_snapshot text not null,
  variant_label_snapshot text not null,
  options_snapshot jsonb not null default '[]'::jsonb,
  unit_price_snapshot numeric(10,2) not null,
  quantity int not null check (quantity between 1 and 99),
  line_total numeric(10,2) not null,
  line_no int not null default 0
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_store_idx on public.order_items(store_id);

-- status: an order_status value, or an event such as payment_confirmed,
-- payment_rejected, proof_resubmitted, cancel_requested, delivery_fee_updated.
-- note: customer-visible (reasons). Internal notes live in orders.admin_notes.
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_by_email text,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order_idx on public.order_status_history(order_id, created_at);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  result text not null check (result in ('answered', 'no_answer', 'wrong_number')),
  note text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_by_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists call_logs_order_idx on public.call_logs(order_id);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('gcash_account_name', '""'::jsonb),
  ('gcash_number', '""'::jsonb),
  ('gcash_qr_url', '""'::jsonb),
  ('cutoff_time', '"20:00"'::jsonb),
  ('max_days_ahead', '30'::jsonb),
  ('blocked_dates', '[]'::jsonb),
  ('delivery_fee_note', '"Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries)."'::jsonb),
  ('email_notifications_enabled', 'false'::jsonb),
  ('max_orders_per_phone_per_day', '5'::jsonb),
  ('ordering_guidelines', jsonb_build_array(
    'We deliver via Grab within Metro Manila from 12:00 PM to 6:00 PM.',
    'Pay by Cash on Delivery (COD) or online (GCash).',
    'Orders are for booking (scheduled delivery) only. Same-day delivery is not available.',
    'We will confirm your order by text or call.',
    'Menu prices are VAT inclusive and may vary or be subject to change by the merchant. Higher delivery fees may also apply for long distance deliveries.',
    'You can order from all merchants in the app and pay only one delivery fee.'
  ))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at before update on public.orders
  for each row execute function public.touch_updated_at();

-- Prices are FIXED. This blocks every role (including the SQL editor /
-- service role) from changing a price after it has been seeded.
create or replace function public.prevent_price_change()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'product_variants' then
    if new.price is distinct from old.price or new.addon_price is distinct from old.addon_price then
      raise exception 'Prices are fixed and cannot be changed (variant %).', old.id
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'option_choices' then
    if new.price_delta is distinct from old.price_delta then
      raise exception 'Prices are fixed and cannot be changed (option %).', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists product_variants_price_lock on public.product_variants;
create trigger product_variants_price_lock before update on public.product_variants
  for each row execute function public.prevent_price_change();

drop trigger if exists option_choices_price_lock on public.option_choices;
create trigger option_choices_price_lock before update on public.option_choices
  for each row execute function public.prevent_price_change();

-- ---------------------------------------------------------------------
-- Grants (column-level: admins may only touch the columns they are allowed to)
-- ---------------------------------------------------------------------
revoke all on public.hub_categories, public.stores, public.menu_sections, public.products,
  public.product_variants, public.option_groups, public.option_choices, public.orders,
  public.order_items, public.order_status_history, public.call_logs, public.admin_users,
  public.settings
from anon, authenticated;

grant select on public.hub_categories, public.stores, public.menu_sections, public.products,
  public.product_variants, public.option_groups, public.option_choices
to anon, authenticated;

grant update (is_accepting_orders, cover_image_url, menu_image_url) on public.stores to authenticated;
grant update (is_sold_out, badge, image_url, sort) on public.products to authenticated;
grant update (is_sold_out) on public.product_variants to authenticated;

grant select on public.orders, public.order_items, public.order_status_history to authenticated;
grant update (admin_notes) on public.orders to authenticated;
grant select, insert on public.call_logs to authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update on public.settings to authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.hub_categories enable row level security;
alter table public.stores enable row level security;
alter table public.menu_sections enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.option_groups enable row level security;
alter table public.option_choices enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.call_logs enable row level security;
alter table public.admin_users enable row level security;
alter table public.settings enable row level security;

-- Public catalog: readable by everyone
drop policy if exists "catalog read" on public.hub_categories;
create policy "catalog read" on public.hub_categories for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.stores;
create policy "catalog read" on public.stores for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.menu_sections;
create policy "catalog read" on public.menu_sections for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.products;
create policy "catalog read" on public.products for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.product_variants;
create policy "catalog read" on public.product_variants for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.option_groups;
create policy "catalog read" on public.option_groups for select to anon, authenticated using (true);
drop policy if exists "catalog read" on public.option_choices;
create policy "catalog read" on public.option_choices for select to anon, authenticated using (true);

-- Admin catalog updates (column grants above limit WHICH columns)
drop policy if exists "admin update" on public.stores;
create policy "admin update" on public.stores for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin update" on public.products;
create policy "admin update" on public.products for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin update" on public.product_variants;
create policy "admin update" on public.product_variants for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Orders: no anon access at all. Customers go through SECURITY DEFINER RPCs.
drop policy if exists "admin all" on public.orders;
create policy "admin all" on public.orders for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.order_items;
create policy "admin all" on public.order_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.order_status_history;
create policy "admin all" on public.order_status_history for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.call_logs;
create policy "admin all" on public.call_logs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.settings;
create policy "admin all" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "self read" on public.admin_users;
create policy "self read" on public.admin_users for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('payment-proofs', 'payment-proofs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']),
  ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('store-assets', 'store-assets', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- payment-proofs: PRIVATE. Anyone may upload (INSERT only) into proofs/…; only admins can read.
drop policy if exists "payment proofs: anyone can upload" on storage.objects;
create policy "payment proofs: anyone can upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = 'proofs');
drop policy if exists "payment proofs: admins read" on storage.objects;
create policy "payment proofs: admins read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

-- product-images / store-assets: public read (bucket is public), admin write.
drop policy if exists "public images: admin insert" on storage.objects;
create policy "public images: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('product-images', 'store-assets') and public.is_admin());
drop policy if exists "public images: admin update" on storage.objects;
create policy "public images: admin update" on storage.objects for update to authenticated
  using (bucket_id in ('product-images', 'store-assets') and public.is_admin());
drop policy if exists "public images: admin delete" on storage.objects;
create policy "public images: admin delete" on storage.objects for delete to authenticated
  using (bucket_id in ('product-images', 'store-assets') and public.is_admin());
drop policy if exists "public images: admin select" on storage.objects;
create policy "public images: admin select" on storage.objects for select to authenticated
  using (bucket_id in ('product-images', 'store-assets') and public.is_admin());

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['orders', 'order_status_history', 'products', 'product_variants', 'stores'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;

-- ===================== migrations/20261007000200_functions.sql =====================
-- =====================================================================
-- MGL Food Hub — RPC functions
-- All customer access to orders goes through these SECURITY DEFINER
-- functions; anon has no direct table access to orders.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------
create or replace function public.setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select value from public.settings where key = p_key;
$$;
revoke execute on function public.setting(text) from public, anon, authenticated;

create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p is null or p !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return p::uuid;
end $$;

-- Unguessable, URL-safe token (nanoid alphabet), from a CSPRNG.
create or replace function public.random_token(len int)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0..len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) & 63) + 1, 1);
  end loop;
  return result;
end $$;

-- Human-friendly code: no 0/O/1/I to avoid confusion when read over the phone.
create or replace function public.random_code(len int)
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0..len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  end loop;
  return result;
end $$;

-- Normalises 09XXXXXXXXX / +639XXXXXXXXX (spaces/dashes allowed) to 09XXXXXXXXX.
create or replace function public.normalize_ph_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g');
begin
  if v ~ '^09[0-9]{9}$' then
    return v;
  elsif v ~ '^\+639[0-9]{9}$' then
    return '0' || substr(v, 4);
  end if;
  return null;
end $$;

-- Delivery window in Asia/Manila. Same-day is never allowed; after the cutoff
-- the earliest date moves to the day after tomorrow.
create or replace function public.delivery_window(
  out today date,
  out min_date date,
  out max_date date,
  out cutoff_time time
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Manila';
  v_max_days int := coalesce((public.setting('max_days_ahead') #>> '{}')::int, 30);
begin
  cutoff_time := coalesce(nullif(public.setting('cutoff_time') #>> '{}', ''), '20:00')::time;
  today := v_now::date;
  min_date := today + case when v_now::time >= cutoff_time then 2 else 1 end;
  max_date := today + greatest(v_max_days, 1);
  if max_date < min_date then
    max_date := min_date;
  end if;
end $$;

create or replace function public.proof_exists(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, storage
as $$
  select exists (
    select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_path
  );
$$;
revoke execute on function public.proof_exists(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public: checkout configuration (server time, dates, GCash details)
-- ---------------------------------------------------------------------
create or replace function public.get_checkout_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w record;
begin
  select * into w from public.delivery_window();
  return jsonb_build_object(
    'today', w.today,
    'min_date', w.min_date,
    'max_date', w.max_date,
    'cutoff_time', to_char(w.cutoff_time, 'HH24:MI'),
    'blocked_dates', coalesce(public.setting('blocked_dates'), '[]'::jsonb),
    'gcash_account_name', coalesce(public.setting('gcash_account_name') #>> '{}', ''),
    'gcash_number', coalesce(public.setting('gcash_number') #>> '{}', ''),
    'gcash_qr_url', coalesce(public.setting('gcash_qr_url') #>> '{}', ''),
    'delivery_fee_note', coalesce(public.setting('delivery_fee_note') #>> '{}', ''),
    'email_notifications_enabled', coalesce((public.setting('email_notifications_enabled') #>> '{}')::boolean, false),
    'ordering_guidelines', coalesce(public.setting('ordering_guidelines'), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- Public: place an order
-- ---------------------------------------------------------------------
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_name text := left(btrim(coalesce(payload->>'customer_name', '')), 120);
  v_phone text := public.normalize_ph_phone(payload->>'phone');
  v_email text := left(lower(btrim(coalesce(payload->>'email', ''))), 200);
  v_social text := left(btrim(coalesce(payload->>'social_media', '')), 300);
  v_address text := left(btrim(coalesce(payload->>'address', '')), 300);
  v_barangay text := left(btrim(coalesce(payload->>'barangay', '')), 120);
  v_city text := left(btrim(coalesce(payload->>'city', '')), 120);
  v_landmark text := nullif(left(btrim(coalesce(payload->>'landmark', '')), 200), '');
  v_notes text := nullif(left(btrim(coalesce(payload->>'customer_notes', '')), 1000), '');
  v_device text := nullif(left(btrim(coalesce(payload->>'device_id', '')), 64), '');
  v_slot text := btrim(coalesce(payload->>'delivery_slot', ''));
  v_method_text text := payload->>'payment_method';
  v_ref text := nullif(upper(regexp_replace(coalesce(payload->>'gcash_reference', ''), '\s', '', 'g')), '');
  v_proof text := nullif(btrim(coalesce(payload->>'gcash_proof_path', '')), '');
  v_now timestamp := now() at time zone 'Asia/Manila';
  w record;
  v_date date;
  v_blocked jsonb;
  v_slot_start time;
  v_slot_end time;
  v_max_open time;
  v_min_close time;
  v_limit int;
  v_count int;
  v_item jsonb;
  v_qty int;
  v_variant_id uuid;
  v_choice_ids uuid[];
  v_raw_choice text;
  v_v record;
  v_g record;
  v_c record;
  v_n int;
  v_unit numeric(10,2);
  v_options jsonb;
  v_extra boolean;
  v_lines jsonb := '[]'::jsonb;
  v_line_no int := 0;
  v_subtotal numeric(10,2) := 0;
  v_store_ids uuid[] := '{}';
  v_hours text;
  v_order_id uuid := gen_random_uuid();
  v_order_number text;
  v_token text;
begin
  -- Anti-spam honeypot: real customers never fill this hidden field.
  if coalesce(payload->>'website', '') <> '' then
    raise exception 'We could not place your order. Please try again.';
  end if;

  if coalesce((payload->>'agree_terms')::boolean, false) is not true then
    raise exception 'Please tick the delivery fee and food quality acknowledgement before placing your order.';
  end if;

  -- Customer details
  if length(v_name) < 2 then
    raise exception 'Please enter your full name.';
  end if;
  if v_phone is null then
    raise exception 'Please enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).';
  end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if length(v_social) < 2 then
    raise exception 'Please enter your Facebook or Instagram profile link or username.';
  end if;
  if length(v_address) < 4 or length(v_barangay) < 2 or length(v_city) < 2 then
    raise exception 'Please complete your delivery address (house/unit and street, barangay, city).';
  end if;

  -- Payment
  if v_method_text not in ('cod', 'gcash') or v_method_text is null then
    raise exception 'Please choose a payment method.';
  end if;
  if v_method_text = 'gcash' then
    if v_ref is null or v_ref !~ '^[A-Z0-9-]{4,40}$' then
      raise exception 'Please enter your GCash reference number.';
    end if;
    if v_proof is null or v_proof !~ '^proofs/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$' or not public.proof_exists(v_proof) then
      raise exception 'Please upload a screenshot of your GCash payment.';
    end if;
  else
    v_ref := null;
    v_proof := null;
  end if;

  -- Delivery date (scheduled only)
  select * into w from public.delivery_window();
  if coalesce(payload->>'delivery_date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Please choose a delivery date.';
  end if;
  v_date := (payload->>'delivery_date')::date;
  if v_date <= w.today then
    raise exception 'Same-day delivery is not available. Please choose a future delivery date.';
  end if;
  if v_date < w.min_date then
    raise exception 'The cutoff for % deliveries has passed (% PH time). The earliest available date is %.',
      to_char(v_date, 'Mon DD'), to_char(w.cutoff_time, 'HH12:MI AM'), to_char(w.min_date, 'Mon DD, YYYY');
  end if;
  if v_date > w.max_date then
    raise exception 'Orders can only be scheduled up to %.', to_char(w.max_date, 'Mon DD, YYYY');
  end if;
  v_blocked := coalesce(public.setting('blocked_dates'), '[]'::jsonb);
  if v_blocked ? to_char(v_date, 'YYYY-MM-DD') then
    raise exception 'Sorry, we are not accepting deliveries on %. Please choose another date.', to_char(v_date, 'Mon DD, YYYY');
  end if;

  -- Anti-spam: max N orders per phone per (Manila) day
  perform pg_advisory_xact_lock(hashtext('mgl_place_order:' || v_phone));
  v_limit := coalesce((public.setting('max_orders_per_phone_per_day') #>> '{}')::int, 5);
  select count(*) into v_count
  from public.orders
  where phone = v_phone and (created_at at time zone 'Asia/Manila')::date = v_now::date;
  if v_count >= v_limit then
    raise exception 'This phone number has reached the limit of % orders today. Please try again tomorrow or contact us.', v_limit;
  end if;

  -- Items: every price is re-read from the database. Client prices are ignored.
  if coalesce(jsonb_typeof(payload->'items'), '') <> 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Your cart is empty.';
  end if;
  if jsonb_array_length(payload->'items') > 60 then
    raise exception 'Too many items in one order. Please split it into separate orders.';
  end if;

  for v_item in select value from jsonb_array_elements(payload->'items') loop
    v_variant_id := public.try_uuid(v_item->>'variant_id');
    begin
      v_qty := (v_item->>'quantity')::int;
    exception when others then
      v_qty := null;
    end;
    if v_variant_id is null or v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'One of the items in your cart is invalid. Please refresh your cart.';
    end if;

    select pv.id as variant_id, pv.label, pv.price, pv.addon_price, pv.is_sold_out as variant_sold_out,
           p.id as product_id, p.name as product_name, p.is_sold_out as product_sold_out,
           s.id as store_id, s.name as store_name, s.is_accepting_orders,
           ms.name as section_name
      into v_v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.stores s on s.id = p.store_id
    join public.menu_sections ms on ms.id = p.section_id
    where pv.id = v_variant_id;

    if not found then
      raise exception 'One of the items in your cart is no longer available. Please remove it and try again.';
    end if;
    if v_v.product_sold_out or v_v.variant_sold_out then
      raise exception '% (%) from % is SOLD OUT. Please remove it from your cart.', v_v.product_name, v_v.label, v_v.store_name;
    end if;
    if not v_v.is_accepting_orders then
      raise exception '% is temporarily not accepting orders. Please remove its items from your cart.', v_v.store_name;
    end if;

    v_unit := v_v.price;
    v_options := '[]'::jsonb;

    -- Options: each choice must belong to this product; one choice per group.
    v_choice_ids := '{}';
    if jsonb_typeof(v_item->'choice_ids') = 'array' then
      for v_raw_choice in select value from jsonb_array_elements_text(v_item->'choice_ids') loop
        if public.try_uuid(v_raw_choice) is null then
          raise exception 'Invalid option selected for %.', v_v.product_name;
        end if;
        v_choice_ids := array_append(v_choice_ids, public.try_uuid(v_raw_choice));
      end loop;
    end if;

    if exists (
      select 1 from unnest(v_choice_ids) as c(id)
      where not exists (
        select 1 from public.option_choices oc
        join public.option_groups og on og.id = oc.group_id
        where oc.id = c.id and og.product_id = v_v.product_id
      )
    ) then
      raise exception 'Invalid option selected for %.', v_v.product_name;
    end if;

    for v_g in
      select og.id, og.name, og.is_required from public.option_groups og
      where og.product_id = v_v.product_id order by og.name
    loop
      select count(*) into v_n from public.option_choices oc
      where oc.group_id = v_g.id and oc.id = any(v_choice_ids);
      if v_n > 1 then
        raise exception 'Please choose only one % for %.', lower(v_g.name), v_v.product_name;
      elsif v_n = 0 and v_g.is_required then
        raise exception 'Please choose a % for %.', lower(v_g.name), v_v.product_name;
      elsif v_n = 1 then
        select oc.label, oc.price_delta into v_c from public.option_choices oc
        where oc.group_id = v_g.id and oc.id = any(v_choice_ids);
        v_unit := v_unit + v_c.price_delta;
        v_options := v_options || jsonb_build_array(jsonb_build_object(
          'group', v_g.name, 'choice', v_c.label, 'price_delta', v_c.price_delta));
      end if;
    end loop;

    v_extra := coalesce((v_item->>'extra_toppings')::boolean, false);
    if v_extra then
      if v_v.addon_price is null then
        raise exception 'Extra toppings are not available for %.', v_v.product_name;
      end if;
      v_unit := v_unit + v_v.addon_price;
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'group', 'Extra Toppings', 'choice', 'Yes', 'price_delta', v_v.addon_price));
    end if;

    v_line_no := v_line_no + 1;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_no', v_line_no,
      'store_id', v_v.store_id,
      'product_id', v_v.product_id,
      'variant_id', v_v.variant_id,
      'store_name', v_v.store_name,
      'section_name', v_v.section_name,
      'product_name', v_v.product_name,
      'variant_label', v_v.label,
      'options', v_options,
      'unit_price', v_unit,
      'quantity', v_qty,
      'line_total', v_unit * v_qty
    ));
    v_subtotal := v_subtotal + v_unit * v_qty;
    if not (v_v.store_id = any(v_store_ids)) then
      v_store_ids := array_append(v_store_ids, v_v.store_id);
    end if;
  end loop;

  -- Time slot: a 1-hour slot inside the hours of EVERY store in the cart.
  if v_slot !~ '^\d{2}:\d{2}-\d{2}:\d{2}$' then
    raise exception 'Please choose a preferred delivery time slot.';
  end if;
  v_slot_start := split_part(v_slot, '-', 1)::time;
  v_slot_end := split_part(v_slot, '-', 2)::time;

  select max(open_time), min(close_time),
         string_agg(name || ' (' || to_char(open_time, 'FMHH12:MI AM') || '–' || to_char(close_time, 'FMHH12:MI AM') || ')', ', ' order by name)
    into v_max_open, v_min_close, v_hours
  from public.stores where id = any(v_store_ids);

  if v_min_close - v_max_open < interval '1 hour' then
    raise exception 'The stores in your cart have no common delivery hours: %. Please place separate orders.', v_hours;
  end if;
  if v_slot_end - v_slot_start <> interval '1 hour'
     or v_slot_start < v_max_open
     or v_slot_end > v_min_close
     or mod(extract(epoch from (v_slot_start - v_max_open))::int, 3600) <> 0 then
    raise exception 'The selected time slot is outside the store hours of your cart (%). Please choose another slot.', v_hours;
  end if;

  -- Identifiers: readable order number + unguessable tracking token
  loop
    v_order_number := 'MGL-' || to_char(v_now, 'YYMMDD') || '-' || public.random_code(4);
    exit when not exists (select 1 from public.orders where order_number = v_order_number);
  end loop;
  loop
    v_token := public.random_token(32);
    exit when not exists (select 1 from public.orders where tracking_token = v_token);
  end loop;

  insert into public.orders (
    id, order_number, tracking_token, device_id, customer_name, phone, email, social_media,
    address, barangay, city, landmark, delivery_date, delivery_slot, payment_method,
    payment_status, order_status, gcash_reference, gcash_proof_path, subtotal, delivery_fee,
    total, customer_notes
  ) values (
    v_order_id, v_order_number, v_token, v_device, v_name, v_phone, v_email, v_social,
    v_address, v_barangay, v_city, v_landmark, v_date, v_slot, v_method_text::public.payment_method,
    case when v_method_text = 'gcash' then 'pending_verification' else 'cod_unpaid' end::public.payment_status,
    'processing', v_ref, v_proof, v_subtotal, 0, v_subtotal, v_notes
  );

  insert into public.order_items (
    order_id, line_no, store_id, product_id, variant_id, store_name_snapshot, section_name_snapshot,
    product_name_snapshot, variant_label_snapshot, options_snapshot, unit_price_snapshot,
    quantity, line_total
  )
  select v_order_id, (l->>'line_no')::int, (l->>'store_id')::uuid, (l->>'product_id')::uuid,
         (l->>'variant_id')::uuid, l->>'store_name', l->>'section_name', l->>'product_name',
         l->>'variant_label', l->'options', (l->>'unit_price')::numeric, (l->>'quantity')::int,
         (l->>'line_total')::numeric
  from jsonb_array_elements(v_lines) as l;

  insert into public.order_status_history (order_id, status, note)
  values (
    v_order_id, 'processing',
    case when v_method_text = 'gcash'
      then 'GCash payment submitted for verification (Ref: ' || v_ref || ').'
      else 'Order received. Our team will call you to confirm.'
    end
  );

  return jsonb_build_object('order_number', v_order_number, 'tracking_token', v_token);
end $$;

-- ---------------------------------------------------------------------
-- Public: read ONE order by its tracking token (customer-safe fields only)
-- ---------------------------------------------------------------------
create or replace function public.get_order_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'order_number', o.order_number,
    'tracking_token', o.tracking_token,
    'customer_name', o.customer_name,
    'phone', o.phone,
    'address', o.address,
    'barangay', o.barangay,
    'city', o.city,
    'landmark', o.landmark,
    'delivery_date', o.delivery_date,
    'delivery_slot', o.delivery_slot,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'order_status', o.order_status,
    'gcash_reference', o.gcash_reference,
    'payment_rejection_reason', o.payment_rejection_reason,
    'subtotal', o.subtotal,
    'delivery_fee', o.delivery_fee,
    'total', o.total,
    'customer_notes', o.customer_notes,
    'cancel_reason', o.cancel_reason,
    'cancel_requested', o.cancel_requested,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_name', i.store_name_snapshot,
        'section_name', i.section_name_snapshot,
        'product_name', i.product_name_snapshot,
        'variant_label', i.variant_label_snapshot,
        'options', i.options_snapshot,
        'unit_price', i.unit_price_snapshot,
        'quantity', i.quantity,
        'line_total', i.line_total
      ) order by i.line_no)
      from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'status', h.status, 'note', h.note, 'created_at', h.created_at
      ) order by h.created_at, h.id)
      from public.order_status_history h where h.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  where p_token ~ '^[A-Za-z0-9_-]{32}$' and o.tracking_token = p_token;
$$;

-- Status summary for the "My Orders on this device" page.
create or replace function public.get_order_summaries(p_tokens text[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tracking_token', o.tracking_token,
    'order_number', o.order_number,
    'order_status', o.order_status,
    'payment_method', o.payment_method,
    'payment_status', o.payment_status,
    'delivery_date', o.delivery_date,
    'delivery_slot', o.delivery_slot,
    'total', o.total,
    'created_at', o.created_at
  ) order by o.created_at desc), '[]'::jsonb)
  from public.orders o
  where o.tracking_token = any(p_tokens[1:50]);
$$;

-- Returns the tracking token only when BOTH the order number and phone match.
create or replace function public.find_order(p_order_number text, p_phone text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.tracking_token
  from public.orders o
  where o.order_number = upper(btrim(coalesce(p_order_number, '')))
    and o.phone = public.normalize_ph_phone(p_phone)
  limit 1;
$$;

create or replace function public.request_cancellation(p_token text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  select * into o from public.orders where tracking_token = p_token for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if o.order_status <> 'processing' then
    raise exception 'This order can no longer be cancelled online. Please contact us directly.';
  end if;
  if o.cancel_requested then
    raise exception 'You already requested a cancellation. Our team will get back to you.';
  end if;
  if v_reason is null then
    raise exception 'Please tell us why you want to cancel.';
  end if;

  update public.orders
     set cancel_requested = true, cancel_request_reason = v_reason
   where id = o.id;
  insert into public.order_status_history (order_id, status, note)
  values (o.id, 'cancel_requested', v_reason);
end $$;

create or replace function public.resubmit_gcash_proof(p_token text, p_ref text, p_path text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_ref text := nullif(upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g')), '');
begin
  select * into o from public.orders where tracking_token = p_token for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if o.payment_method <> 'gcash' or o.payment_status <> 'rejected' or o.order_status <> 'processing' then
    raise exception 'This order is not waiting for a new payment proof.';
  end if;
  if v_ref is null or v_ref !~ '^[A-Z0-9-]{4,40}$' then
    raise exception 'Please enter your GCash reference number.';
  end if;
  if p_path is null or p_path !~ '^proofs/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$' or not public.proof_exists(p_path) then
    raise exception 'Please upload a screenshot of your GCash payment.';
  end if;

  update public.orders
     set payment_status = 'pending_verification',
         gcash_reference = v_ref,
         gcash_proof_path = p_path,
         payment_rejection_reason = null
   where id = o.id;
  insert into public.order_status_history (order_id, status, note)
  values (o.id, 'proof_resubmitted', 'New GCash payment proof submitted (Ref: ' || v_ref || ').');
end $$;

-- ---------------------------------------------------------------------
-- Admin: every order state change goes through here so it is validated,
-- written to order_status_history (with who did it) and broadcast.
-- ---------------------------------------------------------------------
create or replace function public.admin_order_action(
  p_order_id uuid,
  p_action text,
  p_note text default null,
  p_amount numeric default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  o public.orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_uid uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;

  case p_action
    -- "Confirm Order" works for both payment methods. For GCash it also
    -- verifies the payment (same result as mark_paid).
    when 'confirm' then
      if o.order_status <> 'processing' then
        raise exception 'Only orders awaiting confirmation can be confirmed.';
      end if;
      if o.payment_method = 'gcash' then
        if o.payment_status not in ('pending_verification', 'rejected') then
          raise exception 'This GCash order has no payment waiting for verification.';
        end if;
        update public.orders
           set payment_status = 'paid', order_status = 'confirmed', payment_rejection_reason = null,
               cancel_requested = false
         where id = o.id;
        v_status := 'payment_confirmed';
        v_note := coalesce(v_note, 'GCash payment verified. Your order is confirmed.');
      else
        update public.orders set order_status = 'confirmed', cancel_requested = false where id = o.id;
        v_status := 'confirmed';
        v_note := coalesce(v_note, 'Your order has been confirmed by phone.');
      end if;

    when 'mark_paid' then
      if o.payment_method <> 'gcash' or o.payment_status not in ('pending_verification', 'rejected')
         or o.order_status <> 'processing' then
        raise exception 'This order has no GCash payment waiting for verification.';
      end if;
      update public.orders
         set payment_status = 'paid', order_status = 'confirmed', payment_rejection_reason = null,
             cancel_requested = false
       where id = o.id;
      v_status := 'payment_confirmed';
      v_note := coalesce(v_note, 'GCash payment verified.');

    when 'reject_payment' then
      if o.payment_method <> 'gcash' or o.payment_status <> 'pending_verification' or o.order_status <> 'processing' then
        raise exception 'This order has no GCash payment waiting for verification.';
      end if;
      if v_note is null then
        raise exception 'A reason is required to reject a payment.';
      end if;
      update public.orders set payment_status = 'rejected', payment_rejection_reason = v_note where id = o.id;
      v_status := 'payment_rejected';

    when 'preparing' then
      if o.order_status <> 'confirmed' then
        raise exception 'Only confirmed orders can be marked as Preparing.';
      end if;
      update public.orders set order_status = 'preparing' where id = o.id;
      v_status := 'preparing';

    when 'out_for_delivery' then
      if o.order_status <> 'preparing' then
        raise exception 'Only orders being prepared can be marked Out for Delivery.';
      end if;
      update public.orders set order_status = 'out_for_delivery' where id = o.id;
      v_status := 'out_for_delivery';

    when 'delivered' then
      if o.order_status <> 'out_for_delivery' then
        raise exception 'Only orders out for delivery can be marked Delivered.';
      end if;
      update public.orders
         set order_status = 'delivered',
             payment_status = case when o.payment_method = 'cod' then 'paid'::public.payment_status else payment_status end
       where id = o.id;
      v_status := 'delivered';

    when 'cancel' then
      if o.order_status in ('delivered', 'cancelled') then
        raise exception 'This order can no longer be cancelled.';
      end if;
      if v_note is null then
        raise exception 'A reason is required to cancel an order.';
      end if;
      update public.orders
         set order_status = 'cancelled', cancel_reason = v_note, cancel_requested = false
       where id = o.id;
      v_status := 'cancelled';

    when 'decline_cancel_request' then
      if not o.cancel_requested then
        raise exception 'There is no pending cancellation request.';
      end if;
      update public.orders set cancel_requested = false where id = o.id;
      v_status := 'cancel_request_declined';
      v_note := coalesce(v_note, 'Your cancellation request was declined. Please contact us if you have questions.');

    when 'set_delivery_fee' then
      if p_amount is null or p_amount < 0 or p_amount > 100000 then
        raise exception 'Please enter a valid delivery fee.';
      end if;
      if o.order_status = 'cancelled' then
        raise exception 'Cannot set a delivery fee on a cancelled order.';
      end if;
      update public.orders
         set delivery_fee = round(p_amount, 2), total = subtotal + round(p_amount, 2)
       where id = o.id;
      v_status := 'delivery_fee_updated';
      v_note := 'Delivery fee set to ₱' || to_char(round(p_amount, 2), 'FM999,999,990.00') || '.';

    else
      raise exception 'Unknown action: %', p_action;
  end case;

  insert into public.order_status_history (order_id, status, note, changed_by, changed_by_email)
  values (o.id, v_status, v_note, v_uid, v_email);
end $$;

-- ---------------------------------------------------------------------
-- Realtime: notify the tracking page of changes on a token-named channel.
-- Only a "something changed" ping is sent; the page re-reads the order via
-- get_order_by_token, so nothing leaks to anyone without the token.
-- ---------------------------------------------------------------------
create or replace function public.broadcast_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if tg_table_name = 'orders' then
    v_token := new.tracking_token;
  else
    select tracking_token into v_token from public.orders where id = new.order_id;
  end if;
  if v_token is not null then
    begin
      perform realtime.send(jsonb_build_object('at', now()), 'order_updated', 'order:' || v_token, false);
    exception when others then
      null; -- realtime unavailable: the tracking page also polls
    end;
  end if;
  return null;
end $$;

drop trigger if exists orders_broadcast on public.orders;
create trigger orders_broadcast after update on public.orders
  for each row execute function public.broadcast_order_change();

drop trigger if exists order_status_history_broadcast on public.order_status_history;
create trigger order_status_history_broadcast after insert on public.order_status_history
  for each row execute function public.broadcast_order_change();

-- ---------------------------------------------------------------------
-- Execute permissions
-- ---------------------------------------------------------------------
revoke execute on function public.place_order(jsonb) from public;
revoke execute on function public.get_order_by_token(text) from public;
revoke execute on function public.get_order_summaries(text[]) from public;
revoke execute on function public.find_order(text, text) from public;
revoke execute on function public.request_cancellation(text, text) from public;
revoke execute on function public.resubmit_gcash_proof(text, text, text) from public;
revoke execute on function public.get_checkout_info() from public;
revoke execute on function public.admin_order_action(uuid, text, text, numeric) from public, anon;
revoke execute on function public.delivery_window() from public;

grant execute on function public.place_order(jsonb) to anon, authenticated;
grant execute on function public.get_order_by_token(text) to anon, authenticated;
grant execute on function public.get_order_summaries(text[]) to anon, authenticated;
grant execute on function public.find_order(text, text) to anon, authenticated;
grant execute on function public.request_cancellation(text, text) to anon, authenticated;
grant execute on function public.resubmit_gcash_proof(text, text, text) to anon, authenticated;
grant execute on function public.get_checkout_info() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.admin_order_action(uuid, text, text, numeric) to authenticated;

-- ===================== migrations/20261007000300_seed_menu.sql =====================
-- =====================================================================
-- MGL Food Hub — menu seed. GENERATED by scripts/generate-seed.mjs.
-- Do not edit by hand; edit scripts/menu-data.mjs and regenerate.
-- =====================================================================

insert into public.hub_categories (id, name, slug, sort) values
  ('fb5b211c-c4e1-5839-b1e0-b68faac47bea', 'Puto & Kakanin', 'puto-kakanin', 1),
  ('5766fd4d-eed3-5778-a5d9-bb78a2db89aa', 'Pancit & Bilao', 'pancit-bilao', 2),
  ('89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', 'Restaurants', 'restaurants', 3),
  ('506ed5af-9b3b-5c30-b057-8b241bcaebec', 'Carinderia', 'carinderia', 4),
  ('dcbee9ff-c279-51b4-a25e-d4a9d966b4f1', 'Merienda & Street Food', 'merienda-street-food', 5),
  ('95cfcde3-e9a6-5cc2-a0c5-2f2e6ca365ff', 'Diner', 'diner', 6),
  ('ad7877f7-2ab6-5c6f-a55d-06d24303a2e3', 'Sisig & Crispy Favorites', 'sisig-crispy-favorites', 7)
on conflict (id) do nothing;

insert into public.stores (id, slug, name, tagline, hub_category_id, open_time, close_time, address, contact_note, cover_image_url, menu_image_url, is_accepting_orders, sort) values
  ('825ac953-132e-5492-b28d-9c90bed43cf8', 'hazels-special-puto', 'Hazel''s Special Puto', 'Freshly Steamed & Delicious!', 'fb5b211c-c4e1-5839-b1e0-b68faac47bea', '07:00', '12:00', null, null, '/menus/hazels-special-puto.jpg', '/menus/hazels-special-puto.jpg', true, 1),
  ('b9e4c752-717e-52a2-9c69-2c0a6c16ed36', 'aling-melys-carinderia', 'Aling Mely''s Carinderia', null, '506ed5af-9b3b-5c30-b057-8b241bcaebec', '09:00', '21:00', null, null, '/menus/aling-melys-carinderia.jpg', '/menus/aling-melys-carinderia.jpg', true, 2),
  ('ea479bb9-bf61-5f08-9a97-d39c6883a525', 'okoy-ni-jay-r', 'Okoy ni Jay R!', 'Crispy on the outside, Loaded with Sarap inside! – Made with love para sa''yo!', 'dcbee9ff-c279-51b4-a25e-d4a9d966b4f1', '07:30', '20:00', null, 'For orders, message Jay R-D Original Okoy', '/menus/okoy-ni-jay-r.jpg', '/menus/okoy-ni-jay-r.jpg', true, 3),
  ('e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', 'aurings-special-pancit-malabon', 'Auring''s Special Pancit Malabon', null, '5766fd4d-eed3-5778-a5d9-bb78a2db89aa', '09:00', '17:00', null, null, '/menus/aurings-special-pancit-malabon.jpg', '/menus/aurings-special-pancit-malabon.jpg', true, 4),
  ('a255909e-5058-5749-bf24-f4f2c8110ac1', 'normas-special-pancit-bilao', 'Norma''s Special Pancit Bilao', null, '5766fd4d-eed3-5778-a5d9-bb78a2db89aa', '09:00', '18:00', null, null, '/menus/normas-special-pancit-bilao.jpg', '/menus/normas-special-pancit-bilao.jpg', true, 5),
  ('f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'balsa-sa-niugan', 'Balsa sa Niugan', 'Floating Restaurant & Fishing Garden', '89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', '10:00', '22:00', '#3 M. Aquino Street, Niugan, Malabon City', null, '/menus/balsa-sa-niugan.jpg', '/menus/balsa-sa-niugan.jpg', true, 6),
  ('c9288804-cda0-5b4e-ae3b-387f5ed96172', 'original-benjie-puto-pao', 'Original Benjie Puto Pao', null, 'fb5b211c-c4e1-5839-b1e0-b68faac47bea', '08:00', '19:00', null, 'Prices are per piece', '/menus/original-benjie-puto-pao.jpg', '/menus/original-benjie-puto-pao.jpg', true, 7),
  ('86d4db53-0799-50d5-bf64-c96a127e9eb1', 'raves-diner', 'Raves Diner', null, '95cfcde3-e9a6-5cc2-a0c5-2f2e6ca365ff', '11:00', '23:00', null, null, '/menus/raves-diner.jpg', '/menus/raves-diner.jpg', true, 8),
  ('76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'mary-jay', 'Mary Jay', 'Since 1966', '89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', '10:00', '22:00', null, null, '/menus/mary-jay.jpg', '/menus/mary-jay.jpg', true, 9),
  ('55c05919-6fd3-5662-9176-cc1dae43537b', 'rody-days', 'Rody Day''s', 'Good Food, Great Moments', '89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', '10:00', '21:00', null, null, '/menus/rody-days.jpg', '/menus/rody-days.jpg', true, 10),
  ('9c32b2d9-bda5-5aed-9cdf-70ceb4ab566f', 'anny-dading-peachy-peachy', 'Anny ♥ Dading Peachy-Peachy', 'Pighta • Sarap • Pamilya', 'fb5b211c-c4e1-5839-b1e0-b68faac47bea', '06:00', '20:00', null, 'Pricelist effective April 2, 2026', '/menus/anny-dading-peachy-peachy.jpg', '/menus/anny-dading-peachy-peachy.jpg', true, 11),
  ('5d4776d7-61d8-5535-974c-6bed41f7e005', 'judy-anns-crispy-pata', 'Judy Ann''s Crispy Pata', 'Good Food Brings People Together', '89ac3bc0-2fd2-5f7f-9b76-dd1a48f704e6', '10:00', '22:00', null, null, '/menus/judy-anns-crispy-pata.jpg', '/menus/judy-anns-crispy-pata.jpg', true, 12),
  ('037d0dd2-97e4-5304-9b38-205890f3836f', 'sisig-ni-mutik', 'Sisig ni Mutik', 'Crispy • Saucy • Yummy', 'ad7877f7-2ab6-5c6f-a55d-06d24303a2e3', '10:00', '21:00', null, null, '/menus/sisig-ni-mutik.jpg', '/menus/sisig-ni-mutik.jpg', true, 13)
on conflict (id) do nothing;

insert into public.menu_sections (id, store_id, name, note, sort) values
  ('d9dec416-5d93-541f-8d05-129b07a8e42d', '825ac953-132e-5492-b28d-9c90bed43cf8', 'Mix', null, 1),
  ('bdfa44bd-c841-5368-818a-da65f18c0c47', '825ac953-132e-5492-b28d-9c90bed43cf8', 'Puto Pao', null, 2),
  ('6ff4d558-ce7e-5917-935e-e7a6ddb3267e', '825ac953-132e-5492-b28d-9c90bed43cf8', 'Puto', null, 3),
  ('17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', 'Ulam', null, 1),
  ('acc0347f-c405-5e92-accb-0a18456d2fb8', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'Okoy', null, 1),
  ('dbc4c0fa-9c2e-5c01-b56f-d8c07170386c', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', 'Bilao', null, 1),
  ('16689efd-afc7-5006-84dd-6b545250d5f7', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', 'Styro', null, 2),
  ('742e314e-fbfc-50a0-aefe-ef4966c0c600', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', 'Puto', null, 3),
  ('cd47d70b-dc50-5adf-9e5c-d622904d83ff', 'a255909e-5058-5749-bf24-f4f2c8110ac1', 'Pancit Bilao', null, 1),
  ('7a127c0b-f77b-5214-9322-35a35b320898', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Tilapia', null, 1),
  ('5c1168ac-7a40-5543-a369-89e8ff674164', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Tuna', null, 2),
  ('cb4c3a78-23c8-50df-9efb-088397da49f2', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Bangus (Boneless)', null, 3),
  ('e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Beef', null, 4),
  ('ecd86074-d109-5642-85fb-f03b16fe416d', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Chicken', null, 5),
  ('3272e6d9-f690-5870-a066-c32b2de559a6', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Pork', null, 6),
  ('5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Vegetables', null, 7),
  ('f85499bb-e6b8-57a8-a1cc-a14da618c267', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Squid', null, 8),
  ('ec0481b8-bf14-5785-85f8-468850589319', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Shrimp', null, 9),
  ('63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Other Seafoods', null, 10),
  ('97aed254-36c0-570f-8c5b-1284167845ff', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Special Appetizers', null, 11),
  ('1b3a5958-0473-5da4-802d-ed1c7752df61', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Exotic Foods', null, 12),
  ('4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Short Order', null, 13),
  ('35ba6e1d-39a9-5eb7-a231-367e63ec9fb1', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Soup', null, 14),
  ('6550c1dd-d376-54e4-9edf-efd4b305a6a7', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Rice', null, 15),
  ('93282edd-69ed-568f-85ed-1e4ee98ae7a7', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'Desserts', null, 16),
  ('57269b3b-835d-50f3-a758-e92c5ca921ed', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', 'Puto Pao', 'Prices are per piece', 1),
  ('18ff8422-d509-5f5f-9df9-798332ac8d9b', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', 'Puto', 'Prices are per piece', 2),
  ('fed26e69-26a2-599c-ab01-8cf49135e3cf', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Meals', null, 1),
  ('7dbf2ce3-c7ce-53b0-b813-c64f3eca7765', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Platter', null, 2),
  ('4e4623c9-9601-556b-b022-e914aee38745', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Sandwiches', null, 3),
  ('210d6373-12e7-58c8-8ef3-2e392d4d79b1', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Pasta', null, 4),
  ('d03996a7-7314-58f9-8957-f0cb12444738', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Snacks', null, 5),
  ('28efb2b0-0742-5e43-a6a6-bb4186754630', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Sides', null, 6),
  ('e24f2c18-2af2-5fe5-95e7-8ec4321d3cdb', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Sinigang', null, 7),
  ('5073dcae-ca9a-5035-848f-241d89099cd4', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Smoked Slabs', null, 8),
  ('5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Croffles', null, 9),
  ('d75b0143-c813-5750-b995-77eb6613e151', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'Drinks', null, 10),
  ('6b82e50e-561a-5373-a838-29a0c33d79df', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Single Serving', null, 1),
  ('9de9da4a-29f2-5af5-a707-27c17951c622', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Rice', null, 2),
  ('6a938ac9-882c-5a29-a95a-25cf9a978cd7', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Vegetables', null, 3),
  ('5c4e25c9-781b-5015-90b2-fdb978a91738', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Noodles', null, 4),
  ('d635794b-f291-596c-85e0-20d7c077dc77', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Sizzling Plates', null, 5),
  ('28acb90c-ccbd-5679-aaed-c76b364324f0', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Desserts', null, 6),
  ('d045129e-bb6b-51b5-9e2e-9dc328bba9a0', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Chicken', null, 7),
  ('a790e4ca-86cf-54b9-ad0e-cb091cbcf433', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Beef', null, 8),
  ('cfb466da-b1f6-555f-bcec-eec128780883', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Pork', null, 9),
  ('3c7dec47-25b0-595b-a38f-fe1ce369c0c6', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Seafoods', null, 10),
  ('e23706a2-f85c-5fff-8e18-0949e19ec75b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Appetizers', null, 11),
  ('52cb44c9-9135-5d22-9139-e14d6259843a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Mary Jay''s Torta', null, 12),
  ('2f7c0c54-e068-5540-b1a0-f92a33f82fc7', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Beermates & Accompaniments', null, 13),
  ('4ab11a65-7f19-5478-915f-113692b1dc2f', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Sandwiches', null, 14),
  ('8038ec3d-0a90-52c8-b173-8924f5758774', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Soup (8 to 10 persons)', null, 15),
  ('e42fae17-1b80-5723-9b12-635bc25bf0fd', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Beverages', null, 16),
  ('d12a0dd3-c039-5e25-80e8-47894621b83b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'Liquors', null, 17),
  ('ab2bf64d-9f56-5de5-8e78-39ba07a267b4', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Fried', null, 1),
  ('48b4c450-c3c2-5a3e-bb0c-909f53d960ca', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Fried Chicken', null, 2),
  ('9edb1b28-d4d3-5244-8c45-6528677661d1', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Breaded Chicken', null, 3),
  ('7f7f980f-ac88-5625-bac8-b85129446c16', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Buttered Chicken', null, 4),
  ('d07768cb-86fa-5d15-a102-5b638613866a', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Additional Menu', null, 5),
  ('e5a1e440-a251-5de7-848e-746ebe83e501', '55c05919-6fd3-5662-9176-cc1dae43537b', 'Pancit Bilao', null, 6),
  ('2c7828f4-5dca-5aea-b9d3-531907ea4f9c', '9c32b2d9-bda5-5aed-9cdf-70ceb4ab566f', 'Peachy-Peachy Boxes', 'Tick "Add Extra Toppings" for more cheese or coconut.', 1),
  ('a027bea9-f11d-5f7b-8e32-8812d425f1f4', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Crispy Pata', null, 1),
  ('95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Pork', null, 2),
  ('16fbc1d9-45f2-58e8-aec7-5f39c4a38781', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Chicken', null, 3),
  ('c75266eb-ba86-500e-9d76-5f418236e896', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Vegetables', null, 4),
  ('5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Seafood', null, 5),
  ('574ac9d3-6403-5fb2-b6d8-4be95aef196e', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Filipino Favorites', null, 6),
  ('ad0be861-5708-5465-bc15-c1f8ce08cc0e', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Noodles', null, 7),
  ('8af30ecf-ce1b-51de-a60d-68b27cc0cfc0', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Soup', null, 8),
  ('f86e1f7a-21d1-5d2a-a0fb-3ade0d1ac92f', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Rice', null, 9),
  ('98c897d5-e688-53fe-9179-ff632ac0cbb6', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'Drinks', null, 10),
  ('96011b37-833e-5758-9dec-e50cb92e8f50', '037d0dd2-97e4-5304-9b38-205890f3836f', 'Crispy Sisig', null, 1),
  ('c1585757-da4b-5b43-8cab-6b0dff78e442', '037d0dd2-97e4-5304-9b38-205890f3836f', 'Crispy Bagnet', null, 2),
  ('327837cb-4170-54c8-887b-2d5a952eb1ec', '037d0dd2-97e4-5304-9b38-205890f3836f', 'Rice Meals & Shanghai', null, 3),
  ('35e116b4-3215-5341-8baa-36c977599c96', '037d0dd2-97e4-5304-9b38-205890f3836f', 'Bilao', null, 4),
  ('b966cf5d-e8f7-5bcb-980c-9a3e0cdbdf96', '037d0dd2-97e4-5304-9b38-205890f3836f', 'Crispy Pata', null, 5)
on conflict (id) do nothing;

insert into public.products (id, store_id, section_id, name, description, badge, sort) values
  ('9b061b07-40e4-56e1-a885-dc188bf5d22a', '825ac953-132e-5492-b28d-9c90bed43cf8', 'd9dec416-5d93-541f-8d05-129b07a8e42d', 'Mix', null, null, 1),
  ('bcaa3865-f1db-5afb-ab9d-487f1499f84f', '825ac953-132e-5492-b28d-9c90bed43cf8', 'bdfa44bd-c841-5368-818a-da65f18c0c47', 'Puto Pao', null, null, 1),
  ('4a5f9b52-aa80-577e-be6a-05b6e3132463', '825ac953-132e-5492-b28d-9c90bed43cf8', '6ff4d558-ce7e-5917-935e-e7a6ddb3267e', 'Puto', null, null, 1),
  ('4c94f58c-abe0-5edf-ae65-0fba5ea72e0c', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Bangus sa Bayabas', null, null, 1),
  ('237cefbe-e630-5fc2-b52e-03f51844399d', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Sarsiado Isda', null, null, 2),
  ('53ab1652-8003-51c1-94a6-2bf72e18ea52', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Beef Steak', null, null, 3),
  ('b55ef39d-d348-5208-a0c2-372421451ff9', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Pangat', null, null, 4),
  ('f54f5f10-87df-5de3-92b0-d36e402b0e92', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Sayote', null, null, 5),
  ('91f7e708-b58c-558f-a930-c7031bd952e3', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Togue', null, null, 6),
  ('74cb7bc7-8847-574c-ae0a-b89ec22ab54b', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Alamang', null, null, 7),
  ('5e5b9720-31cb-5183-aa6d-85552f9419dd', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Mga Gulay', null, null, 8),
  ('411fc09c-b655-5623-acb2-a943268dfc63', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Adobo Pusit', null, null, 9),
  ('560d662e-b96e-5f60-8189-392353dd51d3', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Relyenong Pusit', null, null, 10),
  ('0e7debd6-835b-55ee-b87f-9ac45456b211', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Pritong Bangus', null, null, 11),
  ('6727e4de-38f8-5dcb-b0de-e4b0dcc65326', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Totso', null, null, 12),
  ('c1f68b39-86cc-5e0b-b423-53a01f801cfc', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Litson Kawali', null, null, 13),
  ('5dc8c57e-f855-590d-b68c-d65ed5dfb1da', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Paksiw na Pata', null, null, 14),
  ('9f375114-e70c-5cba-a13b-f1d6b3ec51b9', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Escabeche', null, null, 15),
  ('2b1c44bb-106a-5890-bdd6-5d884305233d', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Mechado', null, null, 16),
  ('f057cfe5-5f83-5006-b3e8-16e13ac5d4bc', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Kaladereta', null, null, 17),
  ('3e8ac602-ed84-5abd-bd9d-fe5e4e03a236', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Bola Sarsa', null, null, 18),
  ('c1624cd3-74d7-59e5-8785-8311a7c94020', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Bola Sweet', null, null, 19),
  ('57b2034b-10e4-5dc4-af72-14877a5c3f9b', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Tapa', null, null, 20),
  ('c35f89b8-29c3-5566-ad92-dc1508b89363', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Bopis', null, null, 21),
  ('c78ff966-13f1-5851-bda7-dbb6aa2de8a0', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Tortang Alimasag', null, null, 22),
  ('025ce949-257c-512b-892a-f193a61cb749', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Paksiw na Litson', null, null, 23),
  ('26ce674c-7d12-57b6-aff6-dd1cffde4d36', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Menudo', null, null, 24),
  ('cc94f4bc-9a8a-5655-997d-da4172ec9fec', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Tinumis', null, null, 25),
  ('e27776e9-9b65-5181-8124-1a28f26fdfc7', 'b9e4c752-717e-52a2-9c69-2c0a6c16ed36', '17813d9f-3dfc-5eae-9fc0-76e186ed4ee2', 'Kare Kare', null, null, 26),
  ('ae027226-3948-5c8d-a294-a8befccde07f', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'acc0347f-c405-5e92-accb-0a18456d2fb8', 'Regular Okoy', 'Mejo manipis at bilang lang ang hipon.', null, 1),
  ('40021217-9348-5923-a99d-9168ed6cdc11', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'acc0347f-c405-5e92-accb-0a18456d2fb8', 'Regular Okoy w/ Tofu', 'Togue''t kalabasa, hipon at may add na tofu.', null, 2),
  ('acfafe0e-8212-5cb3-888e-a20a1c96d04a', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'acc0347f-c405-5e92-accb-0a18456d2fb8', 'Veggies Okoy', 'All veggies, togue''t kalabasa, pwede din lagyan ng tofu.', null, 3),
  ('1b4dae7d-b1c2-58fa-9ddf-64ea03a150db', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'acc0347f-c405-5e92-accb-0a18456d2fb8', 'Special Okoy', 'Dinoble, dinoble ang gulay esp. kalabasa at maraming hipon.', 'best_seller', 4),
  ('0b607dc6-ac23-5940-8777-1438d14ca2c4', 'ea479bb9-bf61-5f08-9a97-d39c6883a525', 'acc0347f-c405-5e92-accb-0a18456d2fb8', 'Super Special Okoy', 'Dinobleng togue''t kalabasa, generous sa hipon at may added na tofu at onion rings!', 'best_seller', 5),
  ('774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', 'dbc4c0fa-9c2e-5c01-b56f-d8c07170386c', 'Pancit Malabon Bilao', null, null, 1),
  ('0903c21a-2215-55ee-88f0-431ec1795731', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', '16689efd-afc7-5006-84dd-6b545250d5f7', 'Pancit Malabon Styro', null, null, 1),
  ('c90ad6e0-aa32-552d-a04b-b95e0950b908', 'e1b1ce8d-ae29-5daf-a4f5-e0898133cf55', '742e314e-fbfc-50a0-aefe-ef4966c0c600', 'Puto', null, null, 1),
  ('0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'a255909e-5058-5749-bf24-f4f2c8110ac1', 'cd47d70b-dc50-5adf-9e5c-d622904d83ff', 'Pancit Bilao', null, null, 1),
  ('ee806dfe-2175-572e-98c6-b5a4d7f17158', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Tilapia Sisig', null, null, 1),
  ('211e713c-999d-5d44-8254-d441cbe10ec6', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Sizzling w/ Spicy Veggies', null, null, 2),
  ('a8a4f37f-9788-5adc-b0e0-2964bffbaa07', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Steamed w/ Oyster & Garlic', null, null, 3),
  ('ae26a2fd-3ae7-5412-8376-0b4895130e87', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Steamed w/ Mayonnaise & Cheese', null, null, 4),
  ('6b91fc95-e46c-51b3-8e0c-e8f2b4842bf2', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Deep Fried w/ Garlic', null, null, 5),
  ('71342e88-814d-51d8-ac70-c440b4a41d42', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Grilled', null, null, 6),
  ('3bdc68e7-8048-5dd6-a362-9b00133cb545', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Pinaputok w/ Onion & Tomato', null, null, 7),
  ('a3d1bbe1-cd12-52c7-a5a9-4f326627b674', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '7a127c0b-f77b-5214-9322-35a35b320898', 'Ginataang Tilapia', null, null, 8),
  ('b08d3d2e-b762-5de9-a527-d97f2c08a684', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5c1168ac-7a40-5543-a369-89e8ff674164', 'Sizzling Panga', null, null, 1),
  ('2cd528a5-f78b-551d-a35f-669a2b93171c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5c1168ac-7a40-5543-a369-89e8ff674164', 'Grilled Panga', null, null, 2),
  ('1193d476-6bd2-5790-9091-49e5c3dab742', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5c1168ac-7a40-5543-a369-89e8ff674164', 'Sizzling Belly', null, null, 3),
  ('790263e5-cdb6-5ee0-9403-b763d79a0b56', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5c1168ac-7a40-5543-a369-89e8ff674164', 'Grilled Belly', null, null, 4),
  ('2d7e7369-42df-51fc-acdc-8c83f38c1773', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5c1168ac-7a40-5543-a369-89e8ff674164', 'Sinigang sa Miso', null, null, 5),
  ('ac604289-49f7-500e-a847-abf0150e13e5', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'cb4c3a78-23c8-50df-9efb-088397da49f2', 'Sinigang Bangus Belly', null, null, 1),
  ('45a8ddf9-68f8-5cf7-bd83-021abf64e847', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'cb4c3a78-23c8-50df-9efb-088397da49f2', 'Sizzling Bangus Belly (4pcs.)', null, null, 2),
  ('7b457bf2-51d0-5734-b009-2ad07e4b6b41', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'cb4c3a78-23c8-50df-9efb-088397da49f2', 'Bangus Ala Pobre', null, null, 3),
  ('2693d90b-7c86-5403-b341-c4bc0d87f014', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'cb4c3a78-23c8-50df-9efb-088397da49f2', 'Bangus w/ Tomato & Onion Wrap', null, null, 4),
  ('ff1cdb8e-4cf7-55bf-aac2-d3ea7994f5f1', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'cb4c3a78-23c8-50df-9efb-088397da49f2', 'Rellenong Bangus', null, null, 5),
  ('1c08fae2-6e2d-5913-b984-a69637d69779', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Balsa Kare-Kare', null, null, 1),
  ('2912f48b-36cd-5590-b1ce-1f18713d7586', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Beef Steak', null, null, 2),
  ('29c05eef-6602-5d8a-a89e-dd931b6461ae', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Beef Tapa', null, null, 3),
  ('7682284c-42c8-5c18-b4a9-793080c925cb', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Sizzling Beef in Chili Garlic Sauce', null, null, 4),
  ('1b1d37db-1f87-5fcf-aa75-6b36c1893e0f', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Sizzling Beef Litid', null, null, 5),
  ('e5498a23-b0ce-5d99-8dd1-113106949444', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Sizzling Korean Beef', null, null, 6),
  ('887ec054-58aa-545d-8573-5d58d6f18c5b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Sinigang na Baka', null, null, 7),
  ('722fc91a-2460-5115-9992-3443763af716', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Nilagang Baka', null, null, 8),
  ('e1707b42-3dcd-5ee1-94ee-ef3b62dbd336', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'e1e23ca5-b915-5e73-b7a7-3693d78b437c', 'Sizzling T-Bone Steak (w/ Veg. Sidings)', null, null, 9),
  ('a42953eb-78d1-5746-8034-e7c33ce4b48b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Balsa Chicken', null, null, 1),
  ('93174e20-8e8a-5d2d-9c61-1ccc212addca', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Sizzling Chicken w/ Gravy Sauce', null, null, 2),
  ('489eb85b-4f87-57e9-85e6-cf1c70a937a2', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Sizzling Spicy Chicken w/ Chili Garlic Sauce', null, null, 3),
  ('c598e435-3360-503c-93b5-b2461a651f60', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Sizzling Spicy Chicken Feet', null, null, 4),
  ('6f2e7318-917d-5756-baa4-b99284da6504', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Sizzling Buffalo Wings (4 pcs.)', null, null, 5),
  ('a7374898-2b5e-555e-bf5d-d74f0f96ae4b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Sizzling Ajay Palabonalunan', null, null, 6),
  ('520b75ac-8609-5796-9ea8-1c986e45b703', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ecd86074-d109-5642-85fb-f03b16fe416d', 'Chicken BBQ Legs', null, null, 7),
  ('f1e0e34f-a27a-5397-a24e-80d3fab41962', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Sizzling Sisig', null, null, 1),
  ('38674c61-13d3-51aa-9280-dc138cb1f24e', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Crispy Pata', null, null, 2),
  ('3b366816-f88e-57cb-94fc-e5bc1ccf31b6', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Crispy Ulo', null, null, 3),
  ('0a45c25d-19f9-54bd-9c79-9eb64647a66f', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Pork Liempo BBQ', null, null, 4),
  ('556e62cf-4832-5432-9fa7-9d20cf18c02a', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Lechon Kawali', null, null, 5),
  ('280e9727-c98e-5bce-8f6b-297d665c0a33', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Chicharon Bulaklak', null, null, 6),
  ('aa2ad7b6-01d7-51c0-a9c3-2120e533da68', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Sinigang na Liempo', null, null, 7),
  ('8c14df94-9f06-522a-94c8-70a00c1ae9c7', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '3272e6d9-f690-5870-a066-c32b2de559a6', 'Nilagang Liempo', null, null, 8),
  ('7a0403c8-109b-55a4-ac69-858967586891', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'Ampalaya con Hipon', null, null, 1),
  ('f43a9d56-cf5e-55be-9f03-babe5dfdc111', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'Beef Ampalaya', null, null, 2),
  ('8bdef3a4-7108-549d-8f02-1dd50e6f05d3', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'Chopsuey', null, null, 3),
  ('774c7dca-26a7-5ce4-9945-b51bb0d20834', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'Pinakbet', null, null, 4),
  ('bfb24808-3e20-5acc-92b6-1247db75889e', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '5b90b8c7-c104-5fdd-a871-3680fe42a4df', 'Vegetable Sticks w/ Mayo Dipping', null, null, 5),
  ('251cfe4c-1e1d-59a0-9f72-cfb1ee5ec441', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'Sizzling', null, null, 1),
  ('5cb3e253-8d0d-5637-8fe3-5b519f954c56', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'Grilled', null, null, 2),
  ('7b926404-1224-5f84-b74a-89d6382717fa', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'w/ Onions & Tomato Fillings', null, null, 3),
  ('79d374d5-4a88-5075-afab-04f4b4b1fb72', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'Calamares', null, null, 4),
  ('c408411f-4b81-556b-8e18-e24d901b0375', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'Sizzling Japanese Ika', null, null, 5),
  ('2430c967-965b-5ec4-bde9-55427499c0ef', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'f85499bb-e6b8-57a8-a1cc-a14da618c267', 'Crispy Squid Head', null, null, 6),
  ('e8172b43-8381-533c-96cd-f111c2ffaab5', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Sizzling Spicy w/ Chili Garlic Sauce', null, null, 1),
  ('cfd464bd-f36d-5304-8f17-2957eeb08c1a', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Sizzling Gambas', null, null, 2),
  ('3e9673eb-fc68-53dc-9970-6ab7bc8716b2', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Shrimp w/ Oyster Sauce', null, null, 3),
  ('2659c41c-5fac-5a0e-9fa4-bd3d065428a4', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Camaron Rebosado', null, null, 4),
  ('f5734d9a-8ea5-57ef-a1aa-efb8eeacb6b4', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Talabos', null, null, 5),
  ('0de96299-e7de-5b94-8644-db47c940ac38', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', 'ec0481b8-bf14-5785-85f8-468850589319', 'Sinigang na Hipon', null, null, 6),
  ('dce2d350-0fbe-522d-8374-56609a66cfbb', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'Fish Fillet in Sweet & Sour', null, null, 1),
  ('a55c6313-faec-59e2-99a0-b9fbd62198bb', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'Fried Fish Fillet', null, null, 2),
  ('6f80d7ca-74fe-5b81-892d-6afb63cee34c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'Kilawin (Talaba)', null, null, 3),
  ('4c2cffe9-58e7-5d80-b0a0-ed015de94b40', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'Deep Fried Salmon Head', null, null, 4),
  ('9602d7d8-052f-5055-8953-06d1136b59e2', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '63bc0ec2-bb12-50ae-950c-16f4aa13af8c', 'Sinigang sa Miso Salmon Head', null, null, 5),
  ('b72d0119-8b19-5f3a-be76-b6fabbc66610', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Cheese Sticks', null, null, 1),
  ('db7db549-6f39-5980-9bde-49e26afc5cfa', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Chili Cheese Bite', null, null, 2),
  ('1ad9c618-e5b8-51d6-8eae-e48c75bd2028', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Fish Shanghai Roll', null, null, 3),
  ('29df70d0-5ceb-5f80-97fa-4102b4a249ef', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'French Fries', null, null, 4),
  ('1705a69e-8fef-5d8b-8f37-f6d1134cbc5c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Lumpiang Shanghai', null, null, 5),
  ('55d0a31e-e677-58e1-a934-e08533861c32', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Onion Rings', null, null, 6),
  ('4a9e04cf-d8d6-5082-bcb1-a66532bfd21b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sliced Pipino', null, null, 7),
  ('aab56bbc-ab83-5349-af78-fd7b1ab46b1a', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Tokwa''t Baboy', null, null, 8),
  ('297cb954-c310-5965-86c7-af2bc1691a5a', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Kutzing Sweet Corn', null, null, 9),
  ('865d5996-3dea-58fd-85ba-e5c8daa69ec3', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sizzling Hotdog', null, null, 10),
  ('c7a510f3-b5fc-53a5-9ab1-0aedb2a54a10', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sizzling Sausage w/ Mushroom', null, null, 11),
  ('71eb3948-1be5-5b9c-b96f-77cb24e076eb', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sizzling Mushroom', null, null, 12),
  ('8a020dfd-0932-5cf4-9729-2b4d7ee3597c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sizzling Tofu w/ Special Chinese Sauce', null, null, 13),
  ('1e837c6c-202c-558c-af53-b6076ee1f8d9', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '97aed254-36c0-570f-8c5b-1284167845ff', 'Sizzling Young Corn', null, null, 14),
  ('fef1439f-f813-5299-af87-39cd14bac098', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Sizzling Adobong Kambing', null, null, 1),
  ('ea03a660-1b6f-5a7a-b5ac-0da9be24fe31', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Sizzling Kalderetang Kambing', null, null, 2),
  ('824d991a-201b-5b27-a95e-6fca79e4b683', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Adobong Igat', null, null, 3),
  ('bb5487c5-7219-5ad4-a444-b60754d2fd4b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Sizzling Adobong Kabayo', null, null, 4),
  ('d614fafb-fc16-5862-90f7-394b3b90818f', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Tapa Kabayo', null, null, 5),
  ('914d6e34-d3bc-5b79-8f32-34883d238460', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '1b3a5958-0473-5da4-802d-ed1c7752df61', 'Oyster Cake (Tortang Talaba)', null, null, 6),
  ('85d8462d-3514-5eb3-8b20-0df5c3e66abb', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'Pancit Bihon', null, null, 1),
  ('8ba79272-0410-5ffd-914f-87defacaeda3', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'Pancit Canton', null, null, 2),
  ('b7f31a65-7f5c-54d3-84f4-9fb6496aad06', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'Pancit Mixe & Bihon', null, null, 3),
  ('5333d726-fef9-54a4-864d-c2879fade6e3', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'Sotanghon Guisado', null, null, 4),
  ('07d635ed-ba7f-5140-a250-567dcea39542', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '4b58f510-7a99-5cdc-9cd0-efa1f4dd75db', 'Lomi Special', null, null, 5),
  ('338ef96f-943c-53c5-a93a-97c8571ea36e', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '35ba6e1d-39a9-5eb7-a231-367e63ec9fb1', 'Crab & Corn', null, null, 1),
  ('1685afa8-5a18-5565-be9f-dd36de8e2454', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '35ba6e1d-39a9-5eb7-a231-367e63ec9fb1', 'Chicken & Corn', null, null, 2),
  ('2a92986e-22ef-50e6-a067-841588a872aa', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '35ba6e1d-39a9-5eb7-a231-367e63ec9fb1', 'Mixed Oriental', null, null, 3),
  ('788f2fe8-ee82-5399-a6b3-6167b459c94c', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '35ba6e1d-39a9-5eb7-a231-367e63ec9fb1', 'Cream of Mushroom', null, null, 4),
  ('7e08f547-3482-50db-8883-058cb87a71ef', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '6550c1dd-d376-54e4-9edf-efd4b305a6a7', 'Pandan Rice', null, null, 1),
  ('3b8e45b1-81cb-54f0-9656-2af0df5a5826', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '6550c1dd-d376-54e4-9edf-efd4b305a6a7', 'Garlic Rice', null, null, 2),
  ('8707d650-0afa-58c2-bc74-04fe1973a14b', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '93282edd-69ed-568f-85ed-1e4ee98ae7a7', 'Fruits Salad Cup', null, null, 1),
  ('c62cdf43-f9e3-5ee6-bc28-3cc2e0d9fda3', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '93282edd-69ed-568f-85ed-1e4ee98ae7a7', 'Fruit Salad Tub', null, null, 2),
  ('2206a3fd-dba4-51a3-956d-ef69f6b5325a', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '93282edd-69ed-568f-85ed-1e4ee98ae7a7', 'Leche Flan Royale Tub', null, null, 3),
  ('90dc88f9-b38f-5ba1-a126-c8f3986220b4', 'f84901f0-17f9-5697-ae5b-f64e7107f8f5', '93282edd-69ed-568f-85ed-1e4ee98ae7a7', 'Halo-Halo', null, null, 4),
  ('fee9e19d-8f67-5764-89ff-9a9bbb8536a8', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', '57269b3b-835d-50f3-a758-e92c5ca921ed', 'Puto Pao', null, null, 1),
  ('d1b69632-9d6d-573a-af5f-9165ca46e6b7', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', '57269b3b-835d-50f3-a758-e92c5ca921ed', 'Special Puto Pao', null, null, 2),
  ('937ff8fd-b85b-526f-a2fb-4424c31abc47', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', '57269b3b-835d-50f3-a758-e92c5ca921ed', 'Flavored Puto Pao', null, null, 3),
  ('b0ba5dd5-c0e1-5bb3-9237-ee85a3eba3f1', 'c9288804-cda0-5b4e-ae3b-387f5ed96172', '18ff8422-d509-5f5f-9df9-798332ac8d9b', 'Puto', null, null, 1),
  ('ecdfc0b0-8354-5e15-bbbe-23b6b089c16a', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'fed26e69-26a2-599c-ab01-8cf49135e3cf', 'Beef Belly', null, null, 1),
  ('dc09db72-b562-59da-bd75-d15c5b81d3c8', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'fed26e69-26a2-599c-ab01-8cf49135e3cf', 'Pork Belly', null, null, 2),
  ('10e58b57-2f49-5fe1-9236-879764d4021e', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'fed26e69-26a2-599c-ab01-8cf49135e3cf', 'Pork Ribs', null, null, 3),
  ('0ae723a0-c25e-5184-b369-64bfb0fd78cd', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'fed26e69-26a2-599c-ab01-8cf49135e3cf', 'Bacon & Egg', null, null, 4),
  ('fcf236a6-6cf0-5ad2-8043-bb7a4eb46065', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'fed26e69-26a2-599c-ab01-8cf49135e3cf', 'Chicken', null, null, 5),
  ('69a5e2e3-dc3f-533a-b4c3-bc802905f1c8', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '7dbf2ce3-c7ce-53b0-b813-c64f3eca7765', 'Set A', null, null, 1),
  ('35566bdc-009f-56e9-8923-23bd266cccb9', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '7dbf2ce3-c7ce-53b0-b813-c64f3eca7765', 'Set B', null, null, 2),
  ('c656f4f7-345d-5b7e-9be1-54e9aeaef45f', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '7dbf2ce3-c7ce-53b0-b813-c64f3eca7765', 'Set C', null, null, 3),
  ('347db2a2-4b13-5638-82dc-e3d439fabeee', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '4e4623c9-9601-556b-b022-e914aee38745', 'Beef Belly', null, null, 1),
  ('b70d4d24-5c42-57e9-9a48-1b2d6c9299d5', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '4e4623c9-9601-556b-b022-e914aee38745', 'Pork Belly', null, null, 2),
  ('10b0c0e1-f9c7-5bf8-8f74-ac2ac1633d07', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '4e4623c9-9601-556b-b022-e914aee38745', 'Pulled Pork', null, null, 3),
  ('d87b7e56-923a-59f3-93f0-0230ef464072', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '4e4623c9-9601-556b-b022-e914aee38745', 'Bacon, Egg & Cheese', null, null, 4),
  ('b84bf9cd-ee22-5ab2-9e68-5c297e4da9a8', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '210d6373-12e7-58c8-8ef3-2e392d4d79b1', 'Smoked Carbonara', null, null, 1),
  ('8aac988c-b986-518e-a456-cfe5ed9c9a0a', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '210d6373-12e7-58c8-8ef3-2e392d4d79b1', 'Pesto w/ Smoked Bacon', null, null, 2),
  ('7810397d-0830-5526-9976-e20552349274', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '210d6373-12e7-58c8-8ef3-2e392d4d79b1', 'Shrimp Scampi', null, null, 3),
  ('dae63f78-1585-5aa2-a75d-330802e71df1', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd03996a7-7314-58f9-8957-f0cb12444738', 'Smoked Nachos', null, null, 1),
  ('49ca27aa-1e26-5a4e-b3bb-02437fda6626', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd03996a7-7314-58f9-8957-f0cb12444738', 'Smoked Fries', null, null, 2),
  ('dc3be106-ed50-5795-93c8-111004c01966', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd03996a7-7314-58f9-8957-f0cb12444738', 'Flavored Fries', null, null, 3),
  ('a0072722-af9d-523c-877e-66d8d018a4bd', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '28efb2b0-0742-5e43-a6a6-bb4186754630', 'Mac & Cheese', null, null, 1),
  ('da0c2e93-94fb-5129-87ca-b5dac000ee49', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '28efb2b0-0742-5e43-a6a6-bb4186754630', 'Mashed Potato', null, null, 2),
  ('45569f64-8956-545e-950a-93d859f9def7', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '28efb2b0-0742-5e43-a6a6-bb4186754630', 'Potato Marble', null, null, 3),
  ('3cf6f257-b9f1-53bf-be9a-c798e596fe93', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '28efb2b0-0742-5e43-a6a6-bb4186754630', 'Coleslaw', null, null, 4),
  ('f49caf2d-c33a-5a7a-8b5e-ad32ea6f899d', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '28efb2b0-0742-5e43-a6a6-bb4186754630', 'Creamed Corn', null, null, 5),
  ('557b61e8-76d0-5059-9a34-0d10f704b5c8', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'e24f2c18-2af2-5fe5-95e7-8ec4321d3cdb', 'Pork Belly', null, null, 1),
  ('3c6d7bb5-edb0-5635-8960-87fbec93e637', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'e24f2c18-2af2-5fe5-95e7-8ec4321d3cdb', 'Pork Ribs', null, null, 2),
  ('14fba68b-c7c9-50d9-8dd2-a4e331a25f1c', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'e24f2c18-2af2-5fe5-95e7-8ec4321d3cdb', 'Beef Belly', null, null, 3),
  ('02916b44-1b33-550a-9ecf-f46b6949927c', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'e24f2c18-2af2-5fe5-95e7-8ec4321d3cdb', 'All In (Pork Belly, Pork Ribs & Beef Belly)', null, null, 4),
  ('c7da2562-0c30-5364-ae29-839023d86d59', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Pork Belly', null, null, 1),
  ('3245f355-8996-591f-99ff-e6638f523c50', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Pulled Pork', null, null, 2),
  ('8fdb3b65-9a0d-5de7-be39-c805ed4dc47a', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Beef Belly', null, null, 3),
  ('843c0e9a-6247-5756-ab73-6ca1e0b681d9', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Bacon', null, null, 4),
  ('0aa2e71f-24ea-5a93-aabd-8295a0516a19', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Spare Ribs', null, null, 5),
  ('1fd64c91-af93-5335-a5c1-7f2f24be29df', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5073dcae-ca9a-5035-848f-241d89099cd4', 'Baby Back Ribs', null, null, 6),
  ('2fef64c9-01b1-5074-b793-0dd755888af0', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Classic', null, null, 1),
  ('6016262c-330c-5366-94fa-2487dd5bab25', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Strawberry Goodness', null, null, 2),
  ('856a150e-6395-5138-acd1-1f13202c0b8a', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Mango Burst', null, null, 3),
  ('6fa2b054-8063-5200-83c3-058d120ddf7c', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Oreo Bliss', null, null, 4),
  ('2c75b658-44eb-590b-b1b9-2ef3d2199955', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Butterscotch Treat', null, null, 5),
  ('580829f6-ce48-5312-8070-ed32fa65b3b3', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Oh S''mores!', null, null, 6),
  ('a663e997-6851-591f-9209-bd0157c374ce', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Nutella Madness', null, null, 7),
  ('6857927c-2889-5478-9ac4-cb6b04a6a0d9', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Ham & Cheese', null, null, 8),
  ('225bf909-7357-56ea-b589-d7c5bc363697', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Ham & Lettuce', null, null, 9),
  ('fb3a251f-2d55-577c-9711-b9d0d6f99d75', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Smoked Bacon & Cheese', null, null, 10),
  ('cea8ee0f-330c-505f-98d4-801c2be4457b', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Oreo Nutella', null, null, 11),
  ('219db8c9-4691-5a6b-8392-b16035270860', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Matcha Dream', null, null, 12),
  ('dba25975-08cb-5afb-9258-dae3d7a99484', '86d4db53-0799-50d5-bf64-c96a127e9eb1', '5a1b361c-2aa9-59cd-a306-2d8b2e6d4387', 'Banatella', null, null, 13),
  ('5c40c18d-1c19-5634-a439-9f969966c34d', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Lemon Cucumber', null, null, 1),
  ('66b293b6-da60-5d08-abe5-ff7c63e952ae', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Iced Tea (1.2L)', null, null, 2),
  ('b4375699-629e-5307-91b0-11f3e3986796', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Softdrink 1.5L', null, null, 3),
  ('9f0b555f-af46-501e-98dc-6e1e61806a92', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Softdrink 290ml', null, null, 4),
  ('b062970a-ff6f-5650-bb7f-18ced9afddf5', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Del Monte Juice (in can)', null, null, 5),
  ('529f48c8-58c4-5d38-813f-4d07eb4192fd', '86d4db53-0799-50d5-bf64-c96a127e9eb1', 'd75b0143-c813-5750-b995-77eb6613e151', 'Bottled Water', null, null, 6),
  ('b6e6dfc7-0b9b-5b5c-bef4-34f65a91cbd8', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Grilled Chicken w/ Sauce', null, null, 1),
  ('3ef0bd3e-cd62-5ddd-a1fa-03c75709aed0', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Quarter Fried Chicken', null, null, 2),
  ('b7c6f977-784e-566b-9023-3a26e7b5d223', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Chicken Cutlets', null, null, 3),
  ('5824ad10-5ac4-57d0-9fe8-bc1161aa9f95', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Burger Steak', null, null, 4),
  ('4f63d978-4dd2-5692-9a0c-91e9b0f4ced4', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Lumpia Shanghai (6pcs)', null, null, 5),
  ('e6e7f9a6-2417-5e95-a183-de50e49e7cec', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Asado', null, null, 6),
  ('f5f3aacf-fdc1-57aa-b257-2508a6d2b926', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6b82e50e-561a-5373-a838-29a0c33d79df', 'Fish Fillet', null, null, 7),
  ('92657200-a7e1-573c-8a1c-aa8fe1b63c49', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '9de9da4a-29f2-5af5-a707-27c17951c622', 'Plain Rice', null, null, 1),
  ('3f5fa264-d220-56b9-a5d8-b6347fca0508', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '9de9da4a-29f2-5af5-a707-27c17951c622', 'Fried Rice', null, null, 2),
  ('2497ee29-ab41-5cfb-bd2c-2287639c132e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '9de9da4a-29f2-5af5-a707-27c17951c622', 'Garlic Rice', null, null, 3),
  ('42aff79b-5daf-59fb-a584-29a19a80869a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '9de9da4a-29f2-5af5-a707-27c17951c622', 'Yang Chow Rice', null, null, 4),
  ('7f21dfc4-9334-5af4-863c-5984ad38b064', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6a938ac9-882c-5a29-a95a-25cf9a978cd7', 'Mixed Vegetables', null, null, 1),
  ('76f67d98-1080-5e02-a0b7-19ddd5e37b71', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6a938ac9-882c-5a29-a95a-25cf9a978cd7', 'Chopsuey', null, null, 2),
  ('5be21672-4765-51f4-93c8-c639ceeca9e7', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6a938ac9-882c-5a29-a95a-25cf9a978cd7', 'Ampalaya', null, null, 3),
  ('6bce5057-c652-5976-b6a1-e4e4a27e30b1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '6a938ac9-882c-5a29-a95a-25cf9a978cd7', 'Garlic Broccoli', null, null, 4),
  ('316e4561-cd25-5ddd-94aa-3f350067a1c0', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Pancit Canton', null, null, 1),
  ('9a017c3a-8308-57d5-9722-6806afec2e17', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Pancit Bihon', null, null, 2),
  ('3c1cd016-be31-5a25-9497-b86f98307d52', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Pancit Miki Bihon', null, null, 3),
  ('f8c7548c-7f21-5b3a-ad41-2b639431ef0a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Pancit Miki Guisado', null, null, 4),
  ('41c47f18-46ec-52d6-b1cc-05b87b42a376', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Sotanghon Guisado', null, null, 5),
  ('d8454204-193e-5dbd-8137-d8f8edb0a215', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '5c4e25c9-781b-5015-90b2-fdb978a91738', 'Crispy Canton w/ Chopseuy', null, null, 6),
  ('62207c89-96c5-5884-9c97-23f728639cf8', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Gambas', null, null, 1),
  ('c74e9027-fa16-53f4-b0b8-45e9aa8c4497', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Pusit Ala Pobre', null, null, 2),
  ('e3bd618f-04b3-58bc-9f84-48ad6901a410', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Sisig', null, null, 3),
  ('46b3bc3d-5cd0-5976-b0f5-992202cf92d4', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Tanigue Steak', null, null, 4),
  ('64891467-16a4-5b51-96fe-857c6621695b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Buttered Corn with Cheese', null, null, 5),
  ('30752d3f-5e36-5df9-9538-a2bbb7d012b1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Mushroom Buttons w/ Garlic', null, null, 6),
  ('a9d846e3-df30-5b02-a07f-7a1c1d6848be', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Chicken Gravy', null, null, 7),
  ('d7d80b74-6db8-5529-9d74-f47068326792', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd635794b-f291-596c-85e0-20d7c077dc77', 'Extra Gravy', null, null, 8),
  ('db585e3a-72f8-58cf-bc26-f1ea878308f5', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '28acb90c-ccbd-5679-aaed-c76b364324f0', 'Ice Cream Cup', null, null, 1),
  ('a9652363-4e64-5886-b6e4-86024176d5cc', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '28acb90c-ccbd-5679-aaed-c76b364324f0', 'Mais Con Yelo', null, null, 2),
  ('5b32bd1a-31c8-5322-8e9c-eb6c1d68f9c1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '28acb90c-ccbd-5679-aaed-c76b364324f0', 'Maja Mais', null, null, 3),
  ('24f8b699-6808-52e9-8b9b-d1cfbff5de4d', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Mary Jay Fried Chicken', null, null, 1),
  ('2063edaa-7bd0-56df-8d1d-14133d82f8c3', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Breaded Chicken Cutlets', null, null, 2),
  ('bc7097b8-b462-5555-94fa-730d03adcaba', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Spicy Chicken', null, null, 3),
  ('026ca072-9749-5c39-951e-a27e93a9879d', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Buttered Chicken', null, null, 4),
  ('adf2179e-e251-5a1a-8071-dac59d67e894', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Garlic Chicken', null, null, 5),
  ('79ce685a-e075-50d9-85ea-927ff8cc28b9', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Hot & Spicy Chicken', null, null, 6),
  ('adc9f821-9a95-5fa4-8f8a-42f55784bbbb', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd045129e-bb6b-51b5-9e2e-9dc328bba9a0', 'Chicken Curry', null, null, 7),
  ('79a86588-5c8a-5143-9dd3-582c8e8ff62a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Shredded Beef w/ Mixed Vegetables', null, null, 1),
  ('8cb58c04-04a3-581f-be57-32ff8ee381dd', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Beef Tapa', null, null, 2),
  ('59671ddc-d624-5372-b17a-3aa52f0b8838', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Bistik Tagalog', null, null, 3),
  ('a31f2b3d-6f59-5b3b-8783-805c1b1eb5b0', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Beef Caldereta', null, null, 4),
  ('986ef4f2-c999-5385-9601-ac59ae0a1a14', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Beef Broccoli', null, null, 5),
  ('0c97ba87-580e-5de8-9fb0-8173bd5553a9', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Kare-kare', null, null, 6),
  ('1cf4f020-d207-5dfc-ab1d-73b121c7972a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'a790e4ca-86cf-54b9-ad0e-cb091cbcf433', 'Bulalo', null, null, 7),
  ('edb2dfe9-64df-57fc-bba6-87e4d0d63afd', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Crispy Pata', null, null, 1),
  ('65e055c6-85f1-542d-bf34-3d3d3f929eff', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Pata Tim', null, null, 2),
  ('2bc9685f-e341-5310-b6ea-2027539f2b6b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Pork Asado', null, null, 3),
  ('8a0e20e2-b56b-5646-abf0-3a02e50b6c83', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Halo Asado', null, null, 4),
  ('1668c0a7-0092-5f1f-b9ff-e8cb79e4ae6e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Lumpia Shanghai', null, null, 5),
  ('74f091b4-b7ec-56f8-9983-3007093b8265', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Liempo', null, null, 6),
  ('966658af-3e35-5904-a459-bf2238eb5c07', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Lechon Macao', null, null, 7),
  ('e02221ee-99e5-5e9a-8652-5983a61b3a05', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Sweet & Sour Pork', null, null, 8),
  ('ea015b77-a01f-5b0b-88df-3c28b471f3e2', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Sweet & Sour Meatballs', null, null, 9),
  ('712112ec-53cc-5acf-9059-922c743b83fd', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'cfb466da-b1f6-555f-bcec-eec128780883', 'Salt & Pepper Pork', null, null, 10),
  ('45e42af0-c1cb-535b-ba9a-641c527d8cd1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Shrimp w/ Quail Egg', null, null, 1),
  ('1e0e6739-1a6f-5508-90ba-453c33daaa5b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Fish Fillet: Sweet & Sour', null, null, 2),
  ('674e86f3-1caf-529f-a4bb-0a953ae40d90', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Rellenong Bangus', null, null, 3),
  ('d27c854a-37eb-5760-9c81-ecf7313aef38', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Lapu-Lapu', null, null, 4),
  ('219576df-b398-58bb-85f8-d760287d8446', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Camaron Rebosado', null, null, 5),
  ('5f5dc003-af69-576f-a30f-1b1c51fccae1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Tokwa', null, null, 6),
  ('dbe1d320-61ce-5148-ad75-02b7a3c6f21a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Rumble', null, null, 7),
  ('5b3877b8-a090-5e71-b58a-12abc2c0d60b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Daing na Bangus', null, null, 8),
  ('981475e0-6aa3-5513-b086-5ed4315cda2b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Mixed Seafoods', null, null, 9),
  ('36449c35-3096-5a54-bd05-1a61e70e533a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Garlic Shrimp', null, null, 10),
  ('dff5ee26-f9e5-59d7-be8f-ec7cbca5fe29', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Garlic Squid', null, null, 11),
  ('ca1e5e97-9c16-5737-9dc4-e8c857271062', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '3c7dec47-25b0-595b-a38f-fe1ce369c0c6', 'Extra Garlic', null, null, 12),
  ('543a9ef9-8ee4-5c68-9a3b-4dcac42cd77e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Calamares Rings', null, null, 1),
  ('dc00cf87-f5d8-52aa-989c-a8a183196b18', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Cheese Sticks', null, null, 2),
  ('aef89420-57a2-547a-b500-2042f2781d64', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'French Fries', null, null, 3),
  ('996ffe77-3276-586d-b310-8bb58996348e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Squid Balls', null, null, 4),
  ('e37b5af3-c4ad-5122-8a62-da07702a612f', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Fried Siomai', null, null, 5),
  ('f385919f-9f47-5a9b-8f9c-ed0aef505a6c', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Ensalada Pipino', null, null, 6),
  ('f22962c5-e0e3-572d-ad92-9fe7dd3ea848', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e23706a2-f85c-5fff-8e18-0949e19ec75b', 'Caesar Salad', null, null, 7),
  ('b11ca638-fd86-58c2-927c-a149ee72a442', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '52cb44c9-9135-5d22-9139-e14d6259843a', 'Torta', null, null, 1),
  ('da4ddece-60a0-55b8-9d45-cb69ecdb312b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '52cb44c9-9135-5d22-9139-e14d6259843a', 'Torta Shrimp', null, null, 2),
  ('1fe5c857-e1e9-5b36-b2cc-7d1e506d097f', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Kabayo', null, null, 1),
  ('e9030d62-991d-575f-8ec0-f8f109b3b442', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Fried Tokwa', null, null, 2),
  ('ab7a1b4b-c998-5931-b953-d16f873dedf7', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Tokwa''t Baboy', null, null, 3),
  ('9a788300-6bbc-5ccd-8818-0367eec0b369', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Crispy Tenga', null, null, 4),
  ('cf59aac4-3426-5a41-995f-2411ce9f379a', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Chicharon Bulaklak', null, null, 5),
  ('dc94bd2a-1a65-54ba-8617-a58723de2eea', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Dinakdakan', null, null, 6),
  ('ec01f4ba-db59-510c-bf2e-3370c7ce0cfb', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Tuna Sashimi', null, null, 7),
  ('a1d87e70-896f-5886-905e-95750729f194', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '2f7c0c54-e068-5540-b1a0-f92a33f82fc7', 'Kilawin Tanigue', null, null, 8),
  ('b90f7571-0140-5c06-84ad-12937a80ec57', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Mary Jay''s Club Sandwich', null, null, 1),
  ('1b146f0a-2a1b-5131-909b-4e70e38034ec', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Toasted Bread & Butter', null, null, 2),
  ('e402bf37-d95c-58ab-a5e0-ccc1561d1d7d', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Chicken Sandwich', null, null, 3),
  ('b503ccb9-0794-57dd-9369-331e723c0910', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Ham & Chicken', null, null, 4),
  ('a7347269-f949-541b-a5cc-bf852a1bb7b5', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Ham & Egg', null, null, 5),
  ('63e232b2-1cda-5932-978e-96aa77cd5d01', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Cheeseburger', null, null, 6),
  ('2b80bf77-8f9e-5f1f-af36-2cb22679c47d', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Hamburger', null, null, 7),
  ('69485b96-6ec2-5e8c-9304-8d33f0fa1863', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '4ab11a65-7f19-5478-915f-113692b1dc2f', 'Bacon Mushroom Melt Burger', null, null, 8),
  ('1f0637d6-b65d-5e2c-9c14-fffc54e25597', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Soup of the Day (single serving)', null, null, 1),
  ('2ac45bcb-26b4-517c-8c7b-47f2e9b18025', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Chicken Asparagus', null, null, 2),
  ('0f739dd9-f22d-5277-97d1-79f2a507ec01', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Quail Egg Soup', null, null, 3),
  ('67bbc29c-029d-5eea-8d27-c246b629cebb', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Crab and Corn Soup', null, null, 4),
  ('6b621f73-3232-5aae-8f31-30a42cd32324', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Lomi', null, null, 5),
  ('7da3723a-86f1-5eb9-b9f5-50dc0757282e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Hototay', null, null, 6),
  ('6eb14046-0041-5be4-a5bc-a6553623f8bb', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Sinigang', null, null, 7),
  ('fe0d3467-3b8b-55db-a9d1-940e4c10d1b1', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', '8038ec3d-0a90-52c8-b173-8924f5758774', 'Bouillabaisse Soup', null, null, 8),
  ('a7ecf131-3bcb-58ef-acb7-c3c18e18f022', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Fresh Shake', null, null, 1),
  ('27fd9001-7a80-55b4-b9e1-6dee18f2a76b', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Fresh Buko Juice', null, null, 2),
  ('1018f429-6279-5baa-9ebd-0823f30a333c', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Sago''t Gulaman', null, null, 3),
  ('0d700a97-7aa0-5451-9b56-8430034a9909', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Milo Dinosaur', null, null, 4),
  ('51314670-8aa9-5f88-b157-07dce80991a7', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Iced Tea', null, null, 5),
  ('49131ac8-cbd3-5219-8774-10af96e60728', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Juice', null, null, 6),
  ('be621003-b6e9-5c8a-8e74-48344caaa1bd', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Fresh Calamansi Juice', null, null, 7),
  ('7412e731-2262-5dce-9cdd-165ab40b3979', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Hot Tea', null, null, 8),
  ('f7489dbf-ddcb-572d-8ba5-eee80d48fcec', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Soda in Can', null, null, 9),
  ('08d14bd0-d897-5b51-a5b2-fab722205efb', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Soda (Pitcher)', null, null, 10),
  ('19012b4a-387c-532c-a41b-da67e33edb68', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Iced Coffee', null, null, 11),
  ('ab264581-9ad6-5675-9d2b-44aa4421eda4', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Nescafe Coffee', null, null, 12),
  ('1ac6a15e-d2d1-5a6c-b436-0fdeee27ea67', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Nespresso Coffee', null, null, 13),
  ('e056fca1-085d-5544-8f9a-c2846d2dae86', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Chocolate', null, null, 14),
  ('492eedce-4c01-59b4-8610-c2af9111e313', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'San Miguel Pale Pilsen', null, null, 15),
  ('340ebd79-0877-59b4-9171-ff2b9c2cfaa3', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'San Miguel Lights', null, null, 16),
  ('4b62bd55-1680-5386-b6ec-063c362205ee', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'San Miguel Apple', null, null, 17),
  ('404ea702-c1d1-52fd-b944-39156e9e14e3', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Red Horse Beer', null, null, 18),
  ('e9164fe8-8fd4-5521-92f2-5dd7b3414afa', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'e42fae17-1b80-5723-9b12-635bc25bf0fd', 'Bottled Water', null, null, 19),
  ('be09c44e-8100-537b-a1f0-38f0cd20210e', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd12a0dd3-c039-5e25-80e8-47894621b83b', 'Alfonso Light', null, null, 1),
  ('67a92cf4-fe4b-5ce1-9f11-80876c9324aa', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd12a0dd3-c039-5e25-80e8-47894621b83b', 'Fundador Light', null, null, 2),
  ('e403d52e-fb8c-56a4-b03b-7efd3a02e7fe', '76ba809c-e160-5a7a-9337-c6d8faaa65c4', 'd12a0dd3-c039-5e25-80e8-47894621b83b', 'Black Label', null, null, 3),
  ('24661209-4ca6-544d-8f27-2e8a35ef0b31', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Crispy Pata', null, null, 1),
  ('df6c4229-83cd-501d-9335-fb5ebef9d163', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Crispy Ear', null, null, 2),
  ('225eb9b6-a148-5bfb-a5ef-fa2ee4a4e288', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Lechon Kawali', null, null, 3),
  ('8491ecc3-d06b-5d36-bdef-a4e0a57fa78d', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Sweet & Sour Camaron', null, null, 4),
  ('a16cd68b-f2b2-5c64-942b-0fa3c54567be', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Sweet & Sour Chuletas', null, null, 5),
  ('46a93506-15ca-530e-af18-d4c75989f903', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Sweet & Sour Meat Balls', null, null, 6),
  ('035b17b6-7eb6-57fb-911a-484feeceb732', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Sweet & Sour Pork (Choma)', null, null, 7),
  ('318dba05-0f25-50bc-9b70-6552ae2174f7', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Sweet & Sour Fish Fillet', null, null, 8),
  ('3ecbebc9-167d-579c-a290-3bb56bd1a9a0', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Lumpiang Shanghai', null, null, 9),
  ('b5e6fd70-712b-5e8a-ac69-c4433b5814ee', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Calamares', null, null, 10),
  ('eb699c6d-8736-5aa8-969c-d2d6e9c5e345', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Camaron Rebusado', null, null, 11),
  ('b5f6eb82-d66d-5d13-a80c-5186b91b4692', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Pinsec Frito', null, null, 12),
  ('3dc87494-445a-516c-8a41-7e2bb573c4f7', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Chuletas Frito', null, null, 13),
  ('ef684c87-3c70-5546-8b33-8dfc1e89faf9', '55c05919-6fd3-5662-9176-cc1dae43537b', 'ab2bf64d-9f56-5de5-8e78-39ba07a267b4', 'Menudencia Frito', null, null, 14),
  ('e3e659f2-863a-5757-b6b0-111e00c1571f', '55c05919-6fd3-5662-9176-cc1dae43537b', '48b4c450-c3c2-5a3e-bb0c-909f53d960ca', 'Fried Chicken', null, null, 1),
  ('71e2e336-efcb-5ade-956a-6b215a762243', '55c05919-6fd3-5662-9176-cc1dae43537b', '9edb1b28-d4d3-5244-8c45-6528677661d1', 'Breaded Chicken', null, null, 1),
  ('6801d7e1-e92a-5f84-a11a-f5e3a26d39a9', '55c05919-6fd3-5662-9176-cc1dae43537b', '7f7f980f-ac88-5625-bac8-b85129446c16', 'Buttered Chicken', null, null, 1),
  ('48736f16-ec81-583e-8191-cdbcb0468a53', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Sinigang na Baboy', null, null, 1),
  ('72b10705-acac-5667-ae43-4f6aaaad8827', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Sinigang na Hipon', null, null, 2),
  ('32960240-9765-5661-9be6-ccd20570617d', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Adobong Manok', null, null, 3),
  ('85ef6a44-23ac-56b0-a8ca-f2832ee55e53', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Adobong Baboy', null, null, 4),
  ('a962e1f1-89d0-599c-9d2e-991396724209', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Beef Broccoli', null, null, 5),
  ('d77858f9-f6dd-5c1e-ac3a-9a2c7881b97f', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Beef Ampalaya', null, null, 6),
  ('ebbc98f6-a6b8-52f1-99fd-7d47360191ac', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Sisig', null, null, 7),
  ('8e879c32-5f4a-5c27-afa5-dfc143f1531c', '55c05919-6fd3-5662-9176-cc1dae43537b', 'd07768cb-86fa-5d15-a102-5b638613866a', 'Chinese Kikiam', null, null, 8),
  ('5b7dbaaf-abe4-56f4-b247-ae5081955ded', '55c05919-6fd3-5662-9176-cc1dae43537b', 'e5a1e440-a251-5de7-848e-746ebe83e501', 'Bihon', null, null, 1),
  ('ad566107-c5bd-56ca-9558-fff6a2f09d45', '55c05919-6fd3-5662-9176-cc1dae43537b', 'e5a1e440-a251-5de7-848e-746ebe83e501', 'Miki Bihon', null, null, 2),
  ('651c65db-3d80-52c8-859e-ce0f523f9c6a', '55c05919-6fd3-5662-9176-cc1dae43537b', 'e5a1e440-a251-5de7-848e-746ebe83e501', 'Canton', null, null, 3),
  ('78730486-08aa-5b41-a95c-e75daafa22f9', '9c32b2d9-bda5-5aed-9cdf-70ceb4ab566f', '2c7828f4-5dca-5aea-b9d3-531907ea4f9c', 'Peachy-Peachy', null, null, 1),
  ('737ed414-4824-58b5-baa2-7adcbebaf24f', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'a027bea9-f11d-5f7b-8e32-8812d425f1f4', 'Crispy Pata', null, null, 1),
  ('7a1ba28f-9981-5b70-8814-da145930a6f6', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Lechon Macau', null, null, 1),
  ('b15a6edb-6055-57e5-8e0b-4fefd628bc29', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Lumpiang Shanghai', null, null, 2),
  ('b8660476-23eb-5739-b5ba-a3822af1b7d1', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Sweet & Sour Bola-Bola', null, null, 3),
  ('85854ac8-2b5a-5ad0-bd4c-cb6db8d15b44', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Sweet & Sour Pork', null, null, 4),
  ('f7d46957-355d-51e4-aa97-e0a5f74d58bb', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Torta Pork', null, 'best_seller', 5),
  ('01693c53-af20-5e8c-ad80-85c673067a52', '5d4776d7-61d8-5535-974c-6bed41f7e005', '95141e94-b2ed-5ec9-813f-ec3feb6dd3ff', 'Pork Asado', null, 'best_seller', 6),
  ('23b1cff5-c0c3-50ba-b421-dcabd5033378', '5d4776d7-61d8-5535-974c-6bed41f7e005', '16fbc1d9-45f2-58e8-aec7-5f39c4a38781', 'Whole Fried Chicken', null, null, 1),
  ('44960559-e54f-54fc-a119-c338ec4aa561', '5d4776d7-61d8-5535-974c-6bed41f7e005', '16fbc1d9-45f2-58e8-aec7-5f39c4a38781', 'Half Fried Chicken', null, null, 2),
  ('293dc677-c537-5f5e-8134-9e1dd98e7389', '5d4776d7-61d8-5535-974c-6bed41f7e005', '16fbc1d9-45f2-58e8-aec7-5f39c4a38781', 'Chicken Wings (6pcs)', null, null, 3),
  ('6a4fe572-bf58-563e-bfb8-27819eb1ea53', '5d4776d7-61d8-5535-974c-6bed41f7e005', '16fbc1d9-45f2-58e8-aec7-5f39c4a38781', 'Chicken Sisig', null, 'best_seller', 4),
  ('8ca1013a-e292-5a0e-920c-27922bc3ed32', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'c75266eb-ba86-500e-9d76-5f418236e896', 'Chop Suey', null, 'best_seller', 1),
  ('3256b95e-2e58-595d-bc58-4c364d9d9caa', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'c75266eb-ba86-500e-9d76-5f418236e896', 'Ampalaya con Carne', null, null, 2),
  ('72c3a720-9ca4-5b88-8414-67aceb757778', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'c75266eb-ba86-500e-9d76-5f418236e896', 'Ampalaya con Hipon', null, 'best_seller', 3),
  ('0abf9316-fca2-5059-90e4-351008763fdd', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Sizzling Gambas (6pcs)', null, 'best_seller', 1),
  ('c72d3fb0-64e1-5ee4-a67a-a0121e470d68', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Shrimp Embotido (6pcs)', null, 'best_seller', 2),
  ('2fad587e-bfb6-50cc-89b4-b3235cf26af1', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Camaron Rebusado', null, null, 3),
  ('bfbe7d92-1f11-5311-976b-12e60026f7c9', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Sweet & Sour Camaron', null, null, 4),
  ('ef6e8d25-98a1-55df-81c9-f3fe484a38ca', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Torta with Shrimp', null, null, 5),
  ('7a296889-6c4e-58ed-b9da-8bd23f185bad', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Torta with Alimasag', null, 'best_seller', 6),
  ('a5d643fb-99c8-537c-bc9c-28c03cc29005', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Calamares', null, null, 7),
  ('75d7af40-0bc3-5497-9636-43300429c955', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Breaded Fish Fillet (6pcs)', null, null, 8),
  ('4c94ca9b-b777-581e-b743-0fe6781e3e21', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Sweet & Sour Fish Fillet', null, null, 9),
  ('af52ffd8-0f5f-5fe7-83e0-d92066939a00', '5d4776d7-61d8-5535-974c-6bed41f7e005', '5648635e-8ad4-5bed-b1f9-08fd3e4dddbc', 'Fish Fillet with Tofu & Tausi', null, 'best_seller', 10),
  ('6716f0ec-9adc-5db3-9c09-5fb4870eace2', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Judy Ann''s Kare-Kare – Goto', null, null, 1),
  ('4709c507-1795-5ded-9574-0850954657c4', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Lechon Kare-Kare', null, 'best_seller', 2),
  ('3ed9ede7-53d5-55c4-bd0e-f55abdad8cde', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Judy Ann''s Kare-Kare – Mix', null, null, 3),
  ('07f0e56e-9014-552b-8ba4-605baa36c172', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Sinigang na Baboy', null, null, 4),
  ('5290cee0-5849-5303-9995-a66286172958', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Pork Sisig (6pcs)', null, null, 5),
  ('ee22a262-27b8-5888-ba62-84a9f9082c5b', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Bistek Tagalog', null, null, 6),
  ('636309c0-8b83-56de-b131-cf7bb7d835fa', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Beef with Mushroom', null, 'best_seller', 7),
  ('3de963e0-f6d8-5007-8567-85e4d3aec8a1', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Beef Broccoli', null, null, 8),
  ('bce6aef7-ad25-547c-a1ee-310b822f6a63', '5d4776d7-61d8-5535-974c-6bed41f7e005', '574ac9d3-6403-5fb2-b6d8-4be95aef196e', 'Chicharon Bulaklak', null, 'best_seller', 9),
  ('e6b75871-ed5d-5649-b3e7-857606c8ed9c', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'ad0be861-5708-5465-bc15-c1f8ce08cc0e', 'Fried Canton', null, 'best_seller', 1),
  ('fb8f9b8a-0fdb-580b-88a4-f89672b2ebd4', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'ad0be861-5708-5465-bc15-c1f8ce08cc0e', 'Canton (6pcs)', null, null, 2),
  ('ee474f98-b85b-5625-8275-969f9b84b00b', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'ad0be861-5708-5465-bc15-c1f8ce08cc0e', 'Canton Bilao', null, null, 3),
  ('2437fd43-2ee0-5e92-9896-381bd304710a', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'ad0be861-5708-5465-bc15-c1f8ce08cc0e', 'Bihon Bilao', null, null, 4),
  ('bcf73a60-d2fb-5bc8-ab3c-627b68430c65', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'ad0be861-5708-5465-bc15-c1f8ce08cc0e', 'Miki-Bihon Bilao', null, null, 5),
  ('790411de-6998-5787-9dee-27a5ed2fdddf', '5d4776d7-61d8-5535-974c-6bed41f7e005', '8af30ecf-ce1b-51de-a60d-68b27cc0cfc0', 'Hototay', null, 'best_seller', 1),
  ('f607e88b-7e1a-5d36-b9be-5701c2a448c3', '5d4776d7-61d8-5535-974c-6bed41f7e005', '8af30ecf-ce1b-51de-a60d-68b27cc0cfc0', 'Nido', null, null, 2),
  ('548f5e20-68c2-516c-918c-16567d309a5a', '5d4776d7-61d8-5535-974c-6bed41f7e005', '8af30ecf-ce1b-51de-a60d-68b27cc0cfc0', 'Crab & Corn', null, null, 3),
  ('7e51c541-2a0b-5566-8d72-5e6ac9672129', '5d4776d7-61d8-5535-974c-6bed41f7e005', '8af30ecf-ce1b-51de-a60d-68b27cc0cfc0', 'Lomi', null, null, 4),
  ('ae8182ea-f19e-592e-bb61-09e3a9326a2e', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'f86e1f7a-21d1-5d2a-a0fb-3ade0d1ac92f', 'Judy Ann''s Fried Rice (Platter)', null, null, 1),
  ('ed9fccb7-1c43-5f86-b8de-b311491d6064', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'f86e1f7a-21d1-5d2a-a0fb-3ade0d1ac92f', 'Fried Rice (Platter)', null, null, 2),
  ('d1e8911f-c597-5a85-b1c9-56dbf78be4ea', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'f86e1f7a-21d1-5d2a-a0fb-3ade0d1ac92f', 'Garlic Rice', null, null, 3),
  ('d1b72b9f-236b-5dce-94af-f0b0c3c8a1ff', '5d4776d7-61d8-5535-974c-6bed41f7e005', 'f86e1f7a-21d1-5d2a-a0fb-3ade0d1ac92f', 'Plain Rice', null, null, 4),
  ('1e29d496-ffd6-59bf-a476-19fda27fb8a0', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Coke', null, null, 1),
  ('f92b88e4-9e6a-56d5-9ff4-1ea7ae6274f3', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Coke Zero', null, null, 2),
  ('ee9a4af1-d214-5b90-92ec-25357268b0ae', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Royal', null, null, 3),
  ('abda6ceb-3180-5708-9b8a-4efbc82ed8ac', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Mountain Dew', null, null, 4),
  ('d65504bf-7c06-5252-86b5-966112e054f6', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Sprite', null, null, 5),
  ('b1fd85e8-f0a7-5aae-bc65-5defe5105142', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Pineapple Ace', null, null, 6),
  ('f3f5332f-083e-5402-88bc-e76603d6a58d', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Pineapple Four Seasons', null, null, 7),
  ('741204fe-a10d-5529-be18-ce4106d5d19c', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Bottled Water', null, null, 8),
  ('ad142872-efcc-51a7-83ee-f74cb240dbdc', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'House Blend Iced Tea', null, null, 9),
  ('c46cab57-1765-56e3-8cb7-f45adc2ccfbb', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Red Tea', null, null, 10),
  ('5593f11f-c061-5bc8-867d-21d3e3c6dc02', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'Cucumber Lemonade', null, null, 11),
  ('413b57ef-721c-55b8-96af-c98c8f2f7183', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'San Miguel Light', null, null, 12),
  ('54e1bb53-eb1a-524d-ae74-65b4a8cd7fce', '5d4776d7-61d8-5535-974c-6bed41f7e005', '98c897d5-e688-53fe-9179-ff632ac0cbb6', 'San Miguel Pale Pilsen', null, null, 13),
  ('fab0e6ff-4214-55ec-bb05-96c8fe6316b9', '037d0dd2-97e4-5304-9b38-205890f3836f', '96011b37-833e-5758-9dec-e50cb92e8f50', 'Crispy Sisig', null, null, 1),
  ('ffa82454-0041-5c77-a57b-d436b22d0099', '037d0dd2-97e4-5304-9b38-205890f3836f', 'c1585757-da4b-5b43-8cab-6b0dff78e442', 'Crispy Bagnet', null, null, 1),
  ('aed408f4-d898-52d9-9fc3-941027d17ca5', '037d0dd2-97e4-5304-9b38-205890f3836f', '327837cb-4170-54c8-887b-2d5a952eb1ec', 'Sisig with Rice', null, null, 1),
  ('5d67878c-bc08-52fa-872b-d47796d25cf5', '037d0dd2-97e4-5304-9b38-205890f3836f', '327837cb-4170-54c8-887b-2d5a952eb1ec', 'Shanghai w/ Rice', null, null, 2),
  ('8d241c8f-6a31-5a57-965d-6f934e228f81', '037d0dd2-97e4-5304-9b38-205890f3836f', '327837cb-4170-54c8-887b-2d5a952eb1ec', 'Shanghai Regular', null, null, 3),
  ('edd311d5-b068-563a-b26a-37aa16941a6c', '037d0dd2-97e4-5304-9b38-205890f3836f', '35e116b4-3215-5341-8baa-36c977599c96', 'Sisig Bilao', null, null, 1),
  ('f91190de-5349-5562-b0c5-9b995528a3bf', '037d0dd2-97e4-5304-9b38-205890f3836f', '35e116b4-3215-5341-8baa-36c977599c96', 'Mix Bilao', null, null, 2),
  ('023ee212-cbd1-507a-a0b9-76b886736d2f', '037d0dd2-97e4-5304-9b38-205890f3836f', '35e116b4-3215-5341-8baa-36c977599c96', 'Bagnet Bilao', null, null, 3),
  ('351ca4d2-19f6-52f6-82bc-3f60a66fb483', '037d0dd2-97e4-5304-9b38-205890f3836f', '35e116b4-3215-5341-8baa-36c977599c96', 'Bilao Shanghai', null, null, 4),
  ('5764d920-93cb-5641-9d04-3fc3839376a4', '037d0dd2-97e4-5304-9b38-205890f3836f', 'b966cf5d-e8f7-5bcb-980c-9a3e0cdbdf96', 'Crispy Pata', null, 'new', 1)
on conflict (id) do nothing;

insert into public.product_variants (id, product_id, label, price, addon_price, sort) values
  ('bed56a5d-f855-5d2a-a0cc-56185bcb2a3b', '9b061b07-40e4-56e1-a885-dc188bf5d22a', '10pcs', 348.00, null, 1),
  ('36d93f1e-2e07-531b-87bd-6ff4110977f2', '9b061b07-40e4-56e1-a885-dc188bf5d22a', '12pcs', 417.60, null, 2),
  ('04b5c0d4-69e2-57d6-8cb1-5777e36369c0', '9b061b07-40e4-56e1-a885-dc188bf5d22a', '20pcs', 696.00, null, 3),
  ('9486461b-5ac6-54a2-9012-baff9cb6e6c0', '9b061b07-40e4-56e1-a885-dc188bf5d22a', '30pcs', 1044.00, null, 4),
  ('b1796a72-ccbc-5810-9cd9-029142865318', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '10pcs', 360.00, null, 1),
  ('26c56662-5263-5c0c-8982-908a81cc8099', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '12pcs', 432.00, null, 2),
  ('6a06a161-a244-5c75-96d4-f20492416622', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '15pcs', 540.00, null, 3),
  ('cadc4740-1835-549e-aaeb-cf16bd408af6', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '20pcs', 720.00, null, 4),
  ('69c1a587-7bf5-55a0-9a80-497b3f2a16e0', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '25pcs', 900.00, null, 5),
  ('1d5fb531-c43d-5901-b4cc-e445fb3c66d6', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '30pcs', 1080.00, null, 6),
  ('29a62052-178a-527b-bb46-3911f96f45e8', 'bcaa3865-f1db-5afb-ab9d-487f1499f84f', '50pcs', 1800.00, null, 7),
  ('0b16d29c-3556-5c35-90e9-cd041c61a845', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '10pcs', 336.00, null, 1),
  ('702fb10c-062d-5559-a436-46ceb85ecfc6', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '12pcs', 403.20, null, 2),
  ('dbe00642-e529-5805-afd6-bdaa9ef69b34', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '15pcs', 504.00, null, 3),
  ('10e601ef-1a16-5085-9af0-2e77262509b3', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '20pcs', 696.00, null, 4),
  ('67426f00-c3e4-59ce-be1c-fd72c30bec19', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '25pcs', 840.00, null, 5),
  ('7b6ae389-750f-5c6b-8fe8-87221b925e26', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '30pcs', 1008.00, null, 6),
  ('d99e9cb0-93ca-56f1-8c71-c9fe44da0354', '4a5f9b52-aa80-577e-be6a-05b6e3132463', '50pcs', 1680.00, null, 7),
  ('295b4c63-3427-539d-8d86-8c09cd348be7', '4c94f58c-abe0-5edf-ae65-0fba5ea72e0c', 'Regular', 156.00, null, 1),
  ('b11f1147-5183-5b88-b0bb-5e84d576fd14', '4c94f58c-abe0-5edf-ae65-0fba5ea72e0c', 'Large', 168.00, null, 2),
  ('77e37321-407c-52a1-b817-cef75d5fd777', '237cefbe-e630-5fc2-b52e-03f51844399d', 'Regular', 144.00, null, 1),
  ('5527b326-a4ab-52a4-bc00-914e837e3522', '237cefbe-e630-5fc2-b52e-03f51844399d', 'Large', 168.00, null, 2),
  ('45a5f4d6-388d-5fd8-867d-b486bc9a7f96', '53ab1652-8003-51c1-94a6-2bf72e18ea52', 'Regular', 180.00, null, 1),
  ('0d09834d-168f-51f0-bdf6-72fe3d47a81b', 'b55ef39d-d348-5208-a0c2-372421451ff9', 'Regular', 144.00, null, 1),
  ('8dc11067-a8f1-55d9-b911-1f6b5a3006a1', 'b55ef39d-d348-5208-a0c2-372421451ff9', 'Large', 168.00, null, 2),
  ('7f6c1c7a-6ffd-5177-be38-2ad7830d7089', 'f54f5f10-87df-5de3-92b0-d36e402b0e92', 'Regular', 108.00, null, 1),
  ('6141eb0d-a0a9-550e-9b05-46f34c0e9c1f', '91f7e708-b58c-558f-a930-c7031bd952e3', 'Regular', 96.00, null, 1),
  ('183516b9-bb34-53d5-943d-aaa7873aaeff', '74cb7bc7-8847-574c-ae0a-b89ec22ab54b', 'Regular', 96.00, null, 1),
  ('e299f880-969a-5f44-92bd-188ba6944831', '5e5b9720-31cb-5183-aa6d-85552f9419dd', 'Regular', 120.00, null, 1),
  ('b137bdd2-4892-5643-b644-07dd485b3774', '411fc09c-b655-5623-acb2-a943268dfc63', 'Regular', 132.00, null, 1),
  ('4042395b-8e34-50a0-9155-6591a03f898e', '560d662e-b96e-5f60-8189-392353dd51d3', 'Small', 120.00, null, 1),
  ('9c533e27-5ab9-5da2-a829-8942760a489d', '560d662e-b96e-5f60-8189-392353dd51d3', 'Medium', 144.00, null, 2),
  ('c56803a3-bfeb-5e68-8908-1cd8cf11d511', '560d662e-b96e-5f60-8189-392353dd51d3', 'Large', 156.00, null, 3),
  ('81f58fc2-542a-57e3-a4cd-67a097e5e9d8', '560d662e-b96e-5f60-8189-392353dd51d3', 'Extra Large', 180.00, null, 4),
  ('4e2c1f0f-6490-56d1-ab2c-59cb907bcf35', '0e7debd6-835b-55ee-b87f-9ac45456b211', 'Regular', 156.00, null, 1),
  ('895914c2-d338-5663-a390-2438927e8012', '0e7debd6-835b-55ee-b87f-9ac45456b211', 'Large', 168.00, null, 2),
  ('c4d52241-ab14-5ec2-bffb-b3d3c29372ed', '6727e4de-38f8-5dcb-b0de-e4b0dcc65326', 'Regular', 168.00, null, 1),
  ('3556a924-ddd7-5800-b177-0238281b0a73', 'c1f68b39-86cc-5e0b-b423-53a01f801cfc', 'Regular', 168.00, null, 1),
  ('f2626a6f-982e-53c1-a731-c2dfcd0b8bab', '5dc8c57e-f855-590d-b68c-d65ed5dfb1da', 'Regular', 300.00, null, 1),
  ('04c8bc10-f3f7-5729-8220-dfb80b357b36', '9f375114-e70c-5cba-a13b-f1d6b3ec51b9', 'Small', 204.00, null, 1),
  ('b8488311-2de2-5f16-8fdc-7842adc7eb8e', '9f375114-e70c-5cba-a13b-f1d6b3ec51b9', 'Medium', 300.00, null, 2),
  ('d3901564-becf-5a88-8dbc-40241fab2c9a', '9f375114-e70c-5cba-a13b-f1d6b3ec51b9', 'Large', 360.00, null, 3),
  ('746d7612-d781-5280-bf36-799d10afea19', '2b1c44bb-106a-5890-bdd6-5d884305233d', 'Regular', 204.00, null, 1),
  ('72723064-27e3-5d2d-b61b-b84a37cd2bf6', 'f057cfe5-5f83-5006-b3e8-16e13ac5d4bc', 'Regular', 216.00, null, 1),
  ('3c584b23-8a3b-53de-b870-486e3957090b', '3e8ac602-ed84-5abd-bd9d-fe5e4e03a236', 'Regular', 180.00, null, 1),
  ('12ac4e06-35e9-5efb-aa45-294f91debd12', 'c1624cd3-74d7-59e5-8785-8311a7c94020', 'Regular', 180.00, null, 1),
  ('97281065-a929-5218-83e7-7bef24f7a4dd', '57b2034b-10e4-5dc4-af72-14877a5c3f9b', 'Regular', 132.00, null, 1),
  ('1dc682b1-e56a-5d90-86fc-d3b64426c3ed', 'c35f89b8-29c3-5566-ad92-dc1508b89363', 'Regular', 132.00, null, 1),
  ('6261e718-feef-5435-963f-845ea05d3f07', 'c78ff966-13f1-5851-bda7-dbb6aa2de8a0', 'Regular', 132.00, null, 1),
  ('8dfc6c0f-3df8-50c5-b114-f0a0cb6630dd', '025ce949-257c-512b-892a-f193a61cb749', 'Regular', 180.00, null, 1),
  ('e4a1a911-1533-5a93-a8cc-8eb5edf34fa7', '26ce674c-7d12-57b6-aff6-dd1cffde4d36', 'Regular', 180.00, null, 1),
  ('2a7f4da6-c556-5973-b9c8-ff8ced62099f', 'cc94f4bc-9a8a-5655-997d-da4172ec9fec', 'Regular', 132.00, null, 1),
  ('9f4aa8e1-728a-5c8b-a55a-ceaa6712c652', 'e27776e9-9b65-5181-8124-1a28f26fdfc7', 'Regular', 192.00, null, 1),
  ('0404c0d2-de25-5451-8a0d-7b8870923ced', 'ae027226-3948-5c8d-a294-a8befccde07f', 'Regular', 72.00, null, 1),
  ('dc99b912-dd94-59cb-9da5-b4f25c74afcb', '40021217-9348-5923-a99d-9168ed6cdc11', 'Regular', 84.00, null, 1),
  ('c3ec4a40-dd6f-57f7-b700-a41dbcb74acb', 'acfafe0e-8212-5cb3-888e-a20a1c96d04a', 'Regular', 72.00, null, 1),
  ('d3f81055-6e04-57cb-a9d2-8d3295b400b4', '1b4dae7d-b1c2-58fa-9ddf-64ea03a150db', 'Regular', 120.00, null, 1),
  ('d43f093d-2241-5c42-8f43-72d64587912c', '0b607dc6-ac23-5940-8777-1438d14ca2c4', 'Regular', 144.00, null, 1),
  ('ebda517a-dd99-5d99-a03d-f31160d9930b', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 4 persons', 528.00, null, 1),
  ('75cbc5fd-5566-589b-91db-29a4772f7208', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 5-6 persons', 792.00, null, 2),
  ('934ab3e2-b1cd-50c1-9521-839f28b34cd6', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 8 persons', 1056.00, null, 3),
  ('edb1ea90-a0f8-5475-866e-24334176bcf5', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 10 persons', 1320.00, null, 4),
  ('b8193cbb-5d30-5fac-a38e-743dca4470fd', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 12 persons', 1560.00, null, 5),
  ('1fbe36d7-c6ca-5395-8bcf-6b81b4653226', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 14 persons', 1800.00, null, 6),
  ('3917bc2c-cbc1-5d8e-b4b4-ba03db3945b0', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 16 persons', 2100.00, null, 7),
  ('e2d6617b-a066-5e53-8392-5cc423677aed', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 18 persons', 2340.00, null, 8),
  ('0d0b537f-6bc3-56ac-a568-845cda4a4922', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 20 persons', 2580.00, null, 9),
  ('96c38e09-1c3f-5e83-8beb-134c3449ade5', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 25 persons', 3180.00, null, 10),
  ('2adcc0e5-ec5e-5e53-ad03-36cfb9f5c21a', '774cf96d-eb55-5c32-909d-19fb7aa3fba6', 'For 30 persons', 3600.00, null, 11),
  ('d7c9a6b6-e5c1-5aab-baaa-6672979c4a65', '0903c21a-2215-55ee-88f0-431ec1795731', 'Small', 180.00, null, 1),
  ('1366f568-4ebc-5429-b3b7-e61b2997120d', '0903c21a-2215-55ee-88f0-431ec1795731', 'Medium', 264.00, null, 2),
  ('65d51a3f-c469-5d0c-a260-e265cadd5649', '0903c21a-2215-55ee-88f0-431ec1795731', 'Large', 348.00, null, 3),
  ('f9538a1f-5a80-5847-a368-0eea5ddcb0da', 'c90ad6e0-aa32-552d-a04b-b95e0950b908', '1 piece', 33.60, null, 1),
  ('ce92ebd6-7402-513b-8d7e-2d4cacbcac2b', 'c90ad6e0-aa32-552d-a04b-b95e0950b908', '1 box (10pcs)', 336.00, null, 2),
  ('a79c35f2-9fed-56b2-868e-c2ebce3cc335', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 8 (2-3 persons)', 540.00, null, 1),
  ('7fd684b5-3b15-55a2-96b0-d1defb78a666', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 9 (3-4 persons)', 660.00, null, 2),
  ('eab93804-07b1-5222-a0f4-287c972f19ef', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 10 (4-5 persons)', 840.00, null, 3),
  ('1b876970-2918-5f89-bb57-0ef95c4e4e7a', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 11 (5-6 persons)', 960.00, null, 4),
  ('08e55caf-6294-5605-b7ad-d56eca4a57bb', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 12 (6-8 persons)', 1080.00, null, 5),
  ('7bf980d8-e73e-5e93-a3e1-035727f83754', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 13 (8-10 persons)', 1200.00, null, 6),
  ('e6a82289-3054-5a15-94d8-db1dc060896e', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 14 (10-12 persons)', 1440.00, null, 7),
  ('cc90b9ad-a013-5fce-a35d-591adeb46b35', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 15 (12-14 persons)', 1680.00, null, 8),
  ('a20898b7-a4c3-581e-86b5-b7441da25163', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 16 (14-17 persons)', 1920.00, null, 9),
  ('9144af4e-1231-547b-a4a2-99a67f6b2513', '0e58d6cc-d53a-554a-a6e1-fb03b847cbbd', 'Size 17 (17-20 persons)', 2160.00, null, 10),
  ('66de611a-4287-584a-af56-dca90cc66ae2', 'ee806dfe-2175-572e-98c6-b5a4d7f17158', 'Regular', 408.00, null, 1),
  ('c7d49ae8-fc87-5eee-aa80-078187e7e3a8', '211e713c-999d-5d44-8254-d441cbe10ec6', 'Regular', 408.00, null, 1),
  ('219a997b-7f97-5b7e-b6aa-7cbb657ab8ec', 'a8a4f37f-9788-5adc-b0e0-2964bffbaa07', 'Regular', 420.00, null, 1),
  ('ce8a5049-7f59-52cb-b920-cda4f32619e1', 'ae26a2fd-3ae7-5412-8376-0b4895130e87', 'Regular', 456.00, null, 1),
  ('0509ae10-1d36-5a17-8e0e-b5e189803c1e', '6b91fc95-e46c-51b3-8e0c-e8f2b4842bf2', 'Regular', 384.00, null, 1),
  ('2ae85ae0-6898-5c80-8845-9ee8e4cca0fa', '71342e88-814d-51d8-ac70-c440b4a41d42', 'Regular', 384.00, null, 1),
  ('beab98f1-0249-536c-87df-ce5715899c16', '3bdc68e7-8048-5dd6-a362-9b00133cb545', 'Regular', 456.00, null, 1),
  ('64c54899-9ce4-5e52-bf18-3be8c9106b77', 'a3d1bbe1-cd12-52c7-a5a9-4f326627b674', 'Regular', 456.00, null, 1),
  ('4faf9e83-9233-5164-9511-13315b288d5f', 'b08d3d2e-b762-5de9-a527-d97f2c08a684', 'Regular', 456.00, null, 1),
  ('08a3b736-4f7f-5230-a4f0-5f51288f54ce', '2cd528a5-f78b-551d-a35f-669a2b93171c', 'Regular', 432.00, null, 1),
  ('e616c351-168c-5943-b987-ce854bb84e67', '1193d476-6bd2-5790-9091-49e5c3dab742', 'Regular', 528.00, null, 1),
  ('4b18f58d-e66c-54e8-b0a2-3f38689e67d7', '790263e5-cdb6-5ee0-9403-b763d79a0b56', 'Regular', 528.00, null, 1),
  ('4b0cac1c-69df-556f-a7c0-5884866eb7ba', '2d7e7369-42df-51fc-acdc-8c83f38c1773', 'Regular', 588.00, null, 1),
  ('c7f3fecd-0033-5824-9146-1a5b62dea9fb', 'ac604289-49f7-500e-a847-abf0150e13e5', 'Regular', 444.00, null, 1),
  ('ca0fe1cf-a40d-5ae5-9352-26924b9ee345', '45a8ddf9-68f8-5cf7-bd83-021abf64e847', 'Regular', 432.00, null, 1),
  ('bf74282f-74ff-5976-92ab-dd38f3dc2136', '7b457bf2-51d0-5734-b009-2ad07e4b6b41', 'Regular', 432.00, null, 1),
  ('7e1c5fe8-87ec-5255-930e-30cbc656bb7d', '2693d90b-7c86-5403-b341-c4bc0d87f014', 'Regular', 468.00, null, 1),
  ('ed33e873-ead9-5202-a5d6-ad1f63e39c8e', 'ff1cdb8e-4cf7-55bf-aac2-d3ea7994f5f1', 'Regular', 612.00, null, 1),
  ('586ec8fa-253d-5386-9651-6191d85a4a8c', '1c08fae2-6e2d-5913-b984-a69637d69779', 'Regular', 696.00, null, 1),
  ('d1383796-eb40-5132-be3d-869022a79751', '2912f48b-36cd-5590-b1ce-1f18713d7586', 'Regular', 396.00, null, 1),
  ('eda5df9a-6139-55ee-9f2e-25e7fc884dfd', '29c05eef-6602-5d8a-a89e-dd931b6461ae', 'Regular', 384.00, null, 1),
  ('891c75d7-465b-594e-8b16-500fe7fb6861', '7682284c-42c8-5c18-b4a9-793080c925cb', 'Regular', 456.00, null, 1),
  ('0ea608dd-81dd-5006-bf78-98126f327203', '1b1d37db-1f87-5fcf-aa75-6b36c1893e0f', 'Regular', 456.00, null, 1),
  ('d802b821-b912-5f16-a27a-d003c6601ca6', 'e5498a23-b0ce-5d99-8dd1-113106949444', 'Regular', 612.00, null, 1),
  ('e1c863d4-65e8-5530-8038-bce548837ae6', '887ec054-58aa-545d-8573-5d58d6f18c5b', 'Regular', 600.00, null, 1),
  ('d8430fce-207c-56aa-a3a8-c00a92c897fe', '722fc91a-2460-5115-9992-3443763af716', 'Regular', 600.00, null, 1),
  ('8036cf0d-0824-5cd7-8de1-2bc552feb482', 'e1707b42-3dcd-5ee1-94ee-ef3b62dbd336', 'Regular', 420.00, null, 1),
  ('530923fe-701b-598f-be1b-c28c3f559dd8', 'a42953eb-78d1-5746-8034-e7c33ce4b48b', 'Fried Whole', 816.00, null, 1),
  ('6b8d6deb-7b39-5e5e-81d5-a453bcaa9e4f', 'a42953eb-78d1-5746-8034-e7c33ce4b48b', 'Fried Half', 552.00, null, 2),
  ('7e3b8d2a-6865-5b11-9814-4b92e89b086a', 'a42953eb-78d1-5746-8034-e7c33ce4b48b', 'Buttered Whole', 912.00, null, 3),
  ('4b3f146b-d4d5-5ae7-9d95-b8566e7f05e5', '93174e20-8e8a-5d2d-9c61-1ccc212addca', 'Regular', 468.00, null, 1),
  ('74296f86-bb21-51ed-a88a-140939d6675a', '489eb85b-4f87-57e9-85e6-cf1c70a937a2', 'Regular', 468.00, null, 1),
  ('2165b5ae-209a-5e50-ad54-8e18a0bbf6e3', 'c598e435-3360-503c-93b5-b2461a651f60', 'Regular', 384.00, null, 1),
  ('a22b2d3d-a5aa-57de-8178-15b4901a5fee', '6f2e7318-917d-5756-baa4-b99284da6504', 'Regular', 396.00, null, 1),
  ('fec55106-2ece-575d-a43c-0ebd54849917', 'a7374898-2b5e-555e-bf5d-d74f0f96ae4b', 'Regular', 384.00, null, 1),
  ('30258f0f-8932-57c1-be0a-00601f4776aa', '520b75ac-8609-5796-9ea8-1c986e45b703', 'Regular', 300.00, null, 1),
  ('8b48b120-099c-5aa8-91a8-a9b3847d2c23', 'f1e0e34f-a27a-5397-a24e-80d3fab41962', 'Regular', 444.00, null, 1),
  ('2d31861d-51e9-59fe-b191-c13652b45df1', '38674c61-13d3-51aa-9280-dc138cb1f24e', 'Regular', 1200.00, null, 1),
  ('8bbe994e-5046-5987-9831-3639dccfb11e', '3b366816-f88e-57cb-94fc-e5bc1ccf31b6', 'Regular', 1560.00, null, 1),
  ('838addef-da0c-5239-b762-17ba35b08acd', '0a45c25d-19f9-54bd-9c79-9eb64647a66f', 'Regular', 456.00, null, 1),
  ('ee4d5d19-c2fc-53c5-aa99-285eae39516e', '556e62cf-4832-5432-9fa7-9d20cf18c02a', 'Regular', 456.00, null, 1),
  ('2f7a09c1-1f76-50c0-bf16-adcda82177c8', '280e9727-c98e-5bce-8f6b-297d665c0a33', 'Regular', 288.00, null, 1),
  ('41a7b4ce-6d3e-563d-9835-ec1ffaa5c480', 'aa2ad7b6-01d7-51c0-a9c3-2120e533da68', 'Regular', 624.00, null, 1),
  ('dbc5019f-34f4-5713-be6c-f2816263abd0', '8c14df94-9f06-522a-94c8-70a00c1ae9c7', 'Regular', 624.00, null, 1),
  ('1bbb1953-0e4c-547e-bb71-7d2ba3ce5b71', '7a0403c8-109b-55a4-ac69-858967586891', 'Regular', 456.00, null, 1),
  ('42332d84-2b0f-55c6-801e-0dd5d080cbf8', 'f43a9d56-cf5e-55be-9f03-babe5dfdc111', 'Regular', 456.00, null, 1),
  ('517671af-3355-5059-9574-e4b9b1d13c89', '8bdef3a4-7108-549d-8f02-1dd50e6f05d3', 'Regular', 456.00, null, 1),
  ('0137cbc6-b24b-57e0-8063-0815cd58971c', '774c7dca-26a7-5ce4-9945-b51bb0d20834', 'Regular', 456.00, null, 1),
  ('4c269663-6895-5f9c-8689-ecc65a2255a6', 'bfb24808-3e20-5acc-92b6-1247db75889e', 'Regular', 300.00, null, 1),
  ('22b4b0f8-997b-580b-83d1-4dfaa9862179', '251cfe4c-1e1d-59a0-9f72-cfb1ee5ec441', 'Regular', 432.00, null, 1),
  ('e25f4245-3fb8-54c8-8260-c160d638030e', '5cb3e253-8d0d-5637-8fe3-5b519f954c56', 'Regular', 420.00, null, 1),
  ('c4746f93-0ae1-51f3-a566-232318d02244', '7b926404-1224-5f84-b74a-89d6382717fa', 'Regular', 480.00, null, 1),
  ('18103644-13a3-5756-9f6b-f30492b0212d', '79d374d5-4a88-5075-afab-04f4b4b1fb72', 'Regular', 456.00, null, 1),
  ('933c6257-d785-584a-b4dc-ba53dee1515b', 'c408411f-4b81-556b-8e18-e24d901b0375', 'Regular', 456.00, null, 1),
  ('01c2594a-f4a1-5160-aa52-c6398141091f', '2430c967-965b-5ec4-bde9-55427499c0ef', 'Regular', 396.00, null, 1),
  ('32a101ca-8739-52ff-91e8-4460b654be18', 'e8172b43-8381-533c-96cd-f111c2ffaab5', 'Regular', 456.00, null, 1),
  ('ef87ee7a-0578-531a-919d-0f0c6ea0d70e', 'cfd464bd-f36d-5304-8f17-2957eeb08c1a', 'Regular', 420.00, null, 1),
  ('a1816c1f-aaac-5bc0-a2ab-0850e3a6e46f', '3e9673eb-fc68-53dc-9970-6ab7bc8716b2', 'Regular', 420.00, null, 1),
  ('f9791018-1662-5f10-81c5-cc9a9b13a4d6', '2659c41c-5fac-5a0e-9fa4-bd3d065428a4', 'Regular', 420.00, null, 1),
  ('09030558-ed54-5522-a40e-38531654de01', 'f5734d9a-8ea5-57ef-a1aa-efb8eeacb6b4', 'Regular', 432.00, null, 1),
  ('580958c2-675f-5789-935a-d4ac339b5475', '0de96299-e7de-5b94-8644-db47c940ac38', 'Regular', 588.00, null, 1),
  ('974b7c4e-d585-5eb6-bbcd-d88737b6d003', 'dce2d350-0fbe-522d-8374-56609a66cfbb', 'Regular', 408.00, null, 1),
  ('1549cd85-a50f-505a-badb-eb71285b914e', 'a55c6313-faec-59e2-99a0-b9fbd62198bb', 'Regular', 336.00, null, 1),
  ('abdd7336-7ced-5772-bf3d-de904d714db8', '6f80d7ca-74fe-5b81-892d-6afb63cee34c', 'Regular', 396.00, null, 1),
  ('97f46a0f-fd05-5a4d-b847-3e2ab354a61a', '4c2cffe9-58e7-5d80-b0a0-ed015de94b40', 'Regular', 456.00, null, 1),
  ('d81b4246-cffc-5aa5-bfa1-a4a1e7eb9a23', '9602d7d8-052f-5055-8953-06d1136b59e2', 'Regular', 590.00, null, 1),
  ('c35f2c39-fb37-5d96-8aa3-466bc56ab43b', 'b72d0119-8b19-5f3a-be76-b6fabbc66610', 'Regular', 180.00, null, 1),
  ('00a1b8f9-dc81-5b24-af2f-9b32acf3ad8a', 'db7db549-6f39-5980-9bde-49e26afc5cfa', 'Regular', 264.00, null, 1),
  ('c284893f-3f3a-5e99-89fd-d7046ea316a8', '1ad9c618-e5b8-51d6-8eae-e48c75bd2028', 'Regular', 336.00, null, 1),
  ('542777f2-9f2b-5051-bbb6-df1d522deeb9', '29df70d0-5ceb-5f80-97fa-4102b4a249ef', 'Regular', 336.00, null, 1),
  ('38ceaed9-b329-59a5-b5ef-1c7bd6532cfc', '1705a69e-8fef-5d8b-8f37-f6d1134cbc5c', 'Regular', 336.00, null, 1),
  ('5b05991c-b62a-54d9-b9a5-996b486daa1a', '55d0a31e-e677-58e1-a934-e08533861c32', 'Regular', 300.00, null, 1),
  ('1cfd39ad-56f8-57cd-9037-9678bd6be9f7', '4a9e04cf-d8d6-5082-bcb1-a66532bfd21b', 'Regular', 240.00, null, 1),
  ('977af226-9986-5a1a-945b-33b13a88d68e', 'aab56bbc-ab83-5349-af78-fd7b1ab46b1a', 'Regular', 180.00, null, 1),
  ('92c44b51-1035-56e4-bdf8-7f0001159223', '297cb954-c310-5965-86c7-af2bc1691a5a', 'Regular', 180.00, null, 1),
  ('1072ff22-2b31-5ab7-9919-68dbe972d705', '865d5996-3dea-58fd-85ba-e5c8daa69ec3', 'Regular', 456.00, null, 1),
  ('2de52da0-8c95-5ead-aac8-0531d133eb7b', 'c7a510f3-b5fc-53a5-9ab1-0aedb2a54a10', 'Regular', 456.00, null, 1),
  ('8cf4c641-2459-5441-8d77-fa694bf91e5f', '71eb3948-1be5-5b9c-b96f-77cb24e076eb', 'Regular', 420.00, null, 1),
  ('aa5a9e48-9770-59a5-bd10-35714116aa5e', '8a020dfd-0932-5cf4-9729-2b4d7ee3597c', 'Regular', 336.00, null, 1),
  ('5264e830-8d1d-5a30-ae88-7011034b5f87', '1e837c6c-202c-558c-af53-b6076ee1f8d9', 'Regular', 336.00, null, 1),
  ('53e3f9ac-e031-50e4-af7c-04a1eb115059', 'fef1439f-f813-5299-af87-39cd14bac098', 'Regular', 576.00, null, 1),
  ('25433452-64a8-54d3-be1e-5bfb296b0a74', 'ea03a660-1b6f-5a7a-b5ac-0da9be24fe31', 'Regular', 576.00, null, 1),
  ('7d552cfb-f354-5759-9d27-0a6f94864039', '824d991a-201b-5b27-a95e-6fca79e4b683', 'Regular', 456.00, null, 1),
  ('2feee52d-933c-5904-8034-a23e5b6017f0', 'bb5487c5-7219-5ad4-a444-b60754d2fd4b', 'Regular', 456.00, null, 1),
  ('607b2bd3-46a2-50c8-9e30-74bc66734760', 'd614fafb-fc16-5862-90f7-394b3b90818f', 'Regular', 384.00, null, 1),
  ('8cec6aec-0c56-5a2d-9d02-a59d7d6ee3d7', '914d6e34-d3bc-5b79-8f32-34883d238460', 'Regular', 432.00, null, 1),
  ('d2bcb86d-3415-52e7-bdbe-9addb03c903f', '85d8462d-3514-5eb3-8b20-0df5c3e66abb', 'Regular', 336.00, null, 1),
  ('c0ead8cb-3892-54d5-a80f-ab33f105f514', '8ba79272-0410-5ffd-914f-87defacaeda3', 'Regular', 336.00, null, 1),
  ('6e5924d5-93a8-5b9a-b9cc-5587248a71fd', 'b7f31a65-7f5c-54d3-84f4-9fb6496aad06', 'Regular', 384.00, null, 1),
  ('6aa6c406-382f-5d96-823e-61a8c39b4eb6', '5333d726-fef9-54a4-864d-c2879fade6e3', 'Regular', 384.00, null, 1),
  ('d8eb7d86-b312-57a7-afb2-fb5ef8094de3', '07d635ed-ba7f-5140-a250-567dcea39542', 'Regular', 420.00, null, 1),
  ('2bf369ff-84ab-5a35-9b66-7674de5b6470', '338ef96f-943c-53c5-a93a-97c8571ea36e', 'Regular', 324.00, null, 1),
  ('43e20163-9a92-56f8-8e8d-f5157ac72893', '1685afa8-5a18-5565-be9f-dd36de8e2454', 'Regular', 312.00, null, 1),
  ('c08c9e0d-71ef-5fee-842f-a2f68f4efe23', '2a92986e-22ef-50e6-a067-841588a872aa', 'Regular', 456.00, null, 1),
  ('b4c54d24-4303-5414-b093-7ca75061ee39', '788f2fe8-ee82-5399-a6b3-6167b459c94c', 'Regular', 456.00, null, 1),
  ('dabf7772-b229-5541-a814-d4d0c6100139', '7e08f547-3482-50db-8883-058cb87a71ef', 'Regular', 42.00, null, 1),
  ('ebd378dd-3826-5161-94b0-aaeab705a9c6', '3b8e45b1-81cb-54f0-9656-2af0df5a5826', 'Regular', 47.00, null, 1),
  ('b409b93c-5810-555f-bec8-e4dd7d744604', '8707d650-0afa-58c2-bc74-04fe1973a14b', 'Regular', 54.00, null, 1),
  ('f098f724-3082-52a8-a79d-b892e2c2f448', 'c62cdf43-f9e3-5ee6-bc28-3cc2e0d9fda3', 'Regular', 180.00, null, 1),
  ('9b0865ac-2acf-57e2-bb30-f3b9958141f4', '2206a3fd-dba4-51a3-956d-ef69f6b5325a', 'Regular', 180.00, null, 1),
  ('91d494c7-30f5-54ed-b382-a6a40af19b4a', '90dc88f9-b38f-5ba1-a126-c8f3986220b4', 'Regular', 144.00, null, 1),
  ('aaa377b4-c3ac-591e-8dac-9b14c4e65c90', 'fee9e19d-8f67-5764-89ff-9a9bbb8536a8', 'Regular', 33.60, null, 1),
  ('448d6fd2-a826-5709-9d1f-7cce233c6663', 'd1b69632-9d6d-573a-af5f-9165ca46e6b7', 'Regular', 42.00, null, 1),
  ('0f8b5447-3185-5c91-9c92-a761f96001f0', '937ff8fd-b85b-526f-a2fb-4424c31abc47', 'Regular', 36.00, null, 1),
  ('653c2f39-9424-52a3-b3db-5d655b9355b7', 'b0ba5dd5-c0e1-5bb3-9237-ee85a3eba3f1', 'Regular', 28.80, null, 1),
  ('475f2e82-0ca6-5ef6-81e3-8a148afb2011', 'ecdfc0b0-8354-5e15-bbbe-23b6b089c16a', 'Regular', 251.00, null, 1),
  ('0694cf9e-f75a-574a-a407-15c269bb6caf', 'dc09db72-b562-59da-bd75-d15c5b81d3c8', 'Regular', 251.00, null, 1),
  ('927fac91-7b32-56e0-bbc7-c324efe5de3c', '10e58b57-2f49-5fe1-9236-879764d4021e', 'Regular', 251.00, null, 1),
  ('90f55aa8-8ee0-5504-bdf5-47a2f5aaa134', '0ae723a0-c25e-5184-b369-64bfb0fd78cd', 'Regular', 251.00, null, 1),
  ('a14a35d5-dbb2-5007-8ff9-2029019a5555', 'fcf236a6-6cf0-5ad2-8043-bb7a4eb46065', 'Regular', 227.00, null, 1),
  ('624d01c5-b21f-58b0-b17f-98f53961e0e0', '69a5e2e3-dc3f-533a-b4c3-bc802905f1c8', 'Regular', 720.00, null, 1),
  ('03ead1c7-9d7d-5d70-b718-c34bd32de281', '35566bdc-009f-56e9-8923-23bd266cccb9', 'Regular', 960.00, null, 1),
  ('c3538337-15ec-5074-8695-254caf09b4c8', 'c656f4f7-345d-5b7e-9be1-54e9aeaef45f', 'Regular', 1320.00, null, 1),
  ('1162121a-fe24-5948-bab7-23551785d971', '347db2a2-4b13-5638-82dc-e3d439fabeee', 'Regular', 215.00, null, 1),
  ('96aa6390-d1dc-52c8-9f61-889e11641e24', 'b70d4d24-5c42-57e9-9a48-1b2d6c9299d5', 'Regular', 215.00, null, 1),
  ('56eb0858-a50f-5d6c-8e25-12172ecde5c4', '10b0c0e1-f9c7-5bf8-8f74-ac2ac1633d07', 'Regular', 215.00, null, 1),
  ('21938e60-4ce7-5d71-8ff0-fe02292633ca', 'd87b7e56-923a-59f3-93f0-0230ef464072', 'Regular', 215.00, null, 1),
  ('d1859733-a560-5fca-b787-df7e10c8e18d', 'b84bf9cd-ee22-5ab2-9e68-5c297e4da9a8', 'Solo', 191.00, null, 1),
  ('91a96a85-08f7-582c-ba91-7c2c8cb471dd', 'b84bf9cd-ee22-5ab2-9e68-5c297e4da9a8', 'Sharing', 474.00, null, 2),
  ('320a4f57-92f2-533f-ad74-7dad1846c1b8', 'b84bf9cd-ee22-5ab2-9e68-5c297e4da9a8', 'Feast', 936.00, null, 3),
  ('256f4b53-f45b-5dd1-b76d-7baceaf9bf78', 'b84bf9cd-ee22-5ab2-9e68-5c297e4da9a8', 'Party', 1440.00, null, 4),
  ('61044274-6bc8-5e1d-b173-09b445981182', '8aac988c-b986-518e-a456-cfe5ed9c9a0a', 'Solo', 227.00, null, 1),
  ('2e97c372-6249-50ba-bd26-ba12ff1028c0', '8aac988c-b986-518e-a456-cfe5ed9c9a0a', 'Sharing', 510.00, null, 2),
  ('c39e8e0a-44ff-577b-b82c-f0f4c239aa67', '8aac988c-b986-518e-a456-cfe5ed9c9a0a', 'Feast', 1020.00, null, 3),
  ('3b691c1c-23e1-5519-b1a4-736354dc6729', '8aac988c-b986-518e-a456-cfe5ed9c9a0a', 'Party', 1560.00, null, 4),
  ('fd3fdb56-9381-5ec9-af22-e8d3335c303c', '7810397d-0830-5526-9976-e20552349274', 'Solo', 215.00, null, 1),
  ('b6a1a6c3-6310-55bb-930e-c56e19eec8c6', '7810397d-0830-5526-9976-e20552349274', 'Sharing', 504.00, null, 2),
  ('561a23b2-cd69-5b03-b95a-8488f5a53f51', '7810397d-0830-5526-9976-e20552349274', 'Feast', 984.00, null, 3),
  ('bf8c6217-9854-5099-99b3-54f92d15bf08', '7810397d-0830-5526-9976-e20552349274', 'Party', 1500.00, null, 4),
  ('2639539a-3458-547b-ac68-e93535aab001', 'dae63f78-1585-5aa2-a75d-330802e71df1', 'Regular', 203.00, null, 1),
  ('92861ab1-78cd-5a91-8b34-1402ae2c7722', '49ca27aa-1e26-5a4e-b3bb-02437fda6626', 'Regular', 203.00, null, 1),
  ('a4c32875-e522-5650-ba32-25e9be8b8017', 'dc3be106-ed50-5795-93c8-111004c01966', 'Regular', 131.00, null, 1),
  ('e2b36739-d919-540a-88a8-e53a9b70c617', 'a0072722-af9d-523c-877e-66d8d018a4bd', 'Regular', 102.00, null, 1),
  ('1f05900e-202c-5fbd-bad2-14736c5563f7', 'da0c2e93-94fb-5129-87ca-b5dac000ee49', 'Regular', 102.00, null, 1),
  ('891d16d6-7b27-590b-bdee-7d1a26330f12', '45569f64-8956-545e-950a-93d859f9def7', 'Regular', 102.00, null, 1),
  ('93889b4c-0c92-5802-b577-0d7af924975a', '3cf6f257-b9f1-53bf-be9a-c798e596fe93', 'Regular', 102.00, null, 1),
  ('8ef2e9fe-de75-52d3-a231-a2797710732a', 'f49caf2d-c33a-5a7a-8b5e-ad32ea6f899d', 'Regular', 102.00, null, 1),
  ('0d881a5e-3d6f-5cea-bffb-30f047088d2a', '557b61e8-76d0-5059-9a34-0d10f704b5c8', 'Regular', 270.00, null, 1),
  ('ec454765-d224-5fca-a13f-0552dc3fbc09', '3c6d7bb5-edb0-5635-8960-87fbec93e637', 'Regular', 270.00, null, 1),
  ('811ffbc5-5756-5670-9608-61773a9ea92f', '14fba68b-c7c9-50d9-8dd2-a4e331a25f1c', 'Regular', 306.00, null, 1),
  ('f1706d12-d754-5b1c-a4e8-eabccc4f74a1', '02916b44-1b33-550a-9ecf-f46b6949927c', 'Regular', 582.00, null, 1),
  ('a0bd9a4b-353d-50a3-9522-ab0b5e32a49b', 'c7da2562-0c30-5364-ae29-839023d86d59', '1kg', 2040.00, null, 1),
  ('7fce1e5d-1d58-5316-b9f2-b803ebf262d4', 'c7da2562-0c30-5364-ae29-839023d86d59', '500g', 1050.00, null, 2),
  ('9cd6fd76-19d4-5be1-a148-9969ee5e2394', 'c7da2562-0c30-5364-ae29-839023d86d59', '250g', 564.00, null, 3),
  ('5ba0b8d2-b6c1-5106-af59-2bd56f81bfcb', '3245f355-8996-591f-99ff-e6638f523c50', '1kg', 2040.00, null, 1),
  ('5c011877-47eb-52a0-ac6d-baf6a2030f50', '3245f355-8996-591f-99ff-e6638f523c50', '500g', 1050.00, null, 2),
  ('929fc8cb-26db-5a7d-ac07-1d658870985b', '3245f355-8996-591f-99ff-e6638f523c50', '250g', 564.00, null, 3),
  ('4746fcfe-0f03-5b01-9797-5ce93f143644', '8fdb3b65-9a0d-5de7-be39-c805ed4dc47a', '1kg', 2340.00, null, 1),
  ('fc80f4e2-39d7-5630-b996-4cd6572e1c4a', '8fdb3b65-9a0d-5de7-be39-c805ed4dc47a', '500g', 1194.00, null, 2),
  ('37187b67-c2be-5193-9de0-556201c192e8', '8fdb3b65-9a0d-5de7-be39-c805ed4dc47a', '250g', 630.00, null, 3),
  ('0733f8e8-1801-5b76-91cd-7508364db060', '843c0e9a-6247-5756-ab73-6ca1e0b681d9', '1kg', 1440.00, null, 1),
  ('eded92bf-301e-564a-a52f-0807b96c7648', '843c0e9a-6247-5756-ab73-6ca1e0b681d9', '500g', 720.00, null, 2),
  ('45ec5e04-d7d9-5266-b5e0-2893953c7254', '843c0e9a-6247-5756-ab73-6ca1e0b681d9', '250g', 360.00, null, 3),
  ('9938e062-7c32-5698-ad2b-ab25a2444ae1', '0aa2e71f-24ea-5a93-aabd-8295a0516a19', 'per rack', 1860.00, null, 1),
  ('a94c3f3a-4f49-5798-9f3c-e806acf61686', '1fd64c91-af93-5335-a5c1-7f2f24be29df', 'per rack', 1500.00, null, 1),
  ('f75fb672-a8db-5706-9d4c-4b2a53e26e00', '2fef64c9-01b1-5074-b793-0dd755888af0', 'Regular', 102.00, null, 1),
  ('23fe1aaf-2da4-5860-8f17-9d9c7b4ff2ff', '6016262c-330c-5366-94fa-2487dd5bab25', 'Regular', 132.00, null, 1),
  ('ecdf60d9-11fe-55c3-8410-7f6e6c3fca07', '856a150e-6395-5138-acd1-1f13202c0b8a', 'Regular', 132.00, null, 1),
  ('8e6393ff-162b-55dc-b02b-c6313faddef4', '6fa2b054-8063-5200-83c3-058d120ddf7c', 'Regular', 144.00, null, 1),
  ('24c40d3d-75c2-5c66-bfdb-74b43428e7a0', '2c75b658-44eb-590b-b1b9-2ef3d2199955', 'Regular', 144.00, null, 1),
  ('b68252d6-0ec1-57fc-836c-a2f10ec03f92', '580829f6-ce48-5312-8070-ed32fa65b3b3', 'Regular', 144.00, null, 1),
  ('78822121-9bca-5e10-b923-1eb30d51d772', 'a663e997-6851-591f-9209-bd0157c374ce', 'Regular', 144.00, null, 1),
  ('df773c22-7cd7-50b0-b58f-01f462327feb', '6857927c-2889-5478-9ac4-cb6b04a6a0d9', 'Regular', 144.00, null, 1),
  ('d44ce82e-941b-5b3f-9691-a9580d3c24fd', '225bf909-7357-56ea-b589-d7c5bc363697', 'Regular', 144.00, null, 1),
  ('4d5a7613-cb4d-5231-8b56-239c49a256a1', 'fb3a251f-2d55-577c-9711-b9d0d6f99d75', 'Regular', 156.00, null, 1),
  ('f4e245d1-4fe4-5c15-82fd-8fc3890577e0', 'cea8ee0f-330c-505f-98d4-801c2be4457b', 'Regular', 156.00, null, 1),
  ('f24b80af-f893-5b4d-b2a6-728f2208c962', '219db8c9-4691-5a6b-8392-b16035270860', 'Regular', 156.00, null, 1),
  ('6f15969d-6eb4-5315-b026-c4bab28f11e2', 'dba25975-08cb-5afb-9258-dae3d7a99484', 'Regular', 156.00, null, 1),
  ('5201ed9d-1154-5021-98e7-b2781a5ff3c7', '5c40c18d-1c19-5634-a439-9f969966c34d', '1.2L', 162.00, null, 1),
  ('5f6cd92b-5b27-5a14-9c8d-95579dc89cd4', '5c40c18d-1c19-5634-a439-9f969966c34d', '650ml', 90.00, null, 2),
  ('84b8bd0d-8ca2-5bda-a067-4e5827fec93d', '66b293b6-da60-5d08-abe5-ff7c63e952ae', 'Regular', 108.00, null, 1),
  ('d3475783-e5e2-5390-b36a-2314a4fd29c2', 'b4375699-629e-5307-91b0-11f3e3986796', 'Regular', 108.00, null, 1),
  ('ed9d51b1-1fd0-5376-8649-b9e636933d16', '9f0b555f-af46-501e-98dc-6e1e61806a92', 'Regular', 34.00, null, 1),
  ('52cfd8f5-cbe3-5618-bf92-2dd47c42ccd4', 'b062970a-ff6f-5650-bb7f-18ced9afddf5', 'Regular', 66.00, null, 1),
  ('5d97f82b-8483-5c05-9a3f-ec98c6c7cc0e', '529f48c8-58c4-5d38-813f-4d07eb4192fd', 'Regular', 30.00, null, 1),
  ('69322b0d-ddfd-57e0-9b9c-09cdc03e1deb', 'b6e6dfc7-0b9b-5b5c-bef4-34f65a91cbd8', 'Regular', 306.00, null, 1),
  ('d58cd7e6-cb76-523b-b1a0-1c668902b26a', '3ef0bd3e-cd62-5ddd-a1fa-03c75709aed0', 'Regular', 288.00, null, 1),
  ('bfaf867c-9f33-5b19-94c3-6273eb62ab84', 'b7c6f977-784e-566b-9023-3a26e7b5d223', 'Regular', 258.00, null, 1),
  ('aba1bda9-ada3-524b-84c4-0c7a75a8b21c', '5824ad10-5ac4-57d0-9fe8-bc1161aa9f95', 'Regular', 312.00, null, 1),
  ('6b3a3f7d-23fd-5a48-8a15-dfc15c022659', '4f63d978-4dd2-5692-9a0c-91e9b0f4ced4', 'Regular', 264.00, null, 1),
  ('511869f0-83cf-53e3-94f4-2e94a8f03ce7', 'e6e7f9a6-2417-5e95-a183-de50e49e7cec', 'Regular', 264.00, null, 1),
  ('089da4db-6354-5ebf-8d91-3e30465ae669', 'f5f3aacf-fdc1-57aa-b257-2508a6d2b926', 'Regular', 258.00, null, 1),
  ('a4c6095d-97c1-5ce7-bff2-e55778d7ff38', '92657200-a7e1-573c-8a1c-aa8fe1b63c49', 'Cup', 72.00, null, 1),
  ('b975ae08-7c45-5cdb-a664-7d4087e06697', '92657200-a7e1-573c-8a1c-aa8fe1b63c49', 'Bowl', 264.00, null, 2),
  ('81d69c66-e433-52e8-95a4-97b139a7e71f', '3f5fa264-d220-56b9-a5d8-b6347fca0508', 'Cup', 90.00, null, 1),
  ('23218d7e-6d2c-57b0-80da-469c967ee8ed', '3f5fa264-d220-56b9-a5d8-b6347fca0508', 'Bowl', 330.00, null, 2),
  ('4b6a5bf2-22d1-5d74-a15f-c91ee28a8baa', '2497ee29-ab41-5cfb-bd2c-2287639c132e', 'Cup', 84.00, null, 1),
  ('eebe361b-68aa-5ca0-abb6-38130ec90db0', '2497ee29-ab41-5cfb-bd2c-2287639c132e', 'Bowl', 330.00, null, 2),
  ('1ab2c7f7-2aef-58a9-8990-b196176d0c1d', '42aff79b-5daf-59fb-a584-29a19a80869a', 'Bowl', 558.00, null, 1),
  ('2ef868c1-485d-5824-a48e-8b344613dff5', '7f21dfc4-9334-5af4-863c-5984ad38b064', 'Regular', 372.00, null, 1),
  ('51cfc9a0-87b1-5e94-bd7b-b4c3afe03e1c', '76f67d98-1080-5e02-a0b7-19ddd5e37b71', 'Regular', 354.00, null, 1),
  ('da8e5fa7-0b74-5c44-9b6f-dbc05fd143c8', '5be21672-4765-51f4-93c8-c639ceeca9e7', 'Regular', 414.00, null, 1),
  ('840072b8-a067-5b16-9f48-eba08b414df6', '6bce5057-c652-5976-b6a1-e4e4a27e30b1', 'Regular', 504.00, null, 1),
  ('bbf8df0e-ac9d-57a6-acb3-edc3a37936fe', '316e4561-cd25-5ddd-94aa-3f350067a1c0', 'Regular', 342.00, null, 1),
  ('cef0a077-5ff1-533f-9e17-bc0879219cfd', '9a017c3a-8308-57d5-9722-6806afec2e17', 'Regular', 294.00, null, 1),
  ('a2cb69bf-2716-5942-b3d3-b379c77ae6fd', '3c1cd016-be31-5a25-9497-b86f98307d52', 'Regular', 294.00, null, 1),
  ('76d4eec4-0875-5d3f-9d44-3c7446866bbc', 'f8c7548c-7f21-5b3a-ad41-2b639431ef0a', 'Regular', 294.00, null, 1),
  ('524b8de0-51c2-5511-a71e-02663909c798', '41c47f18-46ec-52d6-b1cc-05b87b42a376', 'Regular', 324.00, null, 1),
  ('86170e42-b572-51c1-891a-150c67a1681c', 'd8454204-193e-5dbd-8137-d8f8edb0a215', 'Regular', 456.00, null, 1),
  ('ba1b43b2-692d-570f-8417-a0089943fe06', '62207c89-96c5-5884-9c97-23f728639cf8', 'Regular', 570.00, null, 1),
  ('a6baf43d-15e0-53e6-8638-31a7e7e71c58', 'c74e9027-fa16-53f4-b0b8-45e9aa8c4497', 'Regular', 558.00, null, 1),
  ('d1bdae85-0289-573c-86b5-29c0f04c4373', 'e3bd618f-04b3-58bc-9f84-48ad6901a410', 'Regular', 438.00, null, 1),
  ('158aa206-fc4d-5677-9900-51e7140f6f61', '46b3bc3d-5cd0-5976-b0f5-992202cf92d4', 'Regular', 660.00, null, 1),
  ('df125da9-83a2-5229-9480-225522ca887f', '64891467-16a4-5b51-96fe-857c6621695b', 'Regular', 306.00, null, 1),
  ('ef71855d-4d56-599e-98cf-0bbeabe58d3f', '30752d3f-5e36-5df9-9538-a2bbb7d012b1', 'Regular', 306.00, null, 1),
  ('c92dacfb-bfc3-5da6-9db0-b31449419978', 'a9d846e3-df30-5b02-a07f-7a1c1d6848be', 'Regular', 546.00, null, 1),
  ('aef1fe24-004d-5b2d-8ff1-20a9b60395b0', 'd7d80b74-6db8-5529-9d74-f47068326792', 'Regular', 126.00, null, 1),
  ('6954ebab-2b8f-506f-8adc-96b990cacc92', 'db585e3a-72f8-58cf-bc26-f1ea878308f5', 'Regular', 72.00, null, 1),
  ('6502094b-a88a-590e-8cb8-26409aadba0b', 'a9652363-4e64-5886-b6e4-86024176d5cc', 'Regular', 114.00, null, 1),
  ('57d6c8b8-71a4-53d2-ab4e-71c60982997d', '5b32bd1a-31c8-5322-8e9c-eb6c1d68f9c1', 'Regular', 252.00, null, 1),
  ('45ac0a94-344e-5466-a0f0-449f2e469007', '24f8b699-6808-52e9-8b9b-d1cfbff5de4d', 'Regular', 444.00, null, 1),
  ('61ea6842-e2ed-51b3-aaf5-4eb872d839c2', '2063edaa-7bd0-56df-8d1d-14133d82f8c3', 'Regular', 414.00, null, 1),
  ('193080a5-c0f5-5061-bf28-52fc152bd9c3', 'bc7097b8-b462-5555-94fa-730d03adcaba', 'Regular', 456.00, null, 1),
  ('47ad7184-d644-5a3c-a191-ef748f4ed70e', '026ca072-9749-5c39-951e-a27e93a9879d', 'Regular', 456.00, null, 1),
  ('956498f4-9a1c-58fd-8f5d-87d67bf1d5e9', 'adf2179e-e251-5a1a-8071-dac59d67e894', 'Regular', 456.00, null, 1),
  ('e05f42ca-0a82-55cc-ab61-ef422ba8c0e8', '79ce685a-e075-50d9-85ea-927ff8cc28b9', 'Regular', 456.00, null, 1),
  ('6ec50cd2-4d52-5375-8542-e3d7a8bedecb', 'adc9f821-9a95-5fa4-8f8a-42f55784bbbb', 'Regular', 528.00, null, 1),
  ('3f70654d-045c-5192-a824-facee3449466', '79a86588-5c8a-5143-9dd3-582c8e8ff62a', 'Regular', 540.00, null, 1),
  ('09305754-4982-5fbb-a738-7b8133ab9bb3', '8cb58c04-04a3-581f-be57-32ff8ee381dd', 'Regular', 504.00, null, 1),
  ('af62c0fc-63bc-59c3-9309-eb3c7f88de51', '59671ddc-d624-5372-b17a-3aa52f0b8838', 'Regular', 504.00, null, 1),
  ('a92d2398-dee6-5507-8333-eb910f862336', 'a31f2b3d-6f59-5b3b-8783-805c1b1eb5b0', 'Regular', 540.00, null, 1),
  ('438570c3-0dcf-5442-b94f-35f866f5916e', '986ef4f2-c999-5385-9601-ac59ae0a1a14', 'Regular', 540.00, null, 1),
  ('0e4c82b1-26de-57c7-ac75-0115a9965b33', '0c97ba87-580e-5de8-9fb0-8173bd5553a9', 'Regular', 702.00, null, 1),
  ('90dfc5d9-7c75-5218-8d88-4ef06a1683f8', '1cf4f020-d207-5dfc-ab1d-73b121c7972a', 'Regular', 870.00, null, 1),
  ('bb6633a9-7846-566c-ad46-f61a3db8e971', 'edb2dfe9-64df-57fc-bba6-87e4d0d63afd', 'Regular', 1272.00, null, 1),
  ('32116bb1-672c-57dc-ab40-f26b2f5c0233', '65e055c6-85f1-542d-bf34-3d3d3f929eff', 'Regular', 1560.00, null, 1),
  ('15ed21f7-ee51-532d-a15c-426954c57fed', '2bc9685f-e341-5310-b6ea-2027539f2b6b', 'Regular', 504.00, null, 1),
  ('27ce3614-9122-5a9c-9056-d3dd686ad50e', '8a0e20e2-b56b-5646-abf0-3a02e50b6c83', 'Regular', 504.00, null, 1),
  ('16d1d626-d587-5080-9c7e-1cac417bdafc', '1668c0a7-0092-5f1f-b9ff-e8cb79e4ae6e', 'Regular', 348.00, null, 1),
  ('684c593c-3568-5e6e-b956-32916b6d731a', '74f091b4-b7ec-56f8-9983-3007093b8265', 'Regular', 480.00, null, 1),
  ('b5597ff6-219e-5da6-8888-3489e0d1d595', '966658af-3e35-5904-a459-bf2238eb5c07', 'Regular', 522.00, null, 1),
  ('b519dfc7-c21c-5326-abba-10f83c4606ee', 'e02221ee-99e5-5e9a-8652-5983a61b3a05', 'Regular', 456.00, null, 1),
  ('0be4e1b2-b40a-5fdc-b6b5-a643efe920ce', 'ea015b77-a01f-5b0b-88df-3c28b471f3e2', 'Regular', 456.00, null, 1),
  ('c7f3c238-9b50-5304-99e5-7e49cfd10564', '712112ec-53cc-5acf-9059-922c743b83fd', 'Regular', 528.00, null, 1),
  ('bc44b4e7-cde0-59f7-9f6e-8649dcd60cf1', '45e42af0-c1cb-535b-ba9a-641c527d8cd1', 'Regular', 528.00, null, 1),
  ('05f0ced3-eaaa-5f5d-a3df-de7b83e8ae47', '1e0e6739-1a6f-5508-90ba-453c33daaa5b', 'Regular', 480.00, null, 1),
  ('5da321b8-72e1-502d-a28c-659967baf2c4', '674e86f3-1caf-529f-a4bb-0a953ae40d90', 'Regular', 684.00, null, 1),
  ('bdcb70cb-f6ed-50c4-b406-5031491782e0', 'd27c854a-37eb-5760-9c81-ecf7313aef38', 'Regular', 204.00, null, 1),
  ('6086c891-0b5a-5e15-934a-e2164919f8a7', '219576df-b398-58bb-85f8-d760287d8446', 'Regular', 504.00, null, 1),
  ('87aae95c-2ac7-5957-8a38-b93d122dabe5', '5f5dc003-af69-576f-a30f-1b1c51fccae1', 'Regular', 504.00, null, 1),
  ('75ec07fd-14db-51e4-b8b5-afb8f27fff4d', 'dbe1d320-61ce-5148-ad75-02b7a3c6f21a', 'Regular', 564.00, null, 1),
  ('9fcf3e56-b358-50f1-a698-01751407e793', '5b3877b8-a090-5e71-b58a-12abc2c0d60b', 'Regular', 504.00, null, 1),
  ('a4560ca8-44d1-5b25-ba61-76d0bc3d5fc1', '981475e0-6aa3-5513-b086-5ed4315cda2b', 'Regular', 792.00, null, 1),
  ('9aa58e38-864c-5c6d-a21b-9051ae1d6759', '36449c35-3096-5a54-bd05-1a61e70e533a', 'Regular', 564.00, null, 1),
  ('e8d31de3-4aef-5a6e-8259-3b40f1d21ef7', 'dff5ee26-f9e5-59d7-be8f-ec7cbca5fe29', 'Regular', 564.00, null, 1),
  ('e6937d4a-da2c-5440-a309-76cd4e8101fc', 'ca1e5e97-9c16-5737-9dc4-e8c857271062', 'Regular', 78.00, null, 1),
  ('097efe7c-4924-5982-98fb-7f7f951b0943', '543a9ef9-8ee4-5c68-9a3b-4dcac42cd77e', 'Regular', 504.00, null, 1),
  ('81935e40-a982-538e-9fec-7eb3fe282077', 'dc00cf87-f5d8-52aa-989c-a8a183196b18', 'Regular', 252.00, null, 1),
  ('21d90129-4a1b-5bd8-9354-64531e99e157', 'aef89420-57a2-547a-b500-2042f2781d64', 'Regular', 228.00, null, 1),
  ('64281187-4330-5ebd-8680-5004b112ae9f', '996ffe77-3276-586d-b310-8bb58996348e', 'Regular', 204.00, null, 1),
  ('9d76bbe3-4ff5-5787-b8d3-e26b21e3a3e0', 'e37b5af3-c4ad-5122-8a62-da07702a612f', 'Regular', 204.00, null, 1),
  ('690d2868-5dc3-5613-966f-eedf8bb0fba2', 'f385919f-9f47-5a9b-8f9c-ed0aef505a6c', 'Regular', 258.00, null, 1),
  ('7d49e4d6-e398-5a4c-a0ea-4e94e44ccd09', 'f22962c5-e0e3-572d-ad92-9fe7dd3ea848', 'Regular', 504.00, null, 1),
  ('8c6af592-49b3-5c5c-801c-7a8c3f02ae41', 'b11ca638-fd86-58c2-927c-a149ee72a442', 'Regular', 330.00, null, 1),
  ('3b8e48ed-b1a3-5274-9d01-3425db75bdd0', 'da4ddece-60a0-55b8-9d45-cb69ecdb312b', 'Regular', 366.00, null, 1),
  ('730856de-4ff2-50c0-9522-2a5587f53969', '1fe5c857-e1e9-5b36-b2cc-7d1e506d097f', 'Tapa', 444.00, null, 1),
  ('0bcff96d-a6f2-56ee-9d62-9b17c7423dda', '1fe5c857-e1e9-5b36-b2cc-7d1e506d097f', 'Adobo', 456.00, null, 2),
  ('b668f937-f5d2-5ee9-9615-8503f6935a7e', 'e9030d62-991d-575f-8ec0-f8f109b3b442', 'Regular', 222.00, null, 1),
  ('8ca490cd-9afa-5e9d-9fb6-82e69be4af7a', 'ab7a1b4b-c998-5931-b953-d16f873dedf7', 'Regular', 354.00, null, 1),
  ('51285474-8e3f-5420-8689-670cd8bbaf04', '9a788300-6bbc-5ccd-8818-0367eec0b369', 'Regular', 402.00, null, 1),
  ('ada39261-6a03-5a48-9ab4-89ee1844b115', 'cf59aac4-3426-5a41-995f-2411ce9f379a', 'Regular', 390.00, null, 1),
  ('e41f0a4b-739b-551a-96c6-002ec16ea7ed', 'dc94bd2a-1a65-54ba-8617-a58723de2eea', 'Regular', 456.00, null, 1),
  ('cc3a064b-116a-51c0-9ae8-e6f287aba916', 'ec01f4ba-db59-510c-bf2e-3370c7ce0cfb', 'Regular', 630.00, null, 1),
  ('255a465d-c826-5860-aedd-7cec2ca66f17', 'a1d87e70-896f-5886-905e-95750729f194', 'Regular', 600.00, null, 1),
  ('ab7335ed-58bd-5166-a0ea-1de8be4c0f7b', 'b90f7571-0140-5c06-84ad-12937a80ec57', 'Regular', 222.00, null, 1),
  ('5cdfc721-d2d7-55ab-926f-70f99bacc18b', '1b146f0a-2a1b-5131-909b-4e70e38034ec', 'Regular', 78.00, null, 1),
  ('c70e2628-9236-5c31-aebc-574efb30fbb8', 'e402bf37-d95c-58ab-a5e0-ccc1561d1d7d', 'Regular', 180.00, null, 1),
  ('f8fa7f95-484f-5696-a84f-09b2ee74c6ad', 'b503ccb9-0794-57dd-9369-331e723c0910', 'Regular', 192.00, null, 1),
  ('19b13c7a-a0b5-531f-a711-b95277ef9a59', 'a7347269-f949-541b-a5cc-bf852a1bb7b5', 'Regular', 192.00, null, 1),
  ('1e90b0b5-8b12-5048-bcf3-f8938d0e3f72', '63e232b2-1cda-5932-978e-96aa77cd5d01', 'Regular', 156.00, null, 1),
  ('73a1b899-62fc-573d-8adb-ed16dfbd3fdf', '2b80bf77-8f9e-5f1f-af36-2cb22679c47d', 'Regular', 126.00, null, 1),
  ('28f0b187-e360-520d-9588-8c7314ecd480', '69485b96-6ec2-5e8c-9304-8d33f0fa1863', 'Regular', 252.00, null, 1),
  ('3ec2a5a8-e004-5326-950d-8f5e308cd91c', '1f0637d6-b65d-5e2c-9c14-fffc54e25597', 'Regular', 102.00, null, 1),
  ('99626f44-f225-5058-b70b-d847859053fd', '2ac45bcb-26b4-517c-8c7b-47f2e9b18025', 'Regular', 414.00, null, 1),
  ('7cf85b7a-dd8d-5786-8236-0b15202986be', '0f739dd9-f22d-5277-97d1-79f2a507ec01', 'Regular', 396.00, null, 1),
  ('80d06939-e4d0-5f77-a9f2-b078e869fb54', '67bbc29c-029d-5eea-8d27-c246b629cebb', 'Regular', 366.00, null, 1),
  ('82a427cf-ce9e-540d-a8bd-b7ced8444544', '6b621f73-3232-5aae-8f31-30a42cd32324', 'Regular', 354.00, null, 1),
  ('7632a583-3702-51c8-b878-0b5813d9c561', '7da3723a-86f1-5eb9-b9f5-50dc0757282e', 'Regular', 354.00, null, 1),
  ('7b40a882-37b5-5180-99fe-dbc90b8ad0ce', '6eb14046-0041-5be4-a5bc-a6553623f8bb', 'Baboy', 582.00, null, 1),
  ('203b53b0-f8ea-5cb8-8e3d-d58fa801c346', '6eb14046-0041-5be4-a5bc-a6553623f8bb', 'Hipon/Isda', 642.00, null, 2),
  ('c73f2b91-5872-523b-94a6-4f794c31e82e', 'fe0d3467-3b8b-55db-a9d1-940e4c10d1b1', 'Regular', 606.00, null, 1),
  ('3b62b280-5739-5678-9a43-489b60b3fff1', 'a7ecf131-3bcb-58ef-acb7-c3c18e18f022', 'Regular', 216.00, null, 1),
  ('e336cf80-f1ad-5ebb-b173-7cd8626fc243', '27fd9001-7a80-55b4-b9e1-6dee18f2a76b', 'Regular', 180.00, null, 1),
  ('afddb41b-202b-52e7-8982-a550be5245f5', '1018f429-6279-5baa-9ebd-0823f30a333c', 'Regular', 90.00, null, 1),
  ('360342af-da23-539c-94c2-65069d83cca7', '0d700a97-7aa0-5451-9b56-8430034a9909', 'Regular', 180.00, null, 1),
  ('bb683bf9-3870-5627-8c3b-a0ade106e0a3', '51314670-8aa9-5f88-b157-07dce80991a7', 'Glass', 90.00, null, 1),
  ('c25419f0-2f71-58ce-85d5-598f9da9ed6f', '51314670-8aa9-5f88-b157-07dce80991a7', 'Pitcher', 360.00, null, 2),
  ('6a5a8c09-db96-5971-bac6-f93192c4b459', '49131ac8-cbd3-5219-8774-10af96e60728', 'Regular', 102.00, null, 1),
  ('a488b0a1-6541-5dad-a1e4-2982fa13237e', 'be621003-b6e9-5c8a-8e74-48344caaa1bd', 'Regular', 96.00, null, 1),
  ('7fcfea5e-1b87-570f-a43d-c392257bd4e7', '7412e731-2262-5dce-9cdd-165ab40b3979', 'Regular', 96.00, null, 1),
  ('f821925e-c3ff-5e9b-98c3-0b2439837ecb', 'f7489dbf-ddcb-572d-8ba5-eee80d48fcec', 'Regular', 96.00, null, 1),
  ('a1012ee9-23b3-5a22-a8ba-3547f7920eac', '08d14bd0-d897-5b51-a5b2-fab722205efb', 'Regular', 300.00, null, 1),
  ('c552efe2-a6fd-578e-876b-0eaa24b529d2', '19012b4a-387c-532c-a41b-da67e33edb68', 'Regular', 102.00, null, 1),
  ('6745c6cb-6ecf-51fd-92e3-117d47cd5325', 'ab264581-9ad6-5675-9d2b-44aa4421eda4', 'Regular', 72.00, null, 1),
  ('459a1095-d56d-5039-8b72-f2cfe6c60778', '1ac6a15e-d2d1-5a6c-b436-0fdeee27ea67', 'Regular', 174.00, null, 1),
  ('c4e5dd85-f935-5bc4-8c97-f11f24cecee3', 'e056fca1-085d-5544-8f9a-c2846d2dae86', 'Regular', 126.00, null, 1),
  ('327f05e6-5e5e-5533-abc1-50c4210b9a81', '492eedce-4c01-59b4-8610-c2af9111e313', 'Regular', 108.00, null, 1),
  ('e9133880-30ed-54d6-af46-fe77966e1bac', '340ebd79-0877-59b4-9171-ff2b9c2cfaa3', 'Regular', 108.00, null, 1),
  ('3aada2f0-6466-571b-99e7-1f53a1bd22b9', '4b62bd55-1680-5386-b6ec-063c362205ee', 'Regular', 108.00, null, 1),
  ('b61f1b29-9ac4-56c5-88cc-4a941213125a', '404ea702-c1d1-52fd-b944-39156e9e14e3', 'Regular', 108.00, null, 1),
  ('92494303-7fc3-51ac-a012-85eee259a58f', 'e9164fe8-8fd4-5521-92f2-5dd7b3414afa', 'Regular', 42.00, null, 1),
  ('0b268af8-1018-593c-954d-e5643b978d17', 'be09c44e-8100-537b-a1f0-38f0cd20210e', 'Regular', 780.00, null, 1),
  ('321a5d38-8922-52a2-874e-3cb32777f029', '67a92cf4-fe4b-5ce1-9f11-80876c9324aa', 'Regular', 960.00, null, 1),
  ('75cbc81e-ff48-5217-b998-c4d5cd5b3314', 'e403d52e-fb8c-56a4-b03b-7efd3a02e7fe', 'Regular', 1800.00, null, 1),
  ('4e82c9c8-8cd7-5dd6-9691-6d5f502b7b1f', '24661209-4ca6-544d-8f27-2e8a35ef0b31', 'Regular', 1140.00, null, 1),
  ('e12a3279-3b74-5969-8323-c2f2b3c6775f', 'df6c4229-83cd-501d-9335-fb5ebef9d163', 'Regular', 228.00, null, 1),
  ('63d82d9e-7cc6-5136-ae9b-2264ffbc1b24', '225eb9b6-a148-5bfb-a5ef-fa2ee4a4e288', 'Regular', 228.00, null, 1),
  ('d7e3fcc8-16af-5451-87b1-3dffd25e85b6', '8491ecc3-d06b-5d36-bdef-a4e0a57fa78d', 'Regular', 228.00, null, 1),
  ('de0d0997-1839-54b5-a645-47f47576659d', 'a16cd68b-f2b2-5c64-942b-0fa3c54567be', 'Regular', 228.00, null, 1),
  ('08c4dddb-a02c-5524-99d8-c077bbc2c519', '46a93506-15ca-530e-af18-d4c75989f903', 'Regular', 228.00, null, 1),
  ('6614b896-95c4-5bec-99bc-8e77801ba881', '035b17b6-7eb6-57fb-911a-484feeceb732', 'Regular', 228.00, null, 1),
  ('1cea0ccc-ea79-59a7-9491-04d552c38fda', '318dba05-0f25-50bc-9b70-6552ae2174f7', 'Regular', 228.00, null, 1),
  ('a324e747-0fe9-5462-85a9-09f949e6c87e', '3ecbebc9-167d-579c-a290-3bb56bd1a9a0', 'Regular', 204.00, null, 1),
  ('86e2f8b3-2ffa-55ab-bdac-6335ac6f2506', 'b5e6fd70-712b-5e8a-ac69-c4433b5814ee', 'Regular', 216.00, null, 1),
  ('5d3121eb-6b31-5fbf-b89f-5062144786c2', 'eb699c6d-8736-5aa8-969c-d2d6e9c5e345', 'Regular', 216.00, null, 1),
  ('f5e74d3d-a9a7-5cd7-a88c-9f7b412a7995', 'b5f6eb82-d66d-5d13-a80c-5186b91b4692', 'Regular', 228.00, null, 1),
  ('f9a698b5-13cf-5585-8b06-2fcf0d39055f', '3dc87494-445a-516c-8a41-7e2bb573c4f7', 'Regular', 216.00, null, 1),
  ('9a59addf-ddb9-502d-aaf0-a4754510a975', 'ef684c87-3c70-5546-8b33-8dfc1e89faf9', 'Regular', 216.00, null, 1),
  ('3d1f3d44-dad1-5b9d-807d-cdaaa140d2a0', 'e3e659f2-863a-5757-b6b0-111e00c1571f', 'Whole', 504.00, null, 1),
  ('b42f047c-caf5-57ae-b646-1769d83e735e', 'e3e659f2-863a-5757-b6b0-111e00c1571f', '1/2 (Half)', 264.00, null, 2),
  ('0b341196-55df-5016-8c29-2fafa9411db5', '71e2e336-efcb-5ade-956a-6b215a762243', 'Whole', 588.00, null, 1),
  ('89e2062c-bc44-50c2-908b-4ebd6dfda750', '71e2e336-efcb-5ade-956a-6b215a762243', '1/2 (Half)', 378.00, null, 2),
  ('ccebdc84-6b73-50d7-b186-39d2ae7e1774', '71e2e336-efcb-5ade-956a-6b215a762243', '1/4 (One Fourth)', 228.00, null, 3),
  ('fd6163d1-3c16-546a-aed6-b487dc2355cf', '6801d7e1-e92a-5f84-a11a-f5e3a26d39a9', 'Whole', 690.00, null, 1),
  ('63d54833-dbc3-5cf6-96d0-8d98fa08992d', '6801d7e1-e92a-5f84-a11a-f5e3a26d39a9', '1/2 (Half)', 384.00, null, 2),
  ('a0c9f7d2-d0dd-5dd3-97dc-2906cf816cb8', '6801d7e1-e92a-5f84-a11a-f5e3a26d39a9', '1/4 (One Fourth)', 290.00, null, 3),
  ('8dc2108a-fee5-5693-8c28-1327453d1b6f', '48736f16-ec81-583e-8191-cdbcb0468a53', 'Regular', 336.00, null, 1),
  ('6e00cc27-47d1-5a78-9bd9-df3e9799d578', '72b10705-acac-5667-ae43-4f6aaaad8827', 'Regular', 336.00, null, 1),
  ('09d8bab6-4c28-5915-b988-27d7ee0b0b4b', '32960240-9765-5661-9be6-ccd20570617d', 'Regular', 348.00, null, 1),
  ('13f25a84-46c5-5cd5-858f-6d2f04ebd2d0', '85ef6a44-23ac-56b0-a8ca-f2832ee55e53', 'Regular', 240.00, null, 1),
  ('11a21b02-be4a-52d4-b130-7bbcbe349ef6', 'a962e1f1-89d0-599c-9d2e-991396724209', 'Regular', 228.00, null, 1),
  ('ec8c1cb2-054c-59ce-ba93-9cbf0eb95c76', 'd77858f9-f6dd-5c1e-ac3a-9a2c7881b97f', 'Regular', 228.00, null, 1),
  ('a54da4d8-4251-596c-9b28-4150bd2f7fea', 'ebbc98f6-a6b8-52f1-99fd-7d47360191ac', 'Regular', 276.00, null, 1),
  ('63e22381-3541-5e29-bca5-0f77d4e50c5d', '8e879c32-5f4a-5c27-afa5-dfc143f1531c', 'Regular', 228.00, null, 1),
  ('a46da8d5-0342-5426-9f79-2a11f4f7e9ad', '5b7dbaaf-abe4-56f4-b247-ae5081955ded', '4-5 persons', 756.00, null, 1),
  ('056dea7a-2258-58f8-ba47-eb963b65de28', '5b7dbaaf-abe4-56f4-b247-ae5081955ded', '6-7 persons', 1056.00, null, 2),
  ('b1f51294-1f0c-5bbc-a3f8-ed4b923ce5af', '5b7dbaaf-abe4-56f4-b247-ae5081955ded', '8-9 persons', 1404.00, null, 3),
  ('deadc38e-3804-536a-b915-eb1f0b25c793', '5b7dbaaf-abe4-56f4-b247-ae5081955ded', '10-12 persons', 1656.00, null, 4),
  ('8b840821-5d58-534a-8a5f-a7c9b5c13713', 'ad566107-c5bd-56ca-9558-fff6a2f09d45', '4-5 persons', 756.00, null, 1),
  ('30d8af83-c4a8-5d90-8f73-420394d4f592', 'ad566107-c5bd-56ca-9558-fff6a2f09d45', '6-7 persons', 1056.00, null, 2),
  ('0db4b477-3489-5202-bf8f-29d83c841d30', 'ad566107-c5bd-56ca-9558-fff6a2f09d45', '8-9 persons', 1404.00, null, 3),
  ('b5832862-16b2-543e-bb99-c5e4fb277ed9', 'ad566107-c5bd-56ca-9558-fff6a2f09d45', '10-12 persons', 1656.00, null, 4),
  ('85fd6ab6-d151-55b0-8ed6-4309a5100213', '651c65db-3d80-52c8-859e-ce0f523f9c6a', '4-5 persons', 924.00, null, 1),
  ('c887197d-4f16-5cbc-a0e7-57529942d999', '651c65db-3d80-52c8-859e-ce0f523f9c6a', '6-7 persons', 1176.00, null, 2),
  ('bead025e-99bf-5956-b278-3dd4d1723705', '651c65db-3d80-52c8-859e-ce0f523f9c6a', '8-9 persons', 1512.00, null, 3),
  ('1b94ea93-d120-5e21-bbaf-3e6a3cf89f02', '651c65db-3d80-52c8-859e-ce0f523f9c6a', '10-12 persons', 1728.00, null, 4),
  ('a273bb2f-5f1c-5b33-9c10-7ee5199f80db', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Small 10 pcs', 144.00, 24.00, 1),
  ('dbc917ba-5957-5fb3-b105-65e2ecaf2a68', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Small 12 pcs', 174.00, 24.00, 2),
  ('cb873a8a-bf38-5849-b3b7-1a1121408ab4', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Medium 15 pcs', 216.00, 42.00, 3),
  ('645aca7d-78b1-5b54-906a-d92080d10d88', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Medium 20 pcs', 288.00, 42.00, 4),
  ('cc8f97b5-089b-506f-997f-83d9a02c6763', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Large 25 pcs', 360.00, 48.00, 5),
  ('f31fe63d-2af2-5eca-b2cd-6d457bfc3752', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Large 30 pcs', 432.00, 48.00, 6),
  ('c4ecb46c-64a5-5fea-a982-db13099d4547', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Extra Large 40 pcs', 576.00, 72.00, 7),
  ('7a4bc2b1-3591-5821-bc1c-0beb57590c3a', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Extra Large 50 pcs', 720.00, 72.00, 8),
  ('2c82669d-7630-5b50-a8f8-e1818f1fbf7e', '737ed414-4824-58b5-baa2-7adcbebaf24f', 'Regular', 1188.00, null, 1),
  ('b58671af-df79-5440-9daa-a5d00ae29556', '737ed414-4824-58b5-baa2-7adcbebaf24f', 'Jumbo', 1308.00, null, 2),
  ('bf5a6d97-abac-5094-8d91-d4fe748b34d9', '7a1ba28f-9981-5b70-8814-da145930a6f6', 'Regular', 378.00, null, 1),
  ('7e75255d-ea88-5c55-831f-2b9ccc40a78b', 'b15a6edb-6055-57e5-8e0b-4fefd628bc29', 'Regular', 350.00, null, 1),
  ('abf3cb9c-df6d-53ec-a0b6-51e043ec6da7', 'b8660476-23eb-5739-b5ba-a3822af1b7d1', 'Regular', 378.00, null, 1),
  ('065639ff-ae20-530f-9a19-c0b6895e4606', '85854ac8-2b5a-5ad0-bd4c-cb6db8d15b44', 'Regular', 378.00, null, 1),
  ('e7e3dca5-28d5-5c9a-a469-e89dbc7f9985', 'f7d46957-355d-51e4-aa97-e0a5f74d58bb', 'Regular', 350.00, null, 1),
  ('c4ee0db6-d210-5695-8c50-b8f6a094cae6', '01693c53-af20-5e8c-ad80-85c673067a52', 'Regular', 354.00, null, 1),
  ('598fc382-6a9c-5ec5-9df8-00b757d42278', '23b1cff5-c0c3-50ba-b421-dcabd5033378', 'Regular', 834.00, null, 1),
  ('b6b4d16f-5a29-5abd-a096-8a7bc1b7498a', '44960559-e54f-54fc-a119-c338ec4aa561', 'Regular', 420.00, null, 1),
  ('5f13aecc-c6f1-52dc-8923-419320dcdb7f', '293dc677-c537-5f5e-8134-9e1dd98e7389', 'Regular', 354.00, null, 1),
  ('70ba72d2-daa4-5fae-a912-35fbad33adad', '6a4fe572-bf58-563e-bfb8-27819eb1ea53', 'Regular', 354.00, null, 1),
  ('ab6931ef-c286-5212-8ad9-58024ebf452e', '8ca1013a-e292-5a0e-920c-27922bc3ed32', 'Regular', 378.00, null, 1),
  ('dbf3a270-9630-5e6b-a491-3709460c73d7', '3256b95e-2e58-595d-bc58-4c364d9d9caa', 'Regular', 378.00, null, 1),
  ('961d2131-f608-5d65-96a0-6ff5b8c87ee5', '72c3a720-9ca4-5b88-8414-67aceb757778', 'Regular', 378.00, null, 1),
  ('5d8b2e16-0cf8-56d7-96ce-416d929d515c', '0abf9316-fca2-5059-90e4-351008763fdd', 'Regular', 426.00, null, 1),
  ('c8eb5f6c-37d8-5d5a-b55a-7e88a6165028', 'c72d3fb0-64e1-5ee4-a67a-a0121e470d68', 'Regular', 390.00, null, 1),
  ('00c4af87-5a6f-55d9-8ce1-b870ed83269e', '2fad587e-bfb6-50cc-89b4-b3235cf26af1', 'Regular', 378.00, null, 1),
  ('354db484-11c0-57a7-b306-4f29bbc2f67d', 'bfbe7d92-1f11-5311-976b-12e60026f7c9', 'Regular', 390.00, null, 1),
  ('3e811924-b3e0-56b9-8b26-33098a428efd', 'ef6e8d25-98a1-55df-81c9-f3fe484a38ca', 'Regular', 390.00, null, 1),
  ('a75d1aa3-692d-54cf-9230-bfbb5223be63', '7a296889-6c4e-58ed-b9da-8bd23f185bad', 'Regular', 390.00, null, 1),
  ('c79fb3e8-f6df-531e-827e-b761286810d1', 'a5d643fb-99c8-537c-bc9c-28c03cc29005', 'Regular', 390.00, null, 1),
  ('0e63b053-c004-5305-9c08-e42aaa5c0000', '75d7af40-0bc3-5497-9636-43300429c955', 'Regular', 330.00, null, 1),
  ('5904a519-8fea-5777-85bf-f8f97c77fec9', '4c94ca9b-b777-581e-b743-0fe6781e3e21', 'Regular', 330.00, null, 1),
  ('32d38a35-5048-586e-b7bb-a68e7b5d92b6', 'af52ffd8-0f5f-5fe7-83e0-d92066939a00', 'Regular', 390.00, null, 1),
  ('fd742567-8385-5d3e-953e-fae8cc8fc7bb', '6716f0ec-9adc-5db3-9c09-5fb4870eace2', 'Regular', 632.00, null, 1),
  ('58cbd249-0fc5-57f7-bb07-be323374d4e2', '4709c507-1795-5ded-9574-0850954657c4', 'Regular', 672.00, null, 1),
  ('7215a90d-0c4a-5a7a-971e-65919b9fcb13', '3ed9ede7-53d5-55c4-bd0e-f55abdad8cde', 'Regular', 768.00, null, 1),
  ('c4903019-f252-55a2-b1dc-568a2d92954c', '07f0e56e-9014-552b-8ba4-605baa36c172', 'Regular', 546.00, null, 1),
  ('aeebe83a-230b-5bd2-a49d-3450091513fc', '5290cee0-5849-5303-9995-a66286172958', 'Regular', 462.00, null, 1),
  ('af0f49e6-473a-5298-b8b6-118a97d96819', 'ee22a262-27b8-5888-ba62-84a9f9082c5b', 'Regular', 546.00, null, 1),
  ('c0a921f6-3419-56ea-b4c6-e9c7c05674d0', '636309c0-8b83-56de-b131-cf7bb7d835fa', 'Regular', 462.00, null, 1),
  ('f9cd90ba-60f1-526d-a9ac-8f6cc8fee269', '3de963e0-f6d8-5007-8567-85e4d3aec8a1', 'Regular', 462.00, null, 1),
  ('ead48841-3fe4-50e4-b93f-5050143c554f', 'bce6aef7-ad25-547c-a1ee-310b822f6a63', 'Regular', 306.00, null, 1),
  ('9b47729b-14b7-5030-acc0-44753e8123b2', 'e6b75871-ed5d-5649-b3e7-857606c8ed9c', 'Regular', 318.00, null, 1),
  ('c8f3cd02-0bdf-5d76-b67b-263cdba65167', 'fb8f9b8a-0fdb-580b-88a4-f89672b2ebd4', 'Regular', 318.00, null, 1),
  ('7c706749-82af-5508-ba31-5e2d38f0a067', 'ee474f98-b85b-5625-8275-969f9b84b00b', '4 pax', 546.00, null, 1),
  ('ac037718-cb26-56e4-a601-2d39eb401221', 'ee474f98-b85b-5625-8275-969f9b84b00b', '6 pax', 756.00, null, 2),
  ('73358876-d509-5a65-92fd-49b7de4f300e', 'ee474f98-b85b-5625-8275-969f9b84b00b', '8 pax', 1050.00, null, 3),
  ('b0f2e964-3989-50e9-81d8-030af30cc5ee', 'ee474f98-b85b-5625-8275-969f9b84b00b', '10 pax', 1260.00, null, 4),
  ('9301d21b-1b32-5109-a9cc-90adbd8f6714', '2437fd43-2ee0-5e92-9896-381bd304710a', '4 pax', 468.00, null, 1),
  ('78ff6ec5-215c-5586-aee7-c9ac8d6c3446', '2437fd43-2ee0-5e92-9896-381bd304710a', '6 pax', 744.00, null, 2),
  ('962fa394-63bd-58a8-933c-6c467e3b2109', '2437fd43-2ee0-5e92-9896-381bd304710a', '8 pax', 936.00, null, 3),
  ('03e006be-eef8-5dba-afcd-df6a27eca2a9', '2437fd43-2ee0-5e92-9896-381bd304710a', '10 pax', 1170.00, null, 4),
  ('dbf8ec38-1506-583c-afba-109d55491d9c', 'bcf73a60-d2fb-5bc8-ab3c-627b68430c65', '4 pax', 468.00, null, 1),
  ('f6694ab9-b053-5496-9313-5e3817f25599', 'bcf73a60-d2fb-5bc8-ab3c-627b68430c65', '6 pax', 744.00, null, 2),
  ('e50c50a1-56e4-5da7-abd8-1a09a441be60', 'bcf73a60-d2fb-5bc8-ab3c-627b68430c65', '8 pax', 936.00, null, 3),
  ('12d3e9d2-9de3-547c-8742-553c861ac7ce', 'bcf73a60-d2fb-5bc8-ab3c-627b68430c65', '10 pax', 1170.00, null, 4),
  ('70d195ed-f56e-5d91-a15c-b7c0ac137396', '790411de-6998-5787-9dee-27a5ed2fdddf', 'Regular', 378.00, null, 1),
  ('a6820eca-2ce4-5f2c-8f2c-817b70753c3b', 'f607e88b-7e1a-5d36-b9be-5701c2a448c3', 'Regular', 354.00, null, 1),
  ('8cdf4d23-bcfd-5c1a-8ed4-ec486bc6d46b', '548f5e20-68c2-516c-918c-16567d309a5a', 'Regular', 318.00, null, 1),
  ('dca0b812-41fc-599b-a327-f4d6d7d9c0b8', '7e51c541-2a0b-5566-8d72-5e6ac9672129', 'Regular', 318.00, null, 1),
  ('2385c7e3-d106-5d7c-8532-5f1238bfafbb', 'ae8182ea-f19e-592e-bb61-09e3a9326a2e', 'Regular', 420.00, null, 1),
  ('4e049114-a027-502c-9e15-48f7fd707d83', 'ed9fccb7-1c43-5f86-b8de-b311491d6064', 'Regular', 315.00, null, 1),
  ('b5ef97b4-c837-5eb3-b48e-4688bab6e580', 'd1e8911f-c597-5a85-b1c9-56dbf78be4ea', 'Platter', 318.00, null, 1),
  ('c63f93ac-41f8-527a-a5af-40f285e4b942', 'd1e8911f-c597-5a85-b1c9-56dbf78be4ea', 'Cup', 70.00, null, 2),
  ('06bfc901-d335-5a1c-b554-34549d2546c7', 'd1b72b9f-236b-5dce-94af-f0b0c3c8a1ff', 'Platter', 188.00, null, 1),
  ('2076efc9-b7e0-553c-8145-871902023301', 'd1b72b9f-236b-5dce-94af-f0b0c3c8a1ff', 'Cup', 55.00, null, 2),
  ('ecf053ab-bbc2-5792-ba58-781385da34fe', '1e29d496-ffd6-59bf-a476-19fda27fb8a0', 'Regular', 114.00, null, 1),
  ('cd61c3e4-6c9e-5b35-bb03-d3ede8b881bc', 'f92b88e4-9e6a-56d5-9ff4-1ea7ae6274f3', 'Regular', 114.00, null, 1),
  ('0aa99c5c-e1b8-5997-a0f9-86d025913eef', 'ee9a4af1-d214-5b90-92ec-25357268b0ae', 'Regular', 114.00, null, 1),
  ('e03f58e8-7713-5a56-b0fa-3875e5a0536d', 'abda6ceb-3180-5708-9b8a-4efbc82ed8ac', 'Regular', 114.00, null, 1),
  ('0cde5371-2041-5146-a4f2-6c6f011853e0', 'd65504bf-7c06-5252-86b5-966112e054f6', 'Regular', 114.00, null, 1),
  ('6bcf1631-4eec-5e96-b985-8ea0463a3d51', 'b1fd85e8-f0a7-5aae-bc65-5defe5105142', 'Regular', 114.00, null, 1),
  ('ccdf03cc-f62a-52b9-8ce7-0547024c3074', 'f3f5332f-083e-5402-88bc-e76603d6a58d', 'Regular', 114.00, null, 1),
  ('0a25d6bd-5557-5090-b8da-3da5e8554362', '741204fe-a10d-5529-be18-ce4106d5d19c', 'Regular', 53.00, null, 1),
  ('6622c81f-14c2-5dcd-857a-bc0fe4e9ca3f', 'ad142872-efcc-51a7-83ee-f74cb240dbdc', 'Glass', 98.00, null, 1),
  ('3e22912f-e19d-569c-8286-6bc820f18f28', 'ad142872-efcc-51a7-83ee-f74cb240dbdc', 'Pitcher', 295.00, null, 2),
  ('2a5459df-151b-5435-bfc6-f38cc348ef87', 'c46cab57-1765-56e3-8cb7-f45adc2ccfbb', 'Glass', 70.00, null, 1),
  ('52680607-6fc8-5352-93cd-a515b7fabdc6', 'c46cab57-1765-56e3-8cb7-f45adc2ccfbb', 'Pitcher', 268.00, null, 2),
  ('7a90687c-28ad-5492-97a1-0422c88cf082', '5593f11f-c061-5bc8-867d-21d3e3c6dc02', 'Glass', 105.00, null, 1),
  ('dc56e17e-c995-5ffb-b4de-dba6be339b2e', '5593f11f-c061-5bc8-867d-21d3e3c6dc02', 'Pitcher', 315.00, null, 2),
  ('aa1d2991-439e-517d-ae3e-c1501738d27e', '413b57ef-721c-55b8-96af-c98c8f2f7183', 'Regular', 105.00, null, 1),
  ('6d942203-1a18-59e8-948a-5b54296b8596', '54e1bb53-eb1a-524d-ae74-65b4a8cd7fce', 'Regular', 105.00, null, 1),
  ('c33aa148-06a2-5390-a1b8-e908e08d6c52', 'fab0e6ff-4214-55ec-bb05-96c8fe6316b9', 'Regular', 114.00, null, 1),
  ('14634679-8564-5b30-8cea-892518af09ea', 'fab0e6ff-4214-55ec-bb05-96c8fe6316b9', 'Large', 144.00, null, 2),
  ('fb043207-37f9-554a-9c40-8331677165ab', 'fab0e6ff-4214-55ec-bb05-96c8fe6316b9', 'Barkada', 264.00, null, 3),
  ('07b67b53-970a-5d1f-b9f1-8a91d2015ddc', 'ffa82454-0041-5c77-a57b-d436b22d0099', 'Regular', 150.00, null, 1),
  ('6b1ae57b-ab32-5377-8a27-18db8a4707cb', 'ffa82454-0041-5c77-a57b-d436b22d0099', 'Barkada', 420.00, null, 2),
  ('b9a7a3c1-9f2c-507a-a8f4-4cb762ed419d', 'aed408f4-d898-52d9-9fc3-941027d17ca5', 'Regular', 84.00, null, 1),
  ('d32e216c-f87d-5450-8d1e-1845ad1276f9', '5d67878c-bc08-52fa-872b-d47796d25cf5', 'Regular', 78.00, null, 1),
  ('6d2966d5-e637-598a-876f-89020e939bca', '8d241c8f-6a31-5a57-965d-6f934e228f81', 'Regular', 144.00, null, 1),
  ('26bdd7d3-4498-5f46-859e-4d3d4bdf7df2', 'edd311d5-b068-563a-b26a-37aa16941a6c', 'Regular', 732.00, null, 1),
  ('c902265e-fba1-5e9d-a5eb-89e5e82febdf', 'f91190de-5349-5562-b0c5-9b995528a3bf', 'Regular', 756.00, null, 1),
  ('ac3bb7da-73bc-52cb-a3be-e8e41cde3bb7', '023ee212-cbd1-507a-a0b9-76b886736d2f', 'Regular', 828.00, null, 1),
  ('8674bd92-8238-54be-9cac-748a7ad501b9', '351ca4d2-19f6-52f6-82bc-3f60a66fb483', 'Regular', 624.00, null, 1),
  ('3d27e7a4-edeb-5713-abc7-525e09b9e32d', '5764d920-93cb-5641-9d04-3fc3839376a4', 'Regular', 468.00, null, 1),
  ('0980a4f3-0edb-5781-95d2-24e21ae1be74', '5764d920-93cb-5641-9d04-3fc3839376a4', 'Medium', 492.00, null, 2),
  ('a7260b2b-1c4a-55b8-a242-18a5e9e68874', '5764d920-93cb-5641-9d04-3fc3839376a4', 'Large', 516.00, null, 3)
on conflict (id) do nothing;

insert into public.option_groups (id, product_id, name, is_required) values
  ('c0045474-604d-56b9-9664-84a47301cde7', '2d7e7369-42df-51fc-acdc-8c83f38c1773', 'Cut', true),
  ('0b9f77c5-6f31-55d0-8fef-1a1723306d71', '937ff8fd-b85b-526f-a2fb-4424c31abc47', 'Flavor', true),
  ('d1ba6188-42a9-5b6c-b60c-c3c6232c5cf9', 'b0ba5dd5-c0e1-5bb3-9237-ee85a3eba3f1', 'Type', true),
  ('eebed875-9ad1-539f-80d2-450aa48fb750', 'b4375699-629e-5307-91b0-11f3e3986796', 'Flavor', true),
  ('071f2063-676b-56b1-a4f5-afba8409d8c2', '9f0b555f-af46-501e-98dc-6e1e61806a92', 'Flavor', true),
  ('432e773c-fc1a-5ced-978b-d0a6ec9785be', '76f67d98-1080-5e02-a0b7-19ddd5e37b71', 'Choice', true),
  ('5a0cc467-1c46-5a3f-a797-b0b31de9df9b', '5be21672-4765-51f4-93c8-c639ceeca9e7', 'Choice', true),
  ('108b15bf-453d-5511-9e14-d2986356f9c9', '316e4561-cd25-5ddd-94aa-3f350067a1c0', 'Style', true),
  ('72ce9198-582c-540e-a0fd-dcf12ab3ab09', 'e3bd618f-04b3-58bc-9f84-48ad6901a410', 'Choice', true),
  ('fd3fb50e-dbb5-5483-ab96-63b093d32507', 'd27c854a-37eb-5760-9c81-ecf7313aef38', 'Style', true),
  ('774d4382-0e90-50ee-8ff7-286f8e3a18b8', '5f5dc003-af69-576f-a30f-1b1c51fccae1', 'Choice', true),
  ('34644780-039d-59ce-a0a3-d7faf907ae0f', 'b11ca638-fd86-58c2-927c-a149ee72a442', 'Filling', true),
  ('426f3d7c-5b2b-510f-b6f9-b045b1532a1c', 'ab7a1b4b-c998-5931-b953-d16f873dedf7', 'Choice', true),
  ('006987ce-b729-597a-a1a9-ed89ef39ae34', 'a7ecf131-3bcb-58ef-acb7-c3c18e18f022', 'Flavor', true),
  ('4487249d-7b12-501e-8a87-344d7fc2fcfb', '49131ac8-cbd3-5219-8774-10af96e60728', 'Flavor', true),
  ('4b79d61c-d3b5-5280-b43b-0db393799db5', '1ac6a15e-d2d1-5a6c-b436-0fdeee27ea67', 'Type', true),
  ('725f254a-c71e-5d45-8c71-73e1d0378ae0', 'e056fca1-085d-5544-8f9a-c2846d2dae86', 'Style', true),
  ('7da4851c-6bf6-5489-9dec-c9e5fb4d03b5', '78730486-08aa-5b41-a95c-e75daafa22f9', 'Topping', true)
on conflict (id) do nothing;

insert into public.option_choices (id, group_id, label, price_delta, sort) values
  ('7f5e75aa-53eb-5a2a-84bd-721cd4b67c48', 'c0045474-604d-56b9-9664-84a47301cde7', 'Belly', 0.00, 1),
  ('823bf37f-c590-5ef6-bd13-d33d8c2c45be', 'c0045474-604d-56b9-9664-84a47301cde7', 'Panga', 0.00, 2),
  ('cfa88440-ae62-5e11-b182-6ca800aceb37', '0b9f77c5-6f31-55d0-8fef-1a1723306d71', 'Yema', 0.00, 1),
  ('c8cd5522-0f13-5de0-9353-f0c2942b186d', '0b9f77c5-6f31-55d0-8fef-1a1723306d71', 'Ube', 0.00, 2),
  ('acb647b5-3b37-57c9-8e8c-088e766a20bb', '0b9f77c5-6f31-55d0-8fef-1a1723306d71', 'Macapuno', 0.00, 3),
  ('38e6b7ff-8dff-5986-ab67-3491319a4c18', '0b9f77c5-6f31-55d0-8fef-1a1723306d71', 'Mocha', 0.00, 4),
  ('f02c4a23-72c1-52f3-ae21-fe79ed8300aa', 'd1ba6188-42a9-5b6c-b60c-c3c6232c5cf9', 'Puto Keso', 0.00, 1),
  ('71bcfc1a-ad32-5365-9563-64fbaccac0e7', 'd1ba6188-42a9-5b6c-b60c-c3c6232c5cf9', 'Puto Salted Egg', 0.00, 2),
  ('9e9be9c4-f2c4-5f45-9b6e-956d1a43a99b', 'd1ba6188-42a9-5b6c-b60c-c3c6232c5cf9', 'Plain', 0.00, 3),
  ('e6f4b87f-71c9-55d2-9357-568ce97d4751', 'eebed875-9ad1-539f-80d2-450aa48fb750', 'Coke', 0.00, 1),
  ('4de038e3-a887-5b86-aedd-7e6dd01c75e4', 'eebed875-9ad1-539f-80d2-450aa48fb750', 'Royal', 0.00, 2),
  ('234bb16d-3c80-555d-8122-bb406f72255a', 'eebed875-9ad1-539f-80d2-450aa48fb750', 'Sprite', 0.00, 3),
  ('59ea9033-98a8-5363-a137-ce64d495918f', '071f2063-676b-56b1-a4f5-afba8409d8c2', 'Coke', 0.00, 1),
  ('0bfbca4d-7f18-58db-bbbc-fc4d151ece33', '071f2063-676b-56b1-a4f5-afba8409d8c2', 'Royal', 0.00, 2),
  ('22b294b7-94e7-536c-8d52-d4790ec3897c', '071f2063-676b-56b1-a4f5-afba8409d8c2', 'Sprite', 0.00, 3),
  ('5ade7749-9d09-5df6-abef-5ec4657d7860', '071f2063-676b-56b1-a4f5-afba8409d8c2', 'Mountain Dew', 0.00, 4),
  ('7791dfa8-82a7-50b7-945b-adbb0d86da7d', '432e773c-fc1a-5ced-978b-d0a6ec9785be', 'Pork', 0.00, 1),
  ('a0634cca-f539-572d-9b8a-147fd354e356', '432e773c-fc1a-5ced-978b-d0a6ec9785be', 'Chicken', 0.00, 2),
  ('7445a4fe-a215-58a5-9185-21fc023e93bb', '5a0cc467-1c46-5a3f-a797-b0b31de9df9b', 'Beef', 0.00, 1),
  ('08cda630-539a-53ed-93f7-2b1b654cb681', '5a0cc467-1c46-5a3f-a797-b0b31de9df9b', 'Shrimp', 0.00, 2),
  ('c2a1dab3-0370-5db1-a948-437cec6abab0', '5a0cc467-1c46-5a3f-a797-b0b31de9df9b', 'Lechon', 0.00, 3),
  ('60b90f1e-7601-52b0-94a2-0b8dbdba3148', '108b15bf-453d-5511-9e14-d2986356f9c9', 'Toppings', 0.00, 1),
  ('10666d6d-cc7a-5b59-8a91-b818413f7f70', '108b15bf-453d-5511-9e14-d2986356f9c9', 'Guisado', 0.00, 2),
  ('fc0d9c5b-77c2-5f79-9149-3a223e6ae3b2', '72ce9198-582c-540e-a0fd-dcf12ab3ab09', 'Pork', 0.00, 1),
  ('2784bd45-7380-5c62-98e1-df9a6631a0bf', '72ce9198-582c-540e-a0fd-dcf12ab3ab09', 'Bangus', 0.00, 2),
  ('2a46e683-832c-5493-9b33-ad0c8ea176c2', 'fd3fb50e-dbb5-5483-ab96-63b093d32507', 'Fried', 0.00, 1),
  ('0c6bc4f5-4d66-521d-9b11-0600d131fb5f', 'fd3fb50e-dbb5-5483-ab96-63b093d32507', 'Tausi', 0.00, 2),
  ('8107e8b8-ce46-55c4-a7db-5e8f9dfa1a84', 'fd3fb50e-dbb5-5483-ab96-63b093d32507', 'Sweet & Sour', 0.00, 3),
  ('183c55bf-94f9-5f57-8fdd-ac691eb77bd9', '774d4382-0e90-50ee-8ff7-286f8e3a18b8', 'Shrimp', 0.00, 1),
  ('773037f4-3406-5dda-98eb-52ef91b46939', '774d4382-0e90-50ee-8ff7-286f8e3a18b8', 'Fish', 0.00, 2),
  ('2d4ce55f-693a-5ef9-afd7-081bdc4528d1', '34644780-039d-59ce-a0a3-d7faf907ae0f', 'Crab', 0.00, 1),
  ('41bfddf9-d08d-51e8-83a5-3dda5dc814f7', '34644780-039d-59ce-a0a3-d7faf907ae0f', 'Pork', 0.00, 2),
  ('281ad422-cdf7-532a-b5c4-3db9b05d216c', '426f3d7c-5b2b-510f-b6f9-b045b1532a1c', 'Pork', 0.00, 1),
  ('13da08b4-bef5-5f0e-a15a-dd5b3d8a9ccc', '426f3d7c-5b2b-510f-b6f9-b045b1532a1c', 'Tenga', 0.00, 2),
  ('e02b136c-c961-58b1-9458-b5fddcd7c5d0', '006987ce-b729-597a-a1a9-ed89ef39ae34', 'Mango', 0.00, 1),
  ('5fef51cf-23b8-58b3-ae70-b40e992abe53', '006987ce-b729-597a-a1a9-ed89ef39ae34', 'Banana', 0.00, 2),
  ('293803d0-b620-5506-b27a-43f8945b6a5e', '4487249d-7b12-501e-8a87-344d7fc2fcfb', 'Pineapple', 0.00, 1),
  ('58d8a5d5-f3bc-5d7c-9bb3-5f4c3b3a9dcc', '4487249d-7b12-501e-8a87-344d7fc2fcfb', 'Four Seasons', 0.00, 2),
  ('dd7ee79f-ea6e-537d-b96c-f38fb1211e83', '4487249d-7b12-501e-8a87-344d7fc2fcfb', 'Mango', 0.00, 3),
  ('b212abca-0f4f-5b70-8f51-8ac66511617c', '4b79d61c-d3b5-5280-b43b-0db393799db5', 'Espresso', 0.00, 1),
  ('5a435af2-03a0-5fee-b439-cc48490a1231', '4b79d61c-d3b5-5280-b43b-0db393799db5', 'Lungo', 0.00, 2),
  ('6a049813-40fb-5134-a13d-9463efc53e72', '725f254a-c71e-5d45-8c71-73e1d0378ae0', 'Hot', 0.00, 1),
  ('247271fe-4688-5eaa-b52f-072129476942', '725f254a-c71e-5d45-8c71-73e1d0378ae0', 'Iced', 0.00, 2),
  ('3fde350b-6850-5083-b597-66ab48240091', '7da4851c-6bf6-5489-9dec-c9e5fb4d03b5', 'Cheese', 0.00, 1),
  ('762884f8-9d86-52ce-8484-3968493d55e4', '7da4851c-6bf6-5489-9dec-c9e5fb4d03b5', 'Coconut', 0.00, 2)
on conflict (id) do nothing;

-- Balsa Chicken "Buttered Half" is not seeded: its price must be confirmed
-- from the menu photo first (see scripts/menu-data.mjs).
