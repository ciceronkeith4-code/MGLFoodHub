import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, BadgeCheck, Bike, Check, ChefHat, Clock, ImagePlus, Link2, PackageCheck, PackageSearch, Phone, Radio, XCircle, type LucideIcon } from 'lucide-react'
import { useTrackedOrder } from '@/hooks/useTrackedOrder'
import { useCart } from '@/store/cart'
import { supabase, errorMessage } from '@/lib/supabase'
import { saveMyOrder } from '@/lib/myOrders'
import { extOf, prepareImage } from '@/lib/image'
import { customerStatus, historyLabel, isOnline, PAYMENT_METHOD_LABEL, progressSteps, type Tone } from '@/lib/orderStatus'
import { PaymentLogo } from '@/components/PaymentLogo'
import type { PublicOrder } from '@/lib/types'
import { cn, formatDate, formatDateTime, peso, randomId, slotLabel, trackingUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/controls'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorBanner } from '@/components/common'
import { OrderItemsList, TrackingLinkActions } from '@/components/OrderBits'

const toneIcon: Record<Tone, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  info: 'bg-sand text-brand-600',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-brand-red',
  neutral: 'bg-sand text-navy',
}

function statusIcon(o: PublicOrder): LucideIcon {
  if (o.order_status === 'cancelled') return XCircle
  if (o.payment_status === 'rejected') return AlertTriangle
  switch (o.order_status) {
    case 'processing':
      return o.payment_method === 'cod' ? Phone : Clock
    case 'confirmed':
      return BadgeCheck
    case 'preparing':
      return ChefHat
    case 'out_for_delivery':
      return Bike
    default:
      return PackageCheck
  }
}

export default function Track() {
  const { token = '' } = useParams()
  const { order, loading, error, notFound, reload } = useTrackedOrder(token)
  const [linkOpen, setLinkOpen] = useState(false)

  useEffect(() => {
    if (order) {
      saveMyOrder({ order_number: order.order_number, token, created_at: order.created_at, delivery_date: order.delivery_date })
      document.title = `${order.order_number} · Track order · MGL Food Hub`
    }
  }, [order, token])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (notFound || !order) {
    return (
      <EmptyState
        icon={<PackageSearch />}
        title={error ? 'Could not load your order' : 'Order not found'}
        action={
          <div className="flex gap-2">
            {error && <Button onClick={() => void reload()}>Try again</Button>}
            <Button variant="outline" asChild>
              <Link to="/find-order">Find my order</Link>
            </Button>
          </div>
        }
      >
        {error ?? 'Please check that you copied the complete tracking link.'}
      </EmptyState>
    )
  }

  const status = customerStatus(order)
  const steps = progressSteps(order)
  const canRequestCancel = order.order_status === 'processing' && !order.cancel_requested
  const needsProof = isOnline(order.payment_method) && order.payment_status === 'rejected' && order.order_status === 'processing'

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">Track Your Order</h1>
          <p className="mt-1 font-mono text-base font-semibold text-navy/80">{order.order_number}</p>
          <p className="text-sm text-navy/55">Placed {formatDateTime(order.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <Radio className="size-3.5 animate-pulse" /> Live
          </span>
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 /> Save link
          </Button>
        </div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* Current status */}
      <div className="flex gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70 animate-fade-up sm:p-5" key={status.title}>
        {(() => {
          const Icon = statusIcon(order)
          return (
            <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-full', toneIcon[status.tone])}>
              <Icon className="size-6" strokeWidth={1.8} />
            </span>
          )
        })()}
        <div className="min-w-0 flex-1">
        <p className="font-heading text-lg font-bold">{status.title}</p>
        <p className="mt-0.5 text-sm text-navy/70">{status.message}</p>
        {order.payment_method === 'cod' && order.order_status === 'processing' && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-navy/65">
            <Phone className="size-4" /> Please keep your phone nearby.
          </p>
        )}
        {order.cancel_requested && order.order_status !== 'cancelled' && (
          <p className="mt-3 rounded-xl bg-sand/60 px-3 py-2 text-sm">
            🕐 Your cancellation request was sent. Our team will review it and update this page.
          </p>
        )}
        </div>
      </div>

      {needsProof && <ResubmitProof token={token} label={PAYMENT_METHOD_LABEL[order.payment_method]} onDone={reload} />}

      {/* Progress */}
      {order.order_status !== 'cancelled' && (
        <ol className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-sand-200/70 sm:p-6">
          {steps.map((s, i) => (
            <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0">
              {i < steps.length - 1 && (
                <span className={cn('absolute left-[15px] top-8 h-[calc(100%-24px)] w-0.5', steps[i + 1].done ? 'bg-brand' : 'bg-navy/10')} />
              )}
              <span
                className={cn(
                  'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                  s.done ? 'border-brand bg-brand text-navy' : 'border-navy/15 bg-white text-navy/40',
                  s.current && s.key !== 'delivered' && 'bg-white text-brand-600 ring-4 ring-brand/25',
                )}
              >
                {s.done && (!s.current || s.key === 'delivered') ? <Check className="size-4" strokeWidth={3} /> : s.current ? <span className="size-2.5 rounded-full bg-brand" /> : i + 1}
              </span>
              <div className="pt-1">
                <p className={cn('text-sm font-semibold', !s.done && 'text-navy/45')}>{s.label}</p>
                {s.at && s.done && <p className="text-xs text-navy/55">{formatDateTime(s.at)}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Details */}
      <div className="space-y-4 rounded-2xl bg-white ring-1 ring-sand-200/70 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-navy/55">Delivery date & time</p>
            <p className="font-semibold">{formatDate(order.delivery_date)}</p>
            <p className="text-navy/70">{slotLabel(order.delivery_slot)}</p>
          </div>
          <div>
            <p className="text-xs text-navy/55">Payment method</p>
            <div className="mt-1 flex items-center gap-2">
              <PaymentLogo method={order.payment_method} className="h-8 w-12 rounded-lg" />
              <p className="min-w-0 font-semibold">{PAYMENT_METHOD_LABEL[order.payment_method]}</p>
            </div>
            {order.gcash_reference && <p className="mt-1 break-all text-navy/70">Ref: {order.gcash_reference}</p>}
          </div>
          <div className="col-span-2">
            <p className="text-xs text-navy/55">Deliver to</p>
            <p className="font-semibold">{order.customer_name}</p>
            <p className="text-navy/70">
              {order.address}, {order.barangay}, {order.city}
              {order.landmark ? ` (${order.landmark})` : ''}
            </p>
          </div>
        </div>
        <OrderItemsList items={order.items} />
        <Totals order={order} />
      </div>

      {/* History */}
      <div className="rounded-2xl bg-white ring-1 ring-sand-200/70 p-4 sm:p-5">
        <h2 className="mb-3 font-heading font-bold">Order history</h2>
        <ul className="space-y-3">
          {[...order.history].reverse().map((h, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', i === 0 ? 'bg-brand' : 'bg-navy/20')} />
              <div>
                <p className="font-semibold">{historyLabel(h.status, order.payment_method)}</p>
                {h.note && <p className="text-navy/70">{h.note}</p>}
                <p className="text-xs text-navy/50">{formatDateTime(h.created_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {canRequestCancel && <CancelRequest token={token} onDone={reload} />}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogTitle>Save your tracking link</DialogTitle>
          <DialogDescription>This private link is the only way to check this order.</DialogDescription>
          <div className="mt-4">
            <TrackingLinkActions url={trackingUrl(token)} orderNumber={order.order_number} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Totals({ order }: { order: PublicOrder }) {
  const fee = Number(order.delivery_fee)
  return (
    <div className="space-y-1.5 border-t border-dashed border-navy/15 pt-3 text-sm">
      <div className="flex justify-between">
        <span className="text-navy/70">Food subtotal</span>
        <span className="font-semibold tabular-nums">{peso(order.subtotal)}</span>
      </div>
      {fee > 0 ? (
        <div className="flex justify-between">
          <span className="text-navy/70">Delivery fee (to be paid to the rider)</span>
          <span className="font-semibold tabular-nums">{peso(fee)}</span>
        </div>
      ) : (
        <div className="flex justify-between">
          <span className="text-navy/70">Delivery fee</span>
          <span className="text-navy/55">To be confirmed</span>
        </div>
      )}
      <div className="flex justify-between pt-1 font-heading text-lg font-bold">
        <span>Total</span>
        <span className="tabular-nums">{peso(order.total)}</span>
      </div>
      {isOnline(order.payment_method) && order.payment_status === 'paid' && (
        <p className="text-xs text-emerald-700">✓ Food subtotal paid via {PAYMENT_METHOD_LABEL[order.payment_method]}{fee > 0 ? '. Please pay the delivery fee to the rider.' : '.'}</p>
      )}
    </div>
  )
}

function CancelRequest({ token, onDone }: { token: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (reason.trim().length < 3) {
      toast.error('Please tell us why you want to cancel.')
      return
    }
    setBusy(true)
    const { error } = await supabase.rpc('request_cancellation', { p_token: token, p_reason: reason.trim() })
    setBusy(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Cancellation request sent.')
    setOpen(false)
    await onDone()
  }
  return (
    <>
      <div className="text-center">
        <Button variant="ghost" className="text-brand-red hover:bg-red-50" onClick={() => setOpen(true)}>
          <XCircle /> Request Cancellation
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Request cancellation</DialogTitle>
          <DialogDescription>Our team will review your request. Your order is only cancelled once we confirm it here.</DialogDescription>
          <Field label="Reason" required className="mt-4">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Wrong delivery date" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep my order
            </Button>
            <Button variant="destructive" loading={busy} onClick={() => void submit()}>
              Send request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResubmitProof({ token, label, onDone }: { token: string; label: string; onDone: () => Promise<void> }) {
  const deviceId = useCart((s) => s.deviceId)
  const [ref, setRef] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!/^[A-Za-z0-9 -]{4,40}$/.test(ref.trim())) return toast.error(`Please enter the ${label} reference number.`)
    if (!file) return toast.error(`Please upload a screenshot of your ${label} payment.`)
    setBusy(true)
    try {
      const img = await prepareImage(file)
      const path = `proofs/${deviceId.replace(/[^A-Za-z0-9_-]/g, '')}/${Date.now()}-${randomId().slice(0, 8)}.${extOf(img)}`
      const up = await supabase.storage.from('payment-proofs').upload(path, img, { contentType: img.type, upsert: false })
      if (up.error) throw new Error('Could not upload your screenshot. Please try again.')
      const { error } = await supabase.rpc('resubmit_gcash_proof', { p_token: token, p_ref: ref.trim(), p_path: path })
      if (error) throw error
      toast.success('New payment proof sent! We will verify it shortly.')
      await onDone()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-white ring-1 ring-sand-200/70 p-4 sm:p-5">
      <h2 className="font-heading font-bold">Upload a new {label} payment proof</h2>
      <Field label={`${label} Reference No.`} required>
        <Input value={ref} onChange={(e) => setRef(e.target.value)} inputMode="numeric" placeholder="e.g. 1234 567 890123" />
      </Field>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-navy/15 p-3 hover:border-brand">
        <span className="flex size-12 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <ImagePlus className="size-5" />
        </span>
        <span className="text-sm">
          <span className="block font-semibold">{file ? file.name : 'Upload new screenshot'}</span>
          <span className="block text-xs text-navy/55">JPG or PNG</span>
        </span>
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <Button className="w-full" loading={busy} onClick={() => void submit()}>
        Send new proof
      </Button>
    </div>
  )
}
