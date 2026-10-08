import { useEffect, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import { PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import type { OrderStatus, PaymentMethod } from '@/lib/types'
import { addDays, formatDate, manilaNow, peso, toCents } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/controls'
import { ErrorBanner } from '@/components/common'
import { AdminPageHeader, Panel } from './ui'

interface ReportOrder {
  delivery_date: string
  order_status: OrderStatus
  payment_method: PaymentMethod
  subtotal: number
  delivery_fee: number
  order_items: { store_name_snapshot: string; quantity: number; line_total: number }[]
}

type Agg = { orders: number; food: number; fees: number }

export default function Reports() {
  const today = manilaNow().date
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)
  const [scope, setScope] = useState<'delivered' | 'active'>('delivered')
  const [rows, setRows] = useState<ReportOrder[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows(null)
    let q = supabase
      .from('orders')
      .select('delivery_date, order_status, payment_method, subtotal, delivery_fee, order_items(store_name_snapshot, quantity, line_total)')
      .gte('delivery_date', from)
      .lte('delivery_date', to)
      .limit(10000)
    q = scope === 'delivered' ? q.eq('order_status', 'delivered') : q.neq('order_status', 'cancelled')
    void q.then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else {
        setRows((data ?? []) as unknown as ReportOrder[])
        setError(null)
      }
    })
  }, [from, to, scope])

  const report = useMemo(() => {
    const byDate = new Map<string, Agg>()
    const byMethod = new Map<string, Agg>()
    const byStore = new Map<string, { orders: Set<number>; qty: number; food: number }>()
    const totals: Agg = { orders: 0, food: 0, fees: 0 }
    ;(rows ?? []).forEach((o, idx) => {
      const food = toCents(o.subtotal)
      const fee = toCents(o.delivery_fee)
      for (const [map, key] of [
        [byDate, o.delivery_date],
        [byMethod, o.payment_method],
      ] as const) {
        const a = map.get(key) ?? { orders: 0, food: 0, fees: 0 }
        a.orders++
        a.food += food
        a.fees += fee
        map.set(key, a)
      }
      totals.orders++
      totals.food += food
      totals.fees += fee
      for (const i of o.order_items) {
        const s = byStore.get(i.store_name_snapshot) ?? { orders: new Set<number>(), qty: 0, food: 0 }
        s.orders.add(idx)
        s.qty += i.quantity
        s.food += toCents(i.line_total)
        byStore.set(i.store_name_snapshot, s)
      }
    })
    return {
      totals,
      byDate: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)),
      byMethod: [...byMethod.entries()],
      byStore: [...byStore.entries()].sort((a, b) => b[1].food - a[1].food),
    }
  }, [rows])

  const c = (cents: number) => peso(cents / 100)
  const n = (cents: number) => (cents / 100).toFixed(2)
  const label = scope === 'delivered' ? 'delivered' : 'active'

  const presets = [
    { l: 'Today', f: today, t: today },
    { l: 'Last 7 days', f: addDays(today, -6), t: today },
    { l: 'This month', f: `${today.slice(0, 8)}01`, t: today },
    { l: 'Last 30 days', f: addDays(today, -29), t: today },
  ]

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Reports"
        description="By delivery date. Revenue = food subtotal; delivery fees are shown separately (paid to the rider)."
        actions={
          <Button
            variant="outline"
            disabled={!rows?.length}
            onClick={() =>
              downloadCsv(`mgl-report-${from}-to-${to}.csv`, ['Section', 'Key', 'Orders', 'Items', 'Food revenue', 'Delivery fees'], [
                ...report.byDate.map(([d, a]) => ['By date', d, a.orders, '', n(a.food), n(a.fees)]),
                ...report.byStore.map(([s, a]) => ['By store', s, a.orders.size, a.qty, n(a.food), '']),
                ...report.byMethod.map(([m, a]) => ['By payment', PAYMENT_METHOD_LABEL[m as PaymentMethod], a.orders, '', n(a.food), n(a.fees)]),
                ['Total', `${from} to ${to}`, report.totals.orders, '', n(report.totals.food), n(report.totals.fees)],
              ])
            }
          >
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-2xl ring-1 ring-sand-200/70 bg-white p-3 shadow-sm">
        <label className="text-sm font-semibold">
          From
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="mt-1 w-auto" />
        </label>
        <label className="text-sm font-semibold">
          To
          <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="mt-1 w-auto" />
        </label>
        <label className="text-sm font-semibold">
          Orders
          <NativeSelect value={scope} onChange={(e) => setScope(e.target.value as 'delivered' | 'active')} className="mt-1 w-56">
            <option value="delivered">Delivered only (revenue)</option>
            <option value="active">All except cancelled</option>
          </NativeSelect>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Button key={p.l} variant="ghost" size="sm" onClick={() => { setFrom(p.f); setTo(p.t) }}>
              {p.l}
            </Button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!rows ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label={`Orders (${label})`} value={String(report.totals.orders)} />
            <Stat label="Food revenue" value={c(report.totals.food)} />
            <Stat label="Delivery fees" value={c(report.totals.fees)} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="By store">
              <Table head={['Store', 'Orders', 'Items', 'Revenue']} rows={report.byStore.map(([s, a]) => [s, a.orders.size, a.qty, c(a.food)])} />
            </Panel>
            <Panel title="By payment method">
              <Table head={['Method', 'Orders', 'Revenue', 'Fees']} rows={report.byMethod.map(([m, a]) => [PAYMENT_METHOD_LABEL[m as PaymentMethod], a.orders, c(a.food), c(a.fees)])} />
            </Panel>
            <Panel title="By delivery date" className="xl:col-span-2">
              <ByDateChart data={report.byDate} />
              <Table head={['Date', 'Orders', 'Revenue', 'Fees']} rows={report.byDate.map(([d, a]) => [formatDate(d), a.orders, c(a.food), c(a.fees)])} />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl ring-1 ring-sand-200/70 bg-white p-4 shadow-sm">
      <p className="text-xs text-navy/60">{label}</p>
      <p className="break-words font-heading text-xl font-extrabold tabular-nums sm:text-2xl">{value}</p>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-navy/55">No data for this range.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-navy/55">
            {head.map((h, i) => (
              <th key={h} className={`py-2 ${i ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`py-2 ${j ? 'text-right tabular-nums' : 'font-medium'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Simple bar chart of daily food revenue. */
function ByDateChart({ data }: { data: [string, Agg][] }) {
  if (data.length < 2) return null
  const max = Math.max(...data.map(([, a]) => a.food), 1)
  return (
    <div className="mb-4 flex h-40 items-end gap-1 border-b border-sand-200 pb-1" role="img" aria-label="Daily food revenue">
      {data.map(([d, a]) => (
        <div key={d} className="group relative flex h-full flex-1 items-end">
          <div className="w-full rounded-t-md bg-brand transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(2, (a.food / max) * 100)}%` }} />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-navy px-2 py-1 text-xs text-white group-hover:block">
            {formatDate(d)}: {peso(a.food / 100)} · {a.orders} orders
          </div>
        </div>
      ))}
    </div>
  )
}
