import { useEffect, useMemo, useState } from 'react'
import { Download, Printer, ScrollText } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { downloadCsv } from '@/lib/csv'
import type { OrderOption } from '@/lib/types'
import { addDays, formatDate, manilaNow, slotLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner } from '@/components/common'
import { AdminPageHeader } from './ui'
import { useAdminLive } from './AdminLayout'

interface ItemRow {
  store_name_snapshot: string
  section_name_snapshot: string | null
  product_name_snapshot: string
  variant_label_snapshot: string
  options_snapshot: OrderOption[]
  quantity: number
  orders: { order_number: string; delivery_slot: string; order_status: string }
}

interface Line {
  section: string
  product: string
  variant: string
  options: string
  qty: number
  orders: Set<string>
  slots: Set<string>
}

const optionText = (opts: OrderOption[]) => opts.map((o) => (o.group === 'Extra Toppings' ? 'Extra toppings' : o.choice)).join(', ')

export default function PrepList() {
  const { version } = useAdminLive()
  const [date, setDate] = useState(() => addDays(manilaNow().date, 1))
  const [rows, setRows] = useState<ItemRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [includePending, setIncludePending] = useState(true)

  useEffect(() => {
    setRows(null)
    void supabase
      .from('order_items')
      .select(
        'store_name_snapshot, section_name_snapshot, product_name_snapshot, variant_label_snapshot, options_snapshot, quantity, orders!inner(order_number, delivery_slot, order_status, delivery_date)',
      )
      .eq('orders.delivery_date', date)
      .neq('orders.order_status', 'cancelled')
      .limit(10000)
      .then(({ data, error }) => {
        if (error) setError(errorMessage(error))
        else {
          setRows((data ?? []) as unknown as ItemRow[])
          setError(null)
        }
      })
  }, [date, version])

  const stores = useMemo(() => {
    const map = new Map<string, Map<string, Line>>()
    for (const r of rows ?? []) {
      if (!includePending && r.orders.order_status === 'processing') continue
      const store = map.get(r.store_name_snapshot) ?? new Map<string, Line>()
      const opts = optionText(r.options_snapshot)
      const key = [r.section_name_snapshot, r.product_name_snapshot, r.variant_label_snapshot, opts].join('|')
      const line = store.get(key) ?? {
        section: r.section_name_snapshot ?? '',
        product: r.product_name_snapshot,
        variant: r.variant_label_snapshot,
        options: opts,
        qty: 0,
        orders: new Set<string>(),
        slots: new Set<string>(),
      }
      line.qty += r.quantity
      line.orders.add(r.orders.order_number)
      line.slots.add(r.orders.delivery_slot)
      store.set(key, line)
      map.set(r.store_name_snapshot, store)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, lines]) => ({
        name,
        lines: [...lines.values()].sort((a, b) => (a.section + a.product + a.variant).localeCompare(b.section + b.product + b.variant)),
      }))
  }, [rows, includePending])

  const pendingCount = new Set((rows ?? []).filter((r) => r.orders.order_status === 'processing').map((r) => r.orders.order_number)).size

  const exportCsv = () =>
    downloadCsv(
      `mgl-prep-list-${date}.csv`,
      ['Delivery date', 'Store', 'Section', 'Item', 'Variant', 'Options', 'Quantity', 'Time slots', 'Orders'],
      stores.flatMap((s) =>
        s.lines.map((l) => [date, s.name, l.section, l.product, l.variant, l.options, l.qty, [...l.slots].sort().map(slotLabel).join('; '), [...l.orders].join(' ')]),
      ),
    )

  return (
    <div>
      <AdminPageHeader
        title="Daily prep list"
        description="Total quantities to order from each merchant for one delivery date."
        actions={
          <>
            <Button variant="outline" onClick={exportCsv} disabled={!stores.length}>
              <Download /> CSV
            </Button>
            <Button variant="navy" onClick={() => window.print()} disabled={!stores.length}>
              <Printer /> Print
            </Button>
          </>
        }
      />

      <div className="no-print mb-4 flex flex-wrap items-center gap-3 rounded-2xl ring-1 ring-sand-200/70 bg-white p-3 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-semibold">
          Delivery date
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-auto" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} className="size-4 accent-[#F7941D]" />
          Include unconfirmed orders ({pendingCount})
        </label>
      </div>

      <h2 className="mb-3 hidden font-heading text-xl font-bold print:block">MGL Food Hub · Prep list for {formatDate(date, 'long')}</h2>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!rows ? (
        <Skeleton className="h-64" />
      ) : stores.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={`No orders for ${formatDate(date)}`}>Pick another delivery date.</EmptyState>
      ) : (
        <div className="space-y-4">
          {stores.map((s) => (
            <section key={s.name} className="print-break overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm">
              <h3 className="flex justify-between border-b border-sand bg-[#fdf3e3] px-4 py-3 font-display text-lg font-bold text-navy print:bg-white">
                <span>{s.name}</span>
                <span className="shrink-0 text-sm font-semibold">{(() => { const n = s.lines.reduce((t, l) => t + l.qty, 0); return `${n} ${n === 1 ? "item" : "items"}` })()}</span>
              </h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-navy/55">
                  <tr className="border-b border-sand">
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="hidden px-4 py-2 sm:table-cell">Time slots</th>
                    <th className="hidden px-4 py-2 md:table-cell print:table-cell">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {s.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">
                        <p className="font-semibold">
                          {l.product}
                          {l.variant !== 'Regular' && <span className="font-normal"> · {l.variant}</span>}
                        </p>
                        <p className="text-xs text-navy/55">{[l.section !== l.product ? l.section : '', l.options].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className="px-4 py-2 text-right font-heading text-lg font-extrabold tabular-nums">× {l.qty}</td>
                      <td className="hidden px-4 py-2 text-xs text-navy/65 sm:table-cell">{[...l.slots].sort().map(slotLabel).join(', ')}</td>
                      <td className="hidden px-4 py-2 font-mono text-xs text-navy/65 md:table-cell print:table-cell">{[...l.orders].join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
