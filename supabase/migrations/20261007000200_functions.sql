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
