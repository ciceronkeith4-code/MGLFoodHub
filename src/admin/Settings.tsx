import { useEffect, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { toast } from 'sonner'
import { ImagePlus, Save, X } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { extOf, prepareImage } from '@/lib/image'
import { dateFromYmd, formatDate, manilaNow, ymdFromDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { Skeleton, Switch } from '@/components/ui/controls'
import { ErrorBanner } from '@/components/common'
import { AdminPageHeader, Panel } from './ui'
import { DEFAULT_GUIDELINES } from '@/components/OrderingGuidelines'
import { PaymentLogo } from '@/components/PaymentLogo'
import { ONLINE_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import type { OnlineMethod } from '@/lib/types'

/** Settings keys for each online payment account, e.g. maribank_number. */
type AccountKey = `${OnlineMethod}_${'account_name' | 'number' | 'qr_url'}`

const EMPTY_ACCOUNTS = Object.fromEntries(
  ONLINE_METHODS.flatMap((m) => [[`${m}_account_name`, ''], [`${m}_number`, ''], [`${m}_qr_url`, '']]),
) as Record<AccountKey, string>

interface SettingsForm extends Record<AccountKey, string> {
  cutoff_time: string
  max_days_ahead: number
  blocked_dates: string[]
  delivery_fee_note: string
  email_notifications_enabled: boolean
  max_orders_per_phone_per_day: number
  ordering_guidelines: string[]
}

const DEFAULTS: SettingsForm = {
  ...EMPTY_ACCOUNTS,
  cutoff_time: '20:00',
  max_days_ahead: 30,
  blocked_dates: [],
  delivery_fee_note: '',
  email_notifications_enabled: false,
  max_orders_per_phone_per_day: 5,
  ordering_guidelines: DEFAULT_GUIDELINES,
}

export default function Settings() {
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<OnlineMethod | null>(null)
  const today = manilaNow().date

  useEffect(() => {
    void supabase
      .from('settings')
      .select('key, value')
      .then(({ data, error }) => {
        if (error) return setError(errorMessage(error))
        const values = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]))
        setForm({ ...DEFAULTS, ...values } as SettingsForm)
      })
  }, [])

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  async function save() {
    if (!form) return
    if (!/^\d{2}:\d{2}$/.test(form.cutoff_time)) return toast.error('Enter a valid cutoff time.')
    if (!(form.max_days_ahead >= 1 && form.max_days_ahead <= 365)) return toast.error('Max days ahead must be between 1 and 365.')
    setSaving(true)
    const now = new Date().toISOString()
    const rows = (Object.keys(DEFAULTS) as (keyof SettingsForm)[]).map((key) => ({
      key,
      value:
        key === 'blocked_dates'
          ? [...form.blocked_dates].sort()
          : key === 'ordering_guidelines'
            ? form.ordering_guidelines.map((g) => g.trim()).filter(Boolean)
            : form[key],
      updated_at: now,
    }))
    const { error } = await supabase.from('settings').upsert(rows)
    setSaving(false)
    if (error) toast.error(errorMessage(error))
    else toast.success('Settings saved')
  }

  async function uploadQr(m: OnlineMethod, file: File) {
    setUploading(m)
    try {
      const img = await prepareImage(file, 1200)
      const path = `${m}/qr-${Date.now()}.${extOf(img)}`
      const { error } = await supabase.storage.from('store-assets').upload(path, img, { contentType: img.type })
      if (error) throw error
      set(`${m}_qr_url`, supabase.storage.from('store-assets').getPublicUrl(path).data.publicUrl)
      toast.success('QR uploaded. Click Save to apply.')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>
  if (!form) return <Skeleton className="h-96" />

  const upcomingBlocked = form.blocked_dates.filter((d) => d >= today).sort()

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Settings"
        actions={
          <Button onClick={() => void save()} loading={saving}>
            <Save /> Save settings
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {ONLINE_METHODS.map((m) => {
          const label = PAYMENT_METHOD_LABEL[m]
          const qr = form[`${m}_qr_url`]
          return (
            <Panel
              key={m}
              title={
                <span className="flex items-center gap-3">
                  <PaymentLogo method={m} /> {label} account
                </span>
              }
            >
              <div className="space-y-4">
                <Field label="Account name" htmlFor={`${m}-name`}>
                  <Input id={`${m}-name`} value={form[`${m}_account_name`]} onChange={(e) => set(`${m}_account_name`, e.target.value)} placeholder="Juan D." />
                </Field>
                <Field label={`${label} number`} htmlFor={`${m}-num`}>
                  <Input id={`${m}-num`} inputMode="tel" value={form[`${m}_number`]} onChange={(e) => set(`${m}_number`, e.target.value)} placeholder="0917 123 4567" />
                </Field>
                <Field label={`${label} QR code`}>
                  <div className="flex items-center gap-3">
                    {qr ? (
                      <div className="relative">
                        <img src={qr} alt={`${label} QR`} className="size-28 rounded-xl border border-sand-200 object-contain" />
                        <button type="button" onClick={() => set(`${m}_qr_url`, '')} className="absolute -right-2 -top-2 rounded-full bg-brand-red p-1 text-white" aria-label={`Remove ${label} QR`}>
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex size-28 items-center justify-center rounded-xl border border-dashed border-navy/20 text-xs text-navy/50">No QR yet</div>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-navy/15 bg-white px-4 py-2 text-sm font-semibold hover:border-brand">
                      <ImagePlus className="size-4" /> {uploading === m ? 'Uploading…' : 'Upload QR'}
                      <input type="file" accept="image/*" className="sr-only" disabled={uploading !== null} onChange={(e) => e.target.files?.[0] && void uploadQr(m, e.target.files[0])} />
                    </label>
                  </div>
                </Field>
              </div>
            </Panel>
          )
        })}

        <Panel title="Ordering rules">
          <div className="space-y-4">
            <Field label="Cutoff time for next day orders (PH time)" htmlFor="cutoff" hint="After this time, the earliest delivery date becomes the day after tomorrow.">
              <Input id="cutoff" type="time" value={form.cutoff_time} onChange={(e) => set('cutoff_time', e.target.value)} className="w-40" />
            </Field>
            <Field label="Max days in advance" htmlFor="maxdays">
              <Input id="maxdays" type="number" min={1} max={365} value={form.max_days_ahead} onChange={(e) => set('max_days_ahead', Number(e.target.value))} className="w-32" />
            </Field>
            <Field label="Max orders per phone number per day" htmlFor="maxorders" hint="Spam protection limit.">
              <Input id="maxorders" type="number" min={1} max={50} value={form.max_orders_per_phone_per_day} onChange={(e) => set('max_orders_per_phone_per_day', Number(e.target.value))} className="w-32" />
            </Field>
            <Field label="Delivery fee note" htmlFor="feenote">
              <Textarea id="feenote" value={form.delivery_fee_note} onChange={(e) => set('delivery_fee_note', e.target.value)} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-cream px-3 py-2.5">
              <span>
                <span className="block text-sm font-semibold">Email confirmations</span>
                <span className="block text-xs text-navy/55">Send customers their tracking link by email (needs the Resend edge function).</span>
              </span>
              <Switch checked={form.email_notifications_enabled} onCheckedChange={(v) => set('email_notifications_enabled', v)} />
            </label>
          </div>
        </Panel>

        <Panel title="Ordering guidelines" className="lg:col-span-2">
          <p className="-mt-1 mb-3 text-sm text-navy/60">Shown in a popup every time a customer opens the site. One guideline per line.</p>
          <Textarea
            value={form.ordering_guidelines.join('\n')}
            onChange={(e) => set('ordering_guidelines', e.target.value.split('\n'))}
            rows={8}
            aria-label="Ordering guidelines, one per line"
          />
        </Panel>

        <Panel title="Blocked delivery dates" className="lg:col-span-2">
          <p className="-mt-1 mb-3 text-sm text-navy/60">Holidays or fully booked days. Customers can't pick these dates.</p>
          <div className="flex flex-col gap-5 md:flex-row">
            <div className="rounded-2xl border border-sand-200 p-2">
              <DayPicker
                mode="multiple"
                selected={form.blocked_dates.map(dateFromYmd)}
                onSelect={(dates) => set('blocked_dates', (dates ?? []).map(ymdFromDate))}
                disabled={{ before: dateFromYmd(today) }}
                startMonth={dateFromYmd(today)}
                numberOfMonths={2}
              />
            </div>
            <div className="flex-1">
              <p className="mb-2 text-sm font-semibold">Upcoming blocked dates ({upcomingBlocked.length})</p>
              {upcomingBlocked.length === 0 ? (
                <p className="text-sm text-navy/55">None.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {upcomingBlocked.map((d) => (
                    <li key={d} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-1 pl-3 pr-1 text-sm text-red-800">
                      {formatDate(d)}
                      <button type="button" onClick={() => set('blocked_dates', form.blocked_dates.filter((x) => x !== d))} className="rounded-full p-1 hover:bg-red-100" aria-label={`Unblock ${d}`}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-navy/55">Remember to click “Save settings”.</p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  )
}
