import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, CalendarClock, ChevronLeft, ChevronRight, Phone, ShieldCheck, ShoppingBag, TrendingUp, XCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { OrderRow } from '@/lib/types'
import { addDays, cn, formatDate, formatDateTime, manilaNow, peso, slotLabel, toCents } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AdminPageHeader, OrderBadges, Panel, StatCard } from './ui'
import { useAdminLive } from './AdminLayout'

interface Stats {
  newToday: number
  gcashToVerify: number
  codToCall: number
  tomorrow: number
  cancelRequests: number
  revenueWeek: number
  revenueMonth: number
}

const count = async (build: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
  const { count } = await build(base())
  return count ?? 0
}
const base = () => supabase.from('orders').select('id', { count: 'exact', head: true })

async function sumDelivered(from: string, to: string) {
  const { data } = await supabase
    .from('orders')
    .select('subtotal')
    .eq('order_status', 'delivered')
    .gte('delivery_date', from)
    .lte('delivery_date', to)
    .limit(10000)
  return (data ?? []).reduce((n, o) => n + toCents(o.subtotal), 0) / 100
}

export default function Dashboard() {
  const { version } = useAdminLive()
  const [stats, setStats] = useState<Stats | null>(null)
  const [recent, setRecent] = useState<OrderRow[]>([])
  const today = manilaNow().date
  const tomorrow = addDays(today, 1)

  useEffect(() => {
    const d = new Date(`${today}T00:00:00Z`)
    const weekStart = addDays(today, -((d.getUTCDay() + 6) % 7)) // Monday
    const monthStart = `${today.slice(0, 8)}01`
    void Promise.all([
      count((q) => q.gte('created_at', `${today}T00:00:00+08:00`)),
      count((q) => q.neq('payment_method', 'cod').eq('payment_status', 'pending_verification').eq('order_status', 'processing')),
      count((q) => q.eq('payment_method', 'cod').eq('order_status', 'processing')),
      count((q) => q.eq('delivery_date', tomorrow).neq('order_status', 'cancelled')),
      count((q) => q.eq('cancel_requested', true)),
      sumDelivered(weekStart, today),
      sumDelivered(monthStart, today),
    ]).then(([newToday, gcashToVerify, codToCall, tmr, cancelRequests, revenueWeek, revenueMonth]) =>
      setStats({ newToday, gcashToVerify, codToCall, tomorrow: tmr, cancelRequests, revenueWeek, revenueMonth }),
    )
    void supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setRecent((data ?? []) as OrderRow[]))
  }, [version, today, tomorrow])

  const loading = !stats
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Dashboard" description="Live. New orders appear here instantly." />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
        <StatCard label="New orders today" value={stats?.newToday} icon={<ShoppingBag />} accent="brand" loading={loading} to={`/admin/orders?created=${today}`} />
        <StatCard label="Online payments to verify" value={stats?.gcashToVerify} icon={<ShieldCheck />} accent="sky" loading={loading} to="/admin/orders?method=online&pstatus=pending_verification&status=processing" />
        <StatCard label="COD orders to call" value={stats?.codToCall} icon={<Phone />} accent="amber" loading={loading} to="/admin/orders?method=cod&status=processing" />
        <StatCard label="Scheduled for tomorrow" value={stats?.tomorrow} icon={<CalendarClock />} accent="navy" loading={loading} to={`/admin/orders?date=${tomorrow}`} />
        <StatCard label="Cancellation requests" value={stats?.cancelRequests} icon={<XCircle />} accent="red" loading={loading} to="/admin/orders?status=cancel_requested" />
        <StatCard label="Revenue this week (delivered)" value={stats ? peso(stats.revenueWeek) : ''} icon={<TrendingUp />} accent="emerald" loading={loading} />
        <StatCard label="Revenue this month (delivered)" value={stats ? peso(stats.revenueMonth) : ''} icon={<Banknote />} accent="emerald" loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <DeliveryCalendar version={version} today={today} />
        <Panel
          title="Latest orders"
          actions={
            <Button variant="link" size="sm" asChild>
              <Link to="/admin/orders">View all</Link>
            </Button>
          }
        >
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-navy/55">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-sand">
              {recent.map((o) => (
                <li key={o.id}>
                  <Link to={`/admin/orders/${o.id}`} className="flex items-center gap-3 py-2.5 hover:bg-cream">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                        <span className="whitespace-nowrap font-mono">{o.order_number}</span>
                        <span className="min-w-0 break-words font-normal text-navy/60">{o.customer_name}</span>
                      </p>
                      <p className="text-xs text-navy/55">
                        For {formatDate(o.delivery_date)} · {slotLabel(o.delivery_slot)}<span className="hidden sm:inline"> · placed {formatDateTime(o.created_at)}</span>
                      </p>
                      <OrderBadges order={o} className="mt-1" />
                    </div>
                    <span className="shrink-0 self-start text-sm font-semibold tabular-nums">{peso(o.subtotal)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function DeliveryCalendar({ version, today }: { version: number; today: string }) {
  const navigate = useNavigate()
  const [month, setMonth] = useState(today.slice(0, 7)) // YYYY-MM
  const [counts, setCounts] = useState<Map<string, { total: number; pending: number }>>(new Map())

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const lead = (first.getUTCDay() + 6) % 7 // Monday-first
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { lead, total, y, m }
  }, [month])

  useEffect(() => {
    const from = `${month}-01`
    const to = `${month}-${String(days.total).padStart(2, '0')}`
    void supabase
      .from('orders')
      .select('delivery_date, order_status')
      .gte('delivery_date', from)
      .lte('delivery_date', to)
      .neq('order_status', 'cancelled')
      .limit(10000)
      .then(({ data }) => {
        const map = new Map<string, { total: number; pending: number }>()
        for (const o of data ?? []) {
          const c = map.get(o.delivery_date) ?? { total: 0, pending: 0 }
          c.total++
          if (o.order_status === 'processing') c.pending++
          map.set(o.delivery_date, c)
        }
        setCounts(map)
      })
  }, [month, days.total, version])

  const shift = (n: number) => {
    const d = new Date(Date.UTC(days.y, days.m - 1 + n, 1))
    setMonth(d.toISOString().slice(0, 7))
  }
  const label = new Date(Date.UTC(days.y, days.m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <Panel
      title="Upcoming deliveries"
      actions={
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => shift(-1)} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          <span className="min-w-28 text-center text-sm font-semibold">{label}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => shift(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-navy/45">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: days.lead }).map((_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: days.total }).map((_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`
          const c = counts.get(date)
          const isToday = date === today
          const past = date < today
          return (
            <button
              key={date}
              type="button"
              onClick={() => navigate(`/admin/orders?date=${date}`)}
              className={cn(
                'flex aspect-square min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg border text-xs transition hover:border-brand sm:rounded-xl sm:text-sm',
                c ? 'border-brand/40 bg-[#fdf3e3]' : 'border-transparent bg-cream',
                isToday && 'ring-2 ring-navy',
                past && 'opacity-50',
              )}
            >
              <span className="font-semibold">{i + 1}</span>
              {c && (
                <span className="mt-0.5 rounded-full bg-brand px-1.5 text-[10px] font-bold leading-4 text-navy">
                  {c.total}
                </span>
              )}
              {c && c.pending > 0 && (
                <>
                  <span className="mt-0.5 size-1.5 rounded-full bg-amber-500 sm:hidden" aria-label={`${c.pending} pending`} />
                  <span className="mt-1 hidden text-[9px] font-semibold leading-tight text-amber-700 sm:block">{c.pending} pending</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-navy/55">Number = orders by delivery date (cancelled excluded). Tap a day to see its orders.</p>
    </Panel>
  )
}
