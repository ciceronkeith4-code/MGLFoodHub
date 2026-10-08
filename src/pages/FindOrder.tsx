import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { normalizePhone } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/label'
import { ErrorBanner } from '@/components/common'
import { PageShell } from '@/components/CustomerLayout'

export default function FindOrder() {
  const [orderNumber, setOrderNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!/^MGL-\d{6}-[A-Z0-9]{4}$/i.test(orderNumber.trim())) return setError('Order numbers look like MGL-261008-AB12.')
    if (!normalizePhone(phone)) return setError('Please enter the phone number you used (09XXXXXXXXX).')
    setBusy(true)
    const { data, error } = await supabase.rpc('find_order', { p_order_number: orderNumber.trim(), p_phone: phone })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    if (!data) return setError("We couldn't find an order with that order number and phone number. Please double-check both.")
    navigate(`/track/${data as string}`)
  }

  return (
    <PageShell title="Find my order" subtitle="Enter your order number and the phone number you used at checkout." icon={<Search />}>
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white ring-1 ring-sand-200/70 p-4 shadow-sm sm:p-6" noValidate>
        <Field label="Order number" htmlFor="on" required>
          <Input id="on" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value.toUpperCase())} placeholder="MGL-261008-AB12" autoCapitalize="characters" className="font-mono" />
        </Field>
        <Field label="Phone number" htmlFor="ph" required>
          <Input id="ph" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09XXXXXXXXX" />
        </Field>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Show my tracking link
        </Button>
      </form>
    </PageShell>
  )
}
