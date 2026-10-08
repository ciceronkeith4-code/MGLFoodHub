// Supabase Edge Function: sends the order confirmation email (with the tracking
// link) through Resend. Called by the checkout page right after place_order.
//
// Secrets (supabase secrets set …):
//   RESEND_API_KEY   – Resend API key
//   RESEND_FROM      – e.g. "MGL Food Hub <orders@yourdomain.com>" (verified domain)
//   SITE_URL         – e.g. https://mglfoodhub.com (used to build the tracking link)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Safe to expose publicly: it only emails the address saved on the order, only
// once, only within 15 minutes of the order being placed, and only when
// "email_notifications_enabled" is on in the admin settings.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const peso = (n: number) =>
  '₱' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const slotLabel = (slot: string) =>
  slot
    .split('-')
    .map((t) => {
      const [h, m] = t.split(':').map(Number)
      return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
    })
    .join(' – ')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let token = ''
  try {
    token = String((await req.json())?.token ?? '')
  } catch {
    return json({ error: 'Invalid body' }, 400)
  }
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return json({ error: 'Invalid token' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  const { data: setting } = await db.from('settings').select('value').eq('key', 'email_notifications_enabled').maybeSingle()
  if (setting?.value !== true) return json({ skipped: 'disabled' })

  const { data: order } = await db
    .from('orders')
    .select(
      'id, order_number, tracking_token, customer_name, email, delivery_date, delivery_slot, payment_method, subtotal, created_at, email_sent_at, order_items(store_name_snapshot, product_name_snapshot, variant_label_snapshot, options_snapshot, quantity, line_total, line_no)',
    )
    .eq('tracking_token', token)
    .maybeSingle()

  if (!order) return json({ error: 'Not found' }, 404)
  if (order.email_sent_at) return json({ skipped: 'already sent' })
  if (Date.now() - new Date(order.created_at).getTime() > 15 * 60 * 1000) return json({ skipped: 'too old' })

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) return json({ error: 'Email not configured' }, 500)

  const site = (Deno.env.get('SITE_URL') || req.headers.get('origin') || '').replace(/\/$/, '')
  const link = `${site}/track/${order.tracking_token}`
  const date = new Date(`${order.delivery_date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  type Item = { store_name_snapshot: string; product_name_snapshot: string; variant_label_snapshot: string; options_snapshot: { group: string; choice: string }[]; quantity: number; line_total: number; line_no: number }
  const items = ((order.order_items ?? []) as Item[]).sort((a, b) => a.line_no - b.line_no)
  const rows = items
    .map((i) => {
      const opts = [i.variant_label_snapshot !== 'Regular' ? i.variant_label_snapshot : '', ...i.options_snapshot.map((o) => `${o.group}: ${o.choice}`)]
        .filter(Boolean)
        .join(' · ')
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #f1e6da"><strong>${i.quantity}× ${esc(i.product_name_snapshot)}</strong><br><span style="color:#6b7280;font-size:13px">${esc(i.store_name_snapshot)}${opts ? ' · ' + esc(opts) : ''}</span></td><td style="padding:6px 0;border-bottom:1px solid #f1e6da;text-align:right;white-space:nowrap">${peso(i.line_total)}</td></tr>`
    })
    .join('')

  const html = `<!doctype html><html><body style="margin:0;background:#FFF9F3;font-family:Inter,Arial,sans-serif;color:#0D2B4E">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <h1 style="font-family:Poppins,Arial,sans-serif;font-size:22px;margin:0 0 4px">Thank you, ${esc(order.customer_name)}!</h1>
  <p style="margin:0 0 16px;color:#4b5563">We received your order <strong>${esc(order.order_number)}</strong>.</p>
  <div style="background:#fff3e0;border:2px solid #F7941D;border-radius:12px;padding:16px;margin-bottom:16px">
    <p style="margin:0 0 8px;font-weight:700">⚠️ SAVE THIS ORDER LINK. This is the only way to check your order status.</p>
    <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#F7941D,#E2382B);background-color:#F7941D;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">Track my order</a>
    <p style="margin:8px 0 0;font-size:12px;word-break:break-all;color:#6b7280">${link}</p>
  </div>
  <p style="margin:0 0 4px"><strong>Delivery:</strong> ${esc(date)}, ${esc(slotLabel(order.delivery_slot))}</p>
  <p style="margin:0 0 16px"><strong>Payment:</strong> ${order.payment_method === 'gcash' ? 'GCash' : 'Cash on Delivery'}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
    <tr><td style="padding:8px 0;font-weight:700">Food subtotal</td><td style="padding:8px 0;text-align:right;font-weight:700">${peso(order.subtotal)}</td></tr>
  </table>
  <p style="font-size:12px;color:#6b7280;margin-top:16px">Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries).</p>
</div></body></html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [order.email], subject: `Your MGL Food Hub order ${order.order_number}`, html }),
  })
  if (!res.ok) return json({ error: 'Email provider error', detail: await res.text() }, 502)

  await db.from('orders').update({ email_sent_at: new Date().toISOString() }).eq('id', order.id)
  return json({ sent: true })
})
