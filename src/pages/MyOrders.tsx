import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ClipboardList, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getMyOrders, removeMyOrder, type SavedOrder } from '@/lib/myOrders'
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/orderStatus'
import type { OrderSummary } from '@/lib/types'
import { formatDate, peso, slotLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ToneBadge } from '@/components/common'
import { PageShell } from '@/components/CustomerLayout'

export default function MyOrders() {
  const [saved, setSaved] = useState<SavedOrder[]>(getMyOrders)
  const [summaries, setSummaries] = useState<Map<string, OrderSummary>>(new Map())
  const [loading, setLoading] = useState(saved.length > 0)

  useEffect(() => {
    if (!saved.length) return
    void supabase.rpc('get_order_summaries', { p_tokens: saved.map((s) => s.token) }).then(({ data }) => {
      setSummaries(new Map(((data ?? []) as OrderSummary[]).map((o) => [o.tracking_token, o])))
      setLoading(false)
    })
  }, [saved])

  return (
    <PageShell title="My Orders on this device" subtitle="Tracking links saved in this browser only. Other phones won't see them." icon={<ClipboardList />}>
      {saved.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No saved orders yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/">Start an order</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/find-order">Find my order</Link>
              </Button>
            </div>
          }
        >
          Ordered on a different phone? Use “Find my order” with your order number and phone number.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {saved.map((s) => {
            const o = summaries.get(s.token)
            return (
              <li key={s.token} className="flex items-stretch overflow-hidden rounded-2xl bg-white ring-1 ring-sand-200/70 shadow-sm animate-fade-up">
                <Link to={`/track/${s.token}`} className="flex flex-1 items-center gap-3 p-4 hover:bg-brand-50/40">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-mono font-bold">{s.order_number}</p>
                    {loading ? (
                      <Skeleton className="h-4 w-40" />
                    ) : o ? (
                      <>
                        <p className="text-sm text-navy/65">
                          {formatDate(o.delivery_date)} · {slotLabel(o.delivery_slot)} · {peso(o.total)}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <ToneBadge tone={ORDER_STATUS_TONE[o.order_status]}>{ORDER_STATUS_LABEL[o.order_status]}</ToneBadge>
                          {o.payment_method !== 'cod' && <ToneBadge tone="neutral">{PAYMENT_METHOD_LABEL[o.payment_method]} · {PAYMENT_STATUS_LABEL[o.payment_status]}</ToneBadge>}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-navy/50">Status unavailable</p>
                    )}
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-navy/30" />
                </Link>
                <button
                  type="button"
                  className="border-l border-sand px-3 text-navy/40 hover:bg-red-50 hover:text-brand-red"
                  aria-label={`Remove ${s.order_number} from this device`}
                  onClick={() => {
                    if (!confirm('Remove this order link from this device? Save the link somewhere first if you still need it.')) return
                    removeMyOrder(s.token)
                    setSaved(getMyOrders())
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </PageShell>
  )
}
