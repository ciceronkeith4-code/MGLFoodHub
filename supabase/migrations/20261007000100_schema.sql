-- =====================================================================
-- MGL Food Hub — schema, security (RLS), storage, realtime
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type public.payment_method as enum ('cod', 'gcash', 'maribank', 'gotyme');
exception when duplicate_object then null; end $$;
-- Databases created before MariBank and GoTyme were added.
alter type public.payment_method add value if not exists 'maribank';
alter type public.payment_method add value if not exists 'gotyme';

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
  ('maribank_account_name', '""'::jsonb),
  ('maribank_number', '""'::jsonb),
  ('maribank_qr_url', '""'::jsonb),
  ('gotyme_account_name', '""'::jsonb),
  ('gotyme_number', '""'::jsonb),
  ('gotyme_qr_url', '""'::jsonb),
  ('cutoff_time', '"20:00"'::jsonb),
  ('max_days_ahead', '30'::jsonb),
  ('blocked_dates', '[]'::jsonb),
  ('delivery_fee_note', '"Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries)."'::jsonb),
  ('email_notifications_enabled', 'false'::jsonb),
  ('max_orders_per_phone_per_day', '5'::jsonb),
  ('ordering_guidelines', jsonb_build_array(
    'We deliver via Grab within Metro Manila from 12:00 PM to 6:00 PM.',
    'Pay by Cash on Delivery (COD) or online via GCash, MariBank or GoTyme.',
    'Orders are for booking (scheduled delivery) only. Same day delivery is not available.',
    'We will confirm your order by text or call.',
    'Menu prices are VAT inclusive and may vary or be subject to change by the merchant. Higher delivery fees may also apply for long distance deliveries.',
    'You can order from all merchants in the app and pay only one delivery fee.'
  ))
on conflict (key) do nothing;

-- Existing databases: update the two default guidelines that changed (custom ones are kept).
update public.settings
   set value = (
     select coalesce(jsonb_agg(case g
         when 'Pay by Cash on Delivery (COD) or online (GCash).' then 'Pay by Cash on Delivery (COD) or online via GCash, MariBank or GoTyme.'
         when 'Orders are for booking (scheduled delivery) only. Same-day delivery is not available.' then 'Orders are for booking (scheduled delivery) only. Same day delivery is not available.'
         else g end order by n), '[]'::jsonb)
     from jsonb_array_elements_text(value) with ordinality as t(g, n))
 where key = 'ordering_guidelines' and jsonb_typeof(value) = 'array';

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
