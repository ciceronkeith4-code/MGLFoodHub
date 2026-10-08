import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DayPicker } from 'react-day-picker'
import { toast } from 'sonner'
import {
  AlertTriangle, Banknote, Check, CalendarDays, Clock, Copy, ImagePlus, Loader2, Lock, MapPin, ShoppingBag, Smartphone, User, Wallet,
} from 'lucide-react'
import { useCatalog, useCartView } from '@/hooks/useCatalog'
import { useCart } from '@/store/cart'
import { supabase, errorMessage } from '@/lib/supabase'
import type { CheckoutInfo } from '@/lib/types'
import { computeSlots } from '@/lib/slots'
import { saveMyOrder } from '@/lib/myOrders'
import { extOf, prepareImage } from '@/lib/image'
import {
  cn, copyText, dateFromYmd, formatDate, formatTime, isValidEmail, normalizePhone, peso, randomId, storage, ymdFromDate,
} from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/label'
import { Input, Textarea } from '@/components/ui/input'
import { Checkbox, Chip, RadioCard, RadioGroup, Skeleton } from '@/components/ui/controls'
import { Disclaimer, EmptyState, ErrorBanner } from '@/components/common'
import { CartTotals, FEE_NOTE } from '@/components/Cart'

interface FormState {
  customer_name: string
  phone: string
  email: string
  social_media: string
  address: string
  barangay: string
  city: string
  landmark: string
  payment_method: '' | 'cod' | 'gcash'
  delivery_date: string
  delivery_slot: string
  customer_notes: string
  gcash_reference: string
  agree: boolean
  website: string // honeypot
}

const DETAILS_KEY = 'mgl_checkout_details_v1'
type SavedDetails = Pick<FormState, 'customer_name' | 'phone' | 'email' | 'social_media' | 'address' | 'barangay' | 'city' | 'landmark'>

const initialForm = (): FormState => ({
  customer_name: '',
  phone: '',
  email: '',
  social_media: '',
  address: '',
  barangay: '',
  city: '',
  landmark: '',
  payment_method: '',
  delivery_date: '',
  delivery_slot: '',
  customer_notes: '',
  gcash_reference: '',
  agree: false,
  website: '',
  ...storage.get<Partial<SavedDetails>>(DETAILS_KEY, {}),
})

type Errors = Partial<Record<keyof FormState | 'proof', string>>

export default function Checkout() {
  const cat = useCatalog()
  const view = useCartView()
  const deviceId = useCart((s) => s.deviceId)
  const items = useCart((s) => s.items)
  const clearCart = useCart((s) => s.clear)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>(initialForm)
  const [errors, setErrors] = useState<Errors>({})
  const [info, setInfo] = useState<CheckoutInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [proof, setProof] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const uploaded = useRef<{ file: File; path: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const submitting = useRef(false)
  const placed = useRef(false)

  const loadInfo = async () => {
    setInfoError(null)
    const { data, error } = await supabase.rpc('get_checkout_info')
    if (error) setInfoError(errorMessage(error))
    else setInfo(data as CheckoutInfo)
  }
  useEffect(() => {
    void loadInfo()
  }, [])

  useEffect(() => {
    if (!proof) {
      setProofPreview(null)
      return
    }
    const url = URL.createObjectURL(proof)
    setProofPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [proof])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  // Stores in the cart → overlapping 1-hour slots
  const cartStores = useMemo(() => {
    const ids = [...new Set(items.map((i) => i.storeId))]
    return ids.map((id) => cat.storeById.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s))
  }, [items, cat.storeById])
  const slotInfo = useMemo(() => computeSlots(cartStores), [cartStores])

  useEffect(() => {
    if (form.delivery_slot && !slotInfo.slots.some((s) => s.value === form.delivery_slot)) set('delivery_slot', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotInfo])

  const blocked = useMemo(() => new Set(info?.blocked_dates ?? []), [info])
  useEffect(() => {
    if (!info || !form.delivery_date) return
    if (form.delivery_date < info.min_date || form.delivery_date > info.max_date || blocked.has(form.delivery_date)) set('delivery_date', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, blocked])

  function validate(): Errors {
    const e: Errors = {}
    if (form.customer_name.trim().length < 2) e.customer_name = 'Please enter your full name.'
    if (form.address.trim().length < 4) e.address = 'Please enter your house/unit no. and street.'
    if (form.barangay.trim().length < 2) e.barangay = 'Please enter your barangay.'
    if (form.city.trim().length < 2) e.city = 'Please enter your city.'
    if (!normalizePhone(form.phone)) e.phone = 'Use 09XXXXXXXXX or +639XXXXXXXXX.'
    if (!isValidEmail(form.email)) e.email = 'Please enter a valid email address.'
    if (form.social_media.trim().length < 2) e.social_media = 'Please enter your Facebook/Instagram link or username.'
    if (!form.payment_method) e.payment_method = 'Please choose a payment method.'
    if (!form.delivery_date) e.delivery_date = 'Please choose a delivery date.'
    if (!form.delivery_slot) e.delivery_slot = 'Please choose a delivery time slot.'
    if (form.payment_method === 'gcash') {
      if (!/^[A-Za-z0-9 -]{4,40}$/.test(form.gcash_reference.trim())) e.gcash_reference = 'Please enter the GCash reference number.'
      if (!proof) e.proof = 'Please upload a screenshot of your GCash payment.'
    }
    if (!form.agree) e.agree = 'Please tick this box to continue.'
    return e
  }

  async function placeOrder() {
    if (submitting.current) return
    setSubmitError(null)
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      toast.error('Please complete the highlighted fields.')
      requestAnimationFrame(() =>
        document.querySelector('[data-field-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      )
      return
    }
    if (view.hasIssues || slotInfo.conflict) return

    submitting.current = true
    setBusy(true)
    try {
      let proofPath: string | null = null
      if (form.payment_method === 'gcash' && proof) {
        if (uploaded.current?.file === proof) {
          proofPath = uploaded.current.path
        } else {
          const file = await prepareImage(proof)
          const path = `proofs/${deviceId.replace(/[^A-Za-z0-9_-]/g, '')}/${Date.now()}-${randomId().slice(0, 8)}.${extOf(file)}`
          const { error } = await supabase.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false })
          if (error) throw new Error('Could not upload your GCash screenshot. Please try again.')
          uploaded.current = { file: proof, path }
          proofPath = path
        }
      }

      const payload = {
        device_id: deviceId,
        customer_name: form.customer_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        social_media: form.social_media.trim(),
        address: form.address.trim(),
        barangay: form.barangay.trim(),
        city: form.city.trim(),
        landmark: form.landmark.trim(),
        delivery_date: form.delivery_date,
        delivery_slot: form.delivery_slot,
        payment_method: form.payment_method,
        gcash_reference: form.payment_method === 'gcash' ? form.gcash_reference.trim() : null,
        gcash_proof_path: proofPath,
        customer_notes: form.customer_notes.trim(),
        agree_terms: form.agree,
        website: form.website,
        // Only ids + quantities are sent. The server looks up every price itself.
        items: items.map((i) => ({
          variant_id: i.variantId,
          quantity: i.quantity,
          choice_ids: i.choices.map((c) => c.choiceId),
          extra_toppings: i.extraToppings,
        })),
      }

      const { data, error } = await supabase.rpc('place_order', { payload })
      if (error) throw error
      const result = data as { order_number: string; tracking_token: string }

      saveMyOrder({
        order_number: result.order_number,
        token: result.tracking_token,
        created_at: new Date().toISOString(),
        delivery_date: form.delivery_date,
      })
      const details: SavedDetails = {
        customer_name: payload.customer_name,
        phone: payload.phone,
        email: payload.email,
        social_media: payload.social_media,
        address: payload.address,
        barangay: payload.barangay,
        city: payload.city,
        landmark: payload.landmark,
      }
      storage.set(DETAILS_KEY, details)
      if (info?.email_notifications_enabled) {
        void supabase.functions.invoke('send-order-email', { body: { token: result.tracking_token } }).catch(() => {})
      }
      placed.current = true
      navigate(`/order-placed/${result.tracking_token}`, { replace: true })
      clearCart() // only after the order is safely placed
    } catch (err) {
      const msg = errorMessage(err)
      setSubmitError(msg)
      toast.error(msg)
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  if (items.length === 0 && !placed.current) {
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title="Your cart is empty"
        action={
          <Button asChild>
            <Link to="/">Browse stores</Link>
          </Button>
        }
      >
        Add some food first, then come back to schedule your delivery.
      </EmptyState>
    )
  }

  const total = view.subtotalCents / 100
  const blockedCheckout = view.hasIssues || !!slotInfo.conflict
  const stepsDone: [boolean, boolean, boolean] = [
    form.customer_name.trim().length >= 2 && !!normalizePhone(form.phone) && isValidEmail(form.email) && form.social_media.trim().length >= 2 &&
      form.address.trim().length >= 4 && form.barangay.trim().length >= 2 && form.city.trim().length >= 2,
    !!form.delivery_date && !!form.delivery_slot,
    form.payment_method === 'cod' || (form.payment_method === 'gcash' && form.gcash_reference.trim().length >= 4 && !!proof),
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-bold sm:text-4xl">Checkout</h1>
      <p className="mt-1.5 text-sm text-navy/60">Scheduled delivery only — earliest is tomorrow. No account needed.</p>
      <CheckoutSteps done={stepsDone} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <form
          className="space-y-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void placeOrder()
          }}
        >
          {/* Honeypot — hidden from people, irresistible to bots */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set('website', e.target.value)} name="website" />
            </label>
          </div>

          <Section step={1} icon={<User />} title="Your details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full Name" htmlFor="name" required error={errors.customer_name} className="sm:col-span-2">
                <Input id="name" autoComplete="name" value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} aria-invalid={!!errors.customer_name} placeholder="Juan Dela Cruz" />
              </Field>
              <Field label="Phone Number" htmlFor="phone" required error={errors.phone} hint="We'll call this number to confirm COD orders.">
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} placeholder="09XXXXXXXXX" />
              </Field>
              <Field label="Gmail / Email" htmlFor="email" required error={errors.email}>
                <Input id="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} placeholder="you@gmail.com" />
              </Field>
              <Field label="Social Media Account" htmlFor="social" required error={errors.social_media} hint="Facebook or Instagram profile link or username" className="sm:col-span-2">
                <Input id="social" value={form.social_media} onChange={(e) => set('social_media', e.target.value)} aria-invalid={!!errors.social_media} placeholder="facebook.com/yourname or @yourname" />
              </Field>
            </div>
          </Section>

          <Section step={2} icon={<MapPin />} title="Delivery location">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Complete address (house/unit no., street)" htmlFor="address" required error={errors.address} className="sm:col-span-2">
                <Input id="address" autoComplete="street-address" value={form.address} onChange={(e) => set('address', e.target.value)} aria-invalid={!!errors.address} placeholder="Blk 1 Lot 2, Rizal St." />
              </Field>
              <Field label="Barangay" htmlFor="barangay" required error={errors.barangay}>
                <Input id="barangay" value={form.barangay} onChange={(e) => set('barangay', e.target.value)} aria-invalid={!!errors.barangay} placeholder="Niugan" />
              </Field>
              <Field label="City" htmlFor="city" required error={errors.city}>
                <Input id="city" autoComplete="address-level2" value={form.city} onChange={(e) => set('city', e.target.value)} aria-invalid={!!errors.city} placeholder="Malabon City" />
              </Field>
              <Field label="Landmark" htmlFor="landmark" optional className="sm:col-span-2">
                <Input id="landmark" value={form.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder="Near the chapel, green gate" />
              </Field>
            </div>
          </Section>

          <Section step={3} icon={<CalendarDays />} title="Delivery schedule">
            {infoError ? (
              <ErrorBanner>
                {infoError}{' '}
                <button type="button" className="font-semibold underline" onClick={() => void loadInfo()}>
                  Try again
                </button>
              </ErrorBanner>
            ) : !info ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <div className="grid grid-cols-1 gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                <Field label="Delivery Date" required error={errors.delivery_date}>
                  <div className="rounded-2xl border border-sand-200 bg-white p-2">
                    <DayPicker
                      mode="single"
                      selected={form.delivery_date ? dateFromYmd(form.delivery_date) : undefined}
                      onSelect={(d) => set('delivery_date', d ? ymdFromDate(d) : '')}
                      defaultMonth={dateFromYmd(info.min_date)}
                      startMonth={dateFromYmd(info.min_date)}
                      endMonth={dateFromYmd(info.max_date)}
                      disabled={[
                        { before: dateFromYmd(info.min_date) },
                        { after: dateFromYmd(info.max_date) },
                        ...info.blocked_dates.map(dateFromYmd),
                      ]}
                    />
                  </div>
                  <p className="text-xs text-navy/55">
                    Same-day delivery isn't available. Orders for tomorrow close at {formatTime(info.cutoff_time)} (PH time).
                  </p>
                </Field>
                <Field label="Preferred Delivery Time" required error={errors.delivery_slot}>
                  {slotInfo.conflict ? (
                    <ErrorBanner>{slotInfo.conflict}</ErrorBanner>
                  ) : (
                    <>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                        {slotInfo.slots.map((s) => (
                          <Chip key={s.value} selected={form.delivery_slot === s.value} onClick={() => set('delivery_slot', s.value)} className="rounded-xl text-xs leading-tight">
                            <Clock className="size-3.5" /> {s.label}
                          </Chip>
                        ))}
                      </div>
                      {cartStores.length > 1 && slotInfo.window && (
                        <p className="text-xs text-navy/55">
                          Slots shown are when all {cartStores.length} stores in your cart are open ({formatTime(slotInfo.window.open)} – {formatTime(slotInfo.window.close)}).
                        </p>
                      )}
                    </>
                  )}
                  {form.delivery_date && (
                    <p className="rounded-xl bg-sand/60 px-3 py-2 text-sm">
                      📦 Delivery on <strong>{formatDate(form.delivery_date, 'long')}</strong>
                      {form.delivery_slot && <>, {slotInfo.slots.find((s) => s.value === form.delivery_slot)?.label}</>}
                    </p>
                  )}
                </Field>
              </div>
            )}
          </Section>

          <Section step={4} icon={<Wallet />} title="Payment method">
            <RadioGroup value={form.payment_method} onValueChange={(v) => set('payment_method', v as FormState['payment_method'])} className="grid gap-3 sm:grid-cols-2" aria-label="Payment method">
              <RadioCard value="cod">
                <Banknote className="size-6 text-emerald-600" />
                <span>
                  <span className="block font-semibold">Cash on Delivery</span>
                  <span className="block text-xs text-navy/60">We'll call you to confirm</span>
                </span>
              </RadioCard>
              <RadioCard value="gcash">
                <Smartphone className="size-6 text-sky-600" />
                <span>
                  <span className="block font-semibold">GCash</span>
                  <span className="block text-xs text-navy/60">Pay now, upload proof</span>
                </span>
              </RadioCard>
            </RadioGroup>
            {errors.payment_method && <p className="mt-2 text-xs font-medium text-brand-red" data-field-error="true">{errors.payment_method}</p>}

            {form.payment_method === 'gcash' && info && (
              <div className="mt-4 space-y-4 rounded-2xl border-2 border-sky-200 bg-sky-50/60 p-4 animate-fade-up">
                <div className="flex flex-col gap-4 sm:flex-row">
                  {info.gcash_qr_url ? (
                    <img src={info.gcash_qr_url} alt="GCash QR code" className="mx-auto size-44 shrink-0 rounded-xl border border-sky-200 bg-white object-contain p-1 sm:mx-0" />
                  ) : null}
                  <div className="flex-1 space-y-2 text-sm">
                    <p className="font-heading font-bold">Send your payment via GCash</p>
                    <dl className="space-y-1">
                      <div className="flex justify-between gap-2"><dt className="text-navy/60">Account name</dt><dd className="font-semibold">{info.gcash_account_name || '—'}</dd></div>
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-navy/60">GCash number</dt>
                        <dd className="flex items-center gap-1 font-semibold tabular-nums">
                          {info.gcash_number || '—'}
                          {info.gcash_number && (
                            <button type="button" className="rounded p-1 hover:bg-sky-100" aria-label="Copy GCash number" onClick={async () => (await copyText(info.gcash_number)) && toast.success('GCash number copied')}>
                              <Copy className="size-3.5" />
                            </button>
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2 border-t border-sky-200 pt-1.5"><dt className="font-semibold">Amount to pay</dt><dd className="font-heading text-lg font-extrabold tabular-nums">{peso(total)}</dd></div>
                    </dl>
                    <p className="text-xs text-navy/60">Food subtotal only. The delivery fee is paid to the rider.</p>
                  </div>
                </div>
                <Field label="GCash Reference No." htmlFor="ref" required error={errors.gcash_reference}>
                  <Input id="ref" inputMode="numeric" value={form.gcash_reference} onChange={(e) => set('gcash_reference', e.target.value)} aria-invalid={!!errors.gcash_reference} placeholder="e.g. 1234 567 890123" />
                </Field>
                <Field label="Payment screenshot" required error={errors.proof}>
                  <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed bg-white p-3 transition hover:border-brand', errors.proof ? 'border-brand-red' : 'border-navy/15')}>
                    {proofPreview ? (
                      <img src={proofPreview} alt="Payment screenshot preview" className="size-16 rounded-lg object-cover" />
                    ) : (
                      <span className="flex size-16 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><ImagePlus className="size-6" /></span>
                    )}
                    <span className="text-sm">
                      <span className="block font-semibold">{proof ? 'Change screenshot' : 'Upload screenshot'}</span>
                      <span className="block text-xs text-navy/55">{proof ? proof.name : 'JPG or PNG, up to 8 MB'}</span>
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null
                        if (f && f.size > 15 * 1024 * 1024) {
                          toast.error('That image is too large. Please choose a smaller screenshot.')
                          return
                        }
                        setProof(f)
                        setErrors((x) => ({ ...x, proof: undefined }))
                      }}
                    />
                  </label>
                </Field>
              </div>
            )}
          </Section>

          <Section step={5} icon={<ShoppingBag />} title="Notes for the store/rider" optional>
            <Textarea value={form.customer_notes} onChange={(e) => set('customer_notes', e.target.value)} maxLength={1000} placeholder="e.g. Please call when you're near. Less sauce on the pancit." />
          </Section>

          {/* Mobile order summary (desktop shows it in the sidebar) */}
          <div className="lg:hidden">
            <OrderSummary />
          </div>

          <Disclaimer />

          <div className="space-y-4 rounded-2xl bg-white ring-1 ring-sand-200/70 p-4 sm:p-5" data-field-error={errors.agree ? 'true' : undefined}>
            <label className="flex cursor-pointer gap-3 text-sm">
              <Checkbox checked={form.agree} onCheckedChange={(v) => set('agree', v === true)} aria-invalid={!!errors.agree} className="mt-0.5" />
              <span>
                I understand that delivery fees may be higher for long-distance deliveries and that the quality of some food items may not be the same as in-store.
                <span className="text-brand-red"> *</span>
              </span>
            </label>
            {errors.agree && <p className="text-xs font-medium text-brand-red">{errors.agree}</p>}

            {submitError && <ErrorBanner>{submitError}</ErrorBanner>}
            {view.hasIssues && (
              <ErrorBanner>
                Some items in your cart are sold out or unavailable. <Link to="/cart" className="font-semibold underline">Review your cart</Link>
              </ErrorBanner>
            )}

            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={blockedCheckout || busy}>
              {busy ? 'Placing your order…' : <><Lock /> Place Order · {peso(total)}</>}
            </Button>
            <p className="text-center text-xs text-navy/55">{info?.delivery_fee_note || FEE_NOTE}</p>
          </div>
        </form>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <OrderSummary />
          </div>
        </aside>
      </div>

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-cream/70 backdrop-blur-sm" aria-live="polite">
          <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 font-semibold shadow-xl">
            <Loader2 className="size-5 animate-spin text-brand" /> Placing your order…
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ step, icon, title, optional, children }: { step: number; icon: ReactNode; title: string; optional?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70 sm:p-6">
      <h2 className="mb-5 flex items-center gap-3 font-heading text-base font-semibold">
        <span className="flex size-9 items-center justify-center rounded-full bg-sand text-brand-600 [&_svg]:size-4">{icon}</span>
        <span>
          <span className="mr-1 text-navy/35">{step}.</span>
          {title}
        </span>
        {optional && <span className="text-xs font-normal text-navy/50">(optional)</span>}
      </h2>
      {children}
    </section>
  )
}

/** Reference-style progress steps (Details → Schedule → Payment), filled as the form is completed. */
function CheckoutSteps({ done }: { done: [boolean, boolean, boolean] }) {
  const labels = ['Details', 'Schedule', 'Payment']
  const current = done.findIndex((d) => !d)
  return (
    <ol className="mt-6 flex items-center gap-2 sm:gap-3" aria-label="Checkout progress">
      {labels.map((label, i) => {
        const complete = done[i]
        const active = i === current
        return (
          <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3 last:flex-none">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors',
                  complete ? 'border-brand bg-brand text-navy' : active ? 'border-brand bg-white text-navy' : 'border-navy/15 bg-white text-navy/45',
                )}
              >
                {complete ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('text-xs font-medium sm:text-sm', complete || active ? 'text-navy' : 'text-navy/45', !active && 'max-[379px]:hidden')}>{label}</span>
            </span>
            {i < labels.length - 1 && <span className={cn('h-px flex-1', complete ? 'bg-brand' : 'bg-navy/15')} />}
          </li>
        )
      })}
    </ol>
  )
}

function OrderSummary() {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 font-heading text-base font-bold">
        <ShoppingBag className="size-5 text-brand-600" /> Order summary
      </h2>
      <ReadOnlySummary />
      <CartTotals />
    </section>
  )
}

/** Read-only list of what the customer chose (edit in the cart). */
function ReadOnlySummary() {
  const view = useCartView()
  return (
    <div className="space-y-3">
      {view.byStore.map((g) => (
        <div key={g.storeId} className="overflow-hidden rounded-2xl bg-white ring-1 ring-sand-200/70">
          <p className="border-b border-sand bg-sand/60 px-4 py-2 font-heading text-sm font-bold">{g.storeName}</p>
          <ul className="divide-y divide-sand text-sm">
            {g.lines.map(({ line, unitPrice, issue }) => (
              <li key={line.key} className="flex justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className={cn('font-medium', issue && 'line-through opacity-60')}>
                    {line.quantity}× {line.productName}
                  </p>
                  <p className="text-xs text-navy/55">
                    {[line.variantLabel !== 'Regular' ? line.variantLabel : null, ...line.choices.map((c) => `${c.groupName}: ${c.label}`), line.extraToppings ? 'Extra toppings' : null]
                      .filter(Boolean)
                      .join(' · ') || `${peso(unitPrice)} each`}
                  </p>
                  {issue && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-brand-red">
                      <AlertTriangle className="size-3" /> {issue}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">{peso(unitPrice * line.quantity)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Link to="/cart" className="inline-block text-sm font-semibold text-brand-600 hover:underline">
        Edit cart
      </Link>
    </div>
  )
}
