import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft, Ban, CheckCircle2, ChefHat, Copy, ExternalLink, Link2, Mail, MapPin, PackageCheck, Phone, PhoneCall, Save, ShieldCheck, Truck, XCircle,
} from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import type { CallLogRow, HistoryRow, OrderItemRow, OrderRow } from '@/lib/types'
import { historyLabel, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { cn, copyText, formatDate, formatDateTime, formatPhone, peso, slotLabel, socialUrl, trackingUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { RadioCard, RadioGroup, Skeleton } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorBanner, Lightbox } from '@/components/common'
import { PaymentLogo } from '@/components/PaymentLogo'
import { AdminPageHeader, OrderBadges, Panel } from './ui'
import { useAdminLive } from './AdminLayout'

type Action = 'confirm' | 'mark_paid' | 'reject_payment' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancel' | 'decline_cancel_request'

const ACTIONS: Record<Action, { title: string; confirm: string; reason?: string; destructive?: boolean; description: string }> = {
  confirm: { title: 'Confirm this COD order?', confirm: 'Confirm Order', description: 'Do this after you have called and confirmed with the customer.' },
  mark_paid: { title: 'Mark payment as paid?', confirm: 'Mark as Paid', description: 'Only do this after checking the amount and reference number in your app.' },
  reject_payment: { title: 'Reject this payment?', confirm: 'Reject Payment', reason: 'Reason (shown to the customer)', destructive: true, description: 'The customer will see the reason and can upload a new proof.' },
  preparing: { title: 'Mark as Preparing?', confirm: 'Mark Preparing', description: 'The customer will see “Preparing”.' },
  out_for_delivery: { title: 'Mark as Out for Delivery?', confirm: 'Out for Delivery', description: 'The customer will see that the rider is on the way.' },
  delivered: { title: 'Mark as Delivered?', confirm: 'Mark Delivered', description: 'COD orders will also be marked as paid.' },
  cancel: { title: 'Cancel this order?', confirm: 'Cancel Order', reason: 'Reason (shown to the customer)', destructive: true, description: 'This cannot be undone.' },
  decline_cancel_request: { title: 'Decline the cancellation request?', confirm: 'Decline request', reason: 'Message to the customer (optional)', description: 'The order will continue as normal.' },
}

const CALL_RESULT: Record<CallLogRow['result'], string> = { answered: 'Answered', no_answer: 'No answer', wrong_number: 'Wrong number' }

export default function OrderDetail() {
  const { id = '' } = useParams()
  const { version } = useAdminLive()
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [items, setItems] = useState<OrderItemRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [calls, setCalls] = useState<CallLogRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [proofOpen, setProofOpen] = useState(false)
  const [pending, setPending] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [fee, setFee] = useState('')
  const notesDirtyRef = useRef(false)
  notesDirtyRef.current = notesDirty
  const feeTouched = useRef(false)

  const load = useCallback(async () => {
    const [o, it, h, c] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('order_items').select('*').eq('order_id', id).order('line_no'),
      supabase.from('order_status_history').select('*').eq('order_id', id).order('created_at', { ascending: false }),
      supabase.from('call_logs').select('*').eq('order_id', id).order('created_at', { ascending: false }),
    ])
    if (o.error) return setError(errorMessage(o.error))
    if (!o.data) return setMissing(true)
    const row = o.data as OrderRow
    setOrder(row)
    setItems((it.data ?? []) as OrderItemRow[])
    setHistory((h.data ?? []) as HistoryRow[])
    setCalls((c.data ?? []) as CallLogRow[])
    if (!notesDirtyRef.current) setNotes(row.admin_notes ?? '')
    if (!feeTouched.current) setFee(Number(row.delivery_fee) > 0 ? String(Number(row.delivery_fee)) : '')
    setError(null)
  }, [id])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    if (!order?.gcash_proof_path) return setProofUrl(null)
    void supabase.storage
      .from('payment-proofs')
      .createSignedUrl(order.gcash_proof_path, 60 * 60)
      .then(({ data }) => setProofUrl(data?.signedUrl ?? null))
  }, [order?.gcash_proof_path])

  async function run(action: Action | 'set_delivery_fee', note?: string, amount?: number) {
    setBusy(true)
    const { error } = await supabase.rpc('admin_order_action', {
      p_order_id: id,
      p_action: action,
      p_note: note?.trim() || null,
      p_amount: amount ?? null,
    })
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return false
    }
    toast.success('Order updated. The customer sees it instantly.')
    await load()
    return true
  }

  if (missing) return <EmptyState title="Order not found" action={<Button asChild><Link to="/admin/orders">Back to orders</Link></Button>} />
  if (!order) {
    return error ? <ErrorBanner>{error}</ErrorBanner> : (
      <div className="space-y-3">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const o = order
  const isCod = o.payment_method === 'cod'
  const methodLabel = PAYMENT_METHOD_LABEL[o.payment_method]
  const refText = o.gcash_reference ? ` and Ref ${o.gcash_reference}` : ''
  const done = o.order_status === 'delivered' || o.order_status === 'cancelled'
  const social = socialUrl(o.social_media)
  const groups = new Map<string, OrderItemRow[]>()
  for (const i of items) groups.set(i.store_name_snapshot, [...(groups.get(i.store_name_snapshot) ?? []), i])
  const spec =
    pending === 'confirm' && !isCod
      ? {
          title: `Confirm this ${methodLabel} order?`,
          confirm: 'Confirm Order',
          description: `This also marks the ${methodLabel} payment as paid. Only confirm after checking ${peso(o.subtotal)}${refText} in your ${methodLabel} app.`,
        }
      : pending
        ? ACTIONS[pending]
        : null

  // Confirmation is always shown for every payment method: awaiting → button, otherwise its result.
  const confirmedEntry = history.find((h) => h.status === 'confirmed' || h.status === 'payment_confirmed')
  const awaitingConfirmation = o.order_status === 'processing'

  const next: { action: Action; label: string; icon: ReactNode }[] = []
  if (o.order_status === 'processing' && !isCod && o.payment_status === 'pending_verification') {
    next.push({ action: 'reject_payment', label: 'Reject Payment', icon: <XCircle /> })
  }
  if (o.order_status === 'confirmed') next.push({ action: 'preparing', label: 'Mark Preparing', icon: <ChefHat /> })
  if (o.order_status === 'preparing') next.push({ action: 'out_for_delivery', label: 'Out for Delivery', icon: <Truck /> })
  if (o.order_status === 'out_for_delivery') next.push({ action: 'delivered', label: 'Mark Delivered', icon: <PackageCheck /> })

  return (
    <div className="space-y-5">
      <Link to="/admin/orders" className="inline-flex items-center gap-1 text-sm font-semibold text-navy/60 hover:text-brand-600">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <AdminPageHeader
        title={o.order_number}
        description={`Placed ${formatDateTime(o.created_at)} · ${PAYMENT_METHOD_LABEL[o.payment_method]}`}
        actions={
          <Button variant="outline" size="sm" onClick={async () => (await copyText(trackingUrl(o.tracking_token))) && toast.success('Customer tracking link copied')}>
            <Link2 /> Copy tracking link
          </Button>
        }
      />
      <OrderBadges order={o} className="-mt-3" />

      {o.cancel_requested && o.order_status !== 'cancelled' && (
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-brand-red/40 bg-red-50 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-heading font-bold text-red-800">Customer requested cancellation</p>
            <p className="text-sm text-red-900/80">“{o.cancel_request_reason}”</p>
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" onClick={() => { setReason(o.cancel_request_reason ?? ''); setPending('cancel') }}>
              Cancel order
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setReason(''); setPending('decline_cancel_request') }}>
              Decline
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          {/* Order confirmation: always visible, for every payment method */}
          <Panel title="Order confirmation">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-navy/65">
                {o.order_status === 'cancelled'
                  ? 'This order was cancelled and can no longer be confirmed.'
                  : awaitingConfirmation
                    ? isCod
                      ? 'Call the customer first, then confirm the order.'
                      : o.payment_status === 'rejected'
                        ? 'Payment was rejected. Confirm only if the customer has since paid the correct amount.'
                        : `Check ${peso(o.subtotal)}${o.gcash_reference ? ` (Ref ${o.gcash_reference})` : ''} in your ${methodLabel} app, then confirm.`
                    : confirmedEntry
                      ? `Confirmed ${formatDateTime(confirmedEntry.created_at)}${confirmedEntry.changed_by_email ? ` by ${confirmedEntry.changed_by_email}` : ''}.`
                      : 'This order is confirmed.'}
              </p>
              {awaitingConfirmation ? (
                <Button
                  size="lg"
                  className="shrink-0"
                  onClick={() => {
                    setReason('')
                    setPending('confirm')
                  }}
                >
                  {isCod ? <CheckCircle2 /> : <ShieldCheck />} Confirm Order
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  className={cn(
                    'shrink-0 disabled:opacity-100',
                    o.order_status === 'cancelled' ? 'border-red-200 bg-red-50 text-brand-red' : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                  )}
                  disabled
                >
                  {o.order_status === 'cancelled' ? (
                    <>
                      <Ban /> Order cancelled
                    </>
                  ) : (
                    <>
                      <CheckCircle2 /> Order confirmed ✓
                    </>
                  )}
                </Button>
              )}
            </div>
          </Panel>

          {/* Actions */}
          {!done && (
            <Panel title="Next step">
              <div className="flex flex-wrap gap-2">
                {isCod && o.order_status === 'processing' && (
                  <>
                    <Button variant="navy" asChild>
                      <a href={`tel:${o.phone}`}>
                        <Phone /> Call {formatPhone(o.phone)}
                      </a>
                    </Button>
                    <Button variant="outline" onClick={() => setCallOpen(true)}>
                      <PhoneCall /> Log Call
                    </Button>
                  </>
                )}
                {next.map((n) => (
                  <Button
                    key={n.action}
                    variant={n.action === 'reject_payment' ? 'outline' : 'default'}
                    className={n.action === 'reject_payment' ? 'text-brand-red' : undefined}
                    onClick={() => {
                      setReason('')
                      setPending(n.action)
                    }}
                  >
                    {n.icon} {n.label}
                  </Button>
                ))}
                <Button variant="ghost" className="text-brand-red hover:bg-red-50" onClick={() => { setReason(''); setPending('cancel') }}>
                  <Ban /> Cancel
                </Button>
              </div>
              {!isCod && o.payment_status === 'rejected' && (
                <p className="mt-3 text-sm text-navy/65">Payment rejected. Waiting for the customer to upload a new proof. Reason: “{o.payment_rejection_reason}”</p>
              )}
            </Panel>
          )}

          {/* Customer */}
          <Panel title="Customer">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-lg font-semibold">{o.customer_name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={`tel:${o.phone}`} className="inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-800">
                    <Phone className="size-4" /> {formatPhone(o.phone)}
                  </a>
                  <Button variant="outline" size="sm" onClick={async () => (await copyText(o.phone)) && toast.success('Phone copied')}>
                    <Copy /> Copy
                  </Button>
                </div>
                <a href={`mailto:${o.email}`} className="flex min-w-0 items-center gap-1.5 text-sm text-navy/75 hover:text-brand-600">
                  <Mail className="size-4 shrink-0" /> <span className="min-w-0 break-all">{o.email}</span>
                </a>
                {social ? (
                  <a href={social} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 break-all text-sm text-navy/75 hover:text-brand-600">
                    <ExternalLink className="size-4 shrink-0" /> {o.social_media}
                  </a>
                ) : (
                  <p className="flex items-center gap-1.5 text-sm text-navy/75">
                    <ExternalLink className="size-4" /> {o.social_media}
                  </p>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <p className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" />
                  <span>
                    {o.address}, Brgy. {o.barangay}, {o.city}
                    {o.landmark && <span className="block text-navy/60">Landmark: {o.landmark}</span>}
                  </span>
                </p>
                <a
                  className="inline-block text-xs font-semibold text-brand-600 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.address}, ${o.barangay}, ${o.city}`)}`}
                >
                  Open in Google Maps
                </a>
              </div>
            </div>
          </Panel>

          {/* Schedule + items */}
          <Panel title="Delivery & items">
            <div className="mb-4 grid gap-3 rounded-xl bg-sand/60 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-navy/55">Delivery date</p>
                <p className="font-semibold">{formatDate(o.delivery_date, 'long')}</p>
              </div>
              <div>
                <p className="text-xs text-navy/55">Time slot</p>
                <p className="font-semibold">{slotLabel(o.delivery_slot)}</p>
              </div>
              {o.customer_notes && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-navy/55">Customer notes</p>
                  <p className="whitespace-pre-wrap">{o.customer_notes}</p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              {[...groups.entries()].map(([store, list]) => (
                <div key={store} className="overflow-hidden rounded-xl ring-1 ring-sand-200/70">
                  <p className="flex items-start justify-between gap-3 border-b border-sand bg-cream px-3 py-2 font-heading text-sm font-bold">
                    <span className="min-w-0 break-words">{store}</span>
                    <span className="shrink-0 tabular-nums">{peso(list.reduce((n, i) => n + Number(i.line_total), 0))}</span>
                  </p>
                  <ul className="divide-y divide-sand text-sm">
                    {list.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {i.quantity}× {i.product_name_snapshot}
                            {i.variant_label_snapshot !== 'Regular' && <span className="font-normal"> · {i.variant_label_snapshot}</span>}
                          </p>
                          <p className="text-xs text-navy/60">
                            {[i.section_name_snapshot, ...i.options_snapshot.map((x) => (x.group === 'Extra Toppings' ? 'Extra toppings' : `${x.group}: ${x.choice}`))]
                              .filter(Boolean)
                              .join(' · ')}{' '}
                            · {peso(i.unit_price_snapshot)} each
                          </p>
                        </div>
                        <span className="shrink-0 font-semibold tabular-nums">{peso(i.line_total)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-1 border-t border-dashed border-navy/15 pt-3 text-sm">
              <div className="flex justify-between"><span>Food subtotal</span><span className="font-semibold tabular-nums">{peso(o.subtotal)}</span></div>
              <div className="flex justify-between"><span>Delivery fee (paid to rider)</span><span className="font-semibold tabular-nums">{peso(o.delivery_fee)}</span></div>
              <div className="flex justify-between font-heading text-lg font-bold"><span>Total</span><span className="tabular-nums">{peso(o.total)}</span></div>
            </div>
            {o.order_status !== 'cancelled' && (
              <form
                className="mt-3 flex items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const n = Number(fee)
                  if (fee === '' || !Number.isFinite(n) || n < 0) return toast.error('Enter a valid delivery fee.')
                  if (await run('set_delivery_fee', undefined, n)) feeTouched.current = false
                }}
              >
                <Field label="Delivery fee (₱)" htmlFor="fee" className="flex-1">
                  <Input id="fee" type="number" inputMode="decimal" min={0} step="0.01" value={fee} onChange={(e) => { feeTouched.current = true; setFee(e.target.value) }} placeholder="0.00" />
                </Field>
                <Button type="submit" variant="navy" loading={busy}>Save fee</Button>
              </form>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          {/* Payment */}
          <Panel title="Payment">
            <div className="flex items-center gap-3">
              <PaymentLogo method={o.payment_method} />
              <p className="font-semibold">{methodLabel}</p>
            </div>
            {!isCod && (
              <div className="mt-2 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2">
                  <span>
                    Ref: <strong className="font-mono">{o.gcash_reference}</strong>
                  </span>
                  {o.gcash_reference && (
                    <button type="button" className="rounded p-1 hover:bg-sky-100" onClick={async () => (await copyText(o.gcash_reference!)) && toast.success('Reference copied')} aria-label="Copy reference">
                      <Copy className="size-4" />
                    </button>
                  )}
                </div>
                <p>Amount expected: <strong>{peso(o.subtotal)}</strong></p>
                {proofUrl ? (
                  <button type="button" onClick={() => setProofOpen(true)} className="block w-full overflow-hidden rounded-xl border border-sand-200">
                    <img src={proofUrl} alt={`${methodLabel} payment proof`} className="max-h-80 w-full object-contain bg-navy-50" />
                    <span className="block py-1.5 text-center text-xs font-semibold text-brand-600">Tap to zoom</span>
                  </button>
                ) : (
                  <p className="text-navy/55">{o.gcash_proof_path ? 'Loading proof…' : 'No proof uploaded.'}</p>
                )}
                {o.payment_rejection_reason && <p className="text-brand-red">Rejected: {o.payment_rejection_reason}</p>}
              </div>
            )}
          </Panel>

          {/* Call log */}
          {isCod && (
            <Panel title="Call log" actions={!done && <Button size="sm" variant="outline" onClick={() => setCallOpen(true)}><PhoneCall /> Log call</Button>}>
              {calls.length === 0 ? (
                <p className="text-sm text-navy/55">No calls logged yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {calls.map((c) => (
                    <li key={c.id} className="rounded-xl bg-cream px-3 py-2">
                      <p className="font-semibold">{CALL_RESULT[c.result]}</p>
                      {c.note && <p className="text-navy/70">{c.note}</p>}
                      <p className="text-xs text-navy/50">{formatDateTime(c.created_at)} · {c.created_by_email ?? 'admin'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {/* Internal notes */}
          <Panel title="Internal admin notes">
            <p className="mb-2 text-xs text-navy/55">Never shown to the customer.</p>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setNotesDirty(true)
              }}
              rows={4}
              placeholder="e.g. Customer asked to call the guard house."
            />
            <Button
              size="sm"
              variant="navy"
              className="mt-2"
              disabled={!notesDirty}
              onClick={async () => {
                const { error } = await supabase.from('orders').update({ admin_notes: notes.trim() || null }).eq('id', o.id)
                if (error) return toast.error(errorMessage(error))
                setNotesDirty(false)
                toast.success('Notes saved')
              }}
            >
              <Save /> Save notes
            </Button>
          </Panel>

          {/* History */}
          <Panel title="Status history">
            <ul className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div>
                    <p className="font-semibold">{historyLabel(h.status, o.payment_method)}</p>
                    {h.note && <p className="text-navy/70">{h.note}</p>}
                    <p className="text-xs text-navy/50">
                      {formatDateTime(h.created_at)} · {h.changed_by_email ?? (h.changed_by ? 'admin' : 'customer / system')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      {/* Action confirmation */}
      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          {spec && (
            <>
              <DialogTitle>{spec.title}</DialogTitle>
              <DialogDescription>{spec.description}</DialogDescription>
              {spec.reason && (
                <Field label={spec.reason} required={pending !== 'decline_cancel_request'} className="mt-4">
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
                </Field>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPending(null)}>Back</Button>
                <Button
                  variant={spec.destructive ? 'destructive' : 'default'}
                  loading={busy}
                  onClick={async () => {
                    if (spec.reason && pending !== 'decline_cancel_request' && reason.trim().length < 3) {
                      toast.error('Please enter a reason.')
                      return
                    }
                    if (await run(pending!, reason)) setPending(null)
                  }}
                >
                  {spec.confirm}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <CallLogDialog open={callOpen} onOpenChange={setCallOpen} orderId={o.id} onSaved={load} />
      <Lightbox open={proofOpen} onOpenChange={setProofOpen} src={proofUrl} title={`${methodLabel} proof · ${o.order_number}`} />
    </div>
  )
}

function CallLogDialog({ open, onOpenChange, orderId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; orderId: string; onSaved: () => Promise<void> }) {
  const [result, setResult] = useState<CallLogRow['result']>('answered')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Log a call</DialogTitle>
        <DialogDescription>Record the result of your confirmation call.</DialogDescription>
        <RadioGroup value={result} onValueChange={(v) => setResult(v as CallLogRow['result'])} className="mt-4 grid gap-2">
          {(Object.keys(CALL_RESULT) as CallLogRow['result'][]).map((r) => (
            <RadioCard key={r} value={r}>
              <span className="font-semibold">{CALL_RESULT[r]}</span>
            </RadioCard>
          ))}
        </RadioGroup>
        <Field label="Note" optional className="mt-3">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed. Customer asked for 11 AM sharp." />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button
            variant="navy"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              const { error } = await supabase.from('call_logs').insert({ order_id: orderId, result, note: note.trim() || null })
              setBusy(false)
              if (error) return toast.error(errorMessage(error))
              toast.success('Call logged')
              setNote('')
              onOpenChange(false)
              await onSaved()
            }}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
