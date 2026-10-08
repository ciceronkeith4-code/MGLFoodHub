import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Download, FilterX, Phone, Search } from 'lucide-react'
import { supabase, errorMessage } from '@/lib/supabase'
import { useCatalog } from '@/hooks/useCatalog'
import { downloadCsv } from '@/lib/csv'
import { ONLINE_METHODS, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL } from '@/lib/orderStatus'
import type { OrderRow } from '@/lib/types'
import { formatDate, formatDateTime, formatPhone, peso, slotLabel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner } from '@/components/common'
import { AdminPageHeader, OrderBadges } from './ui'
import { useAdminLive } from './AdminLayout'

const PAGE = 30
type Row = OrderRow & { order_items: { store_id: string; store_name_snapshot: string }[] }

function useOrderQuery(params: URLSearchParams) {
  return useMemo(() => {
    const f = Object.fromEntries(params.entries())
    return (select: string, opts?: { count?: 'exact' }) => {
      let q = supabase.from('orders').select(select, opts)
      if (f.date) q = q.eq('delivery_date', f.date)
      if (f.created) q = q.gte('created_at', `${f.created}T00:00:00+08:00`).lt('created_at', `${f.created}T23:59:59.999+08:00`)
      if (f.status === 'cancel_requested') q = q.eq('cancel_requested', true)
      else if (f.status === 'active') q = q.not('order_status', 'in', '(delivered,cancelled)')
      else if (f.status) q = q.eq('order_status', f.status)
      if (f.method === 'online') q = q.neq('payment_method', 'cod')
      else if (f.method) q = q.eq('payment_method', f.method)
      if (f.pstatus) q = q.eq('payment_status', f.pstatus)
      if (f.store) q = q.eq('order_items.store_id', f.store)
      const s = (f.q ?? '').replace(/[,()%*\\]/g, ' ').trim()
      if (s) q = q.or(`customer_name.ilike.%${s}%,phone.ilike.%${s}%,order_number.ilike.%${s}%`)
      return f.sort === 'delivery'
        ? q.order('delivery_date', { ascending: true }).order('delivery_slot', { ascending: true })
        : q.order('created_at', { ascending: false })
    }
  }, [params])
}

export default function Orders() {
  const [params, setParams] = useSearchParams()
  const { version, clearUnseen } = useAdminLive()
  const cat = useCatalog()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [exporting, setExporting] = useState(false)
  const page = Number(params.get('page') ?? '0')
  const build = useOrderQuery(params)
  const itemsSelect = params.get('store') ? 'order_items!inner(store_id, store_name_snapshot)' : 'order_items(store_id, store_name_snapshot)'

  useEffect(() => clearUnseen(), [clearUnseen])

  useEffect(() => {
    let cancelled = false
    void build(`*, ${itemsSelect}`, { count: 'exact' })
      .range(page * PAGE, page * PAGE + PAGE - 1)
      .then(({ data, error, count }) => {
        if (cancelled) return
        if (error) setError(errorMessage(error))
        else {
          setRows((data ?? []) as unknown as Row[])
          setTotal(count ?? 0)
          setError(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [build, itemsSelect, page, version])

  // Debounced search box
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search.trim()) update({ q: search.trim() })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  async function exportCsv() {
    setExporting(true)
    const { data, error } = await build(
      '*, order_items' + (params.get('store') ? '!inner' : '') + '(store_id, store_name_snapshot, product_name_snapshot, variant_label_snapshot, options_snapshot, quantity, line_total)',
    ).limit(5000)
    setExporting(false)
    if (error) return toast.error(errorMessage(error))
    type Full = OrderRow & { order_items: { store_name_snapshot: string; product_name_snapshot: string; variant_label_snapshot: string; options_snapshot: { group: string; choice: string }[]; quantity: number }[] }
    const list = (data ?? []) as unknown as Full[]
    downloadCsv(
      `mgl-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Order #', 'Placed', 'Delivery date', 'Slot', 'Customer', 'Phone', 'Email', 'Social', 'Address', 'Barangay', 'City', 'Landmark', 'Payment', 'Payment status', 'Order status', 'Payment ref', 'Items', 'Food subtotal', 'Delivery fee', 'Total', 'Customer notes', 'Admin notes', 'Cancel reason'],
      list.map((o) => [
        o.order_number, formatDateTime(o.created_at), o.delivery_date, slotLabel(o.delivery_slot), o.customer_name, o.phone, o.email, o.social_media,
        o.address, o.barangay, o.city, o.landmark, PAYMENT_METHOD_LABEL[o.payment_method], PAYMENT_STATUS_LABEL[o.payment_status], ORDER_STATUS_LABEL[o.order_status],
        o.gcash_reference,
        o.order_items.map((i) => `${i.quantity}x ${i.store_name_snapshot}: ${i.product_name_snapshot}${i.variant_label_snapshot !== 'Regular' ? ` (${i.variant_label_snapshot})` : ''}${i.options_snapshot.length ? ` [${i.options_snapshot.map((x) => x.choice === 'Yes' ? x.group : x.choice).join(', ')}]` : ''}`).join('; '),
        Number(o.subtotal).toFixed(2), Number(o.delivery_fee).toFixed(2), Number(o.total).toFixed(2), o.customer_notes, o.admin_notes, o.cancel_reason,
      ]),
    )
  }

  const filtersActive = ['date', 'created', 'status', 'method', 'pstatus', 'store', 'q'].some((k) => params.get(k))
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        description={`${total} order${total === 1 ? '' : 's'}${filtersActive ? ' match your filters' : ''}`}
        actions={
          <Button variant="outline" onClick={() => void exportCsv()} loading={exporting}>
            <Download /> Export CSV
          </Button>
        }
      />

      <div className="mb-4 grid gap-2 rounded-2xl ring-1 ring-sand-200/70 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, order #" className="pl-9" />
        </div>
        <Input type="date" value={params.get('date') ?? ''} onChange={(e) => update({ date: e.target.value })} aria-label="Delivery date" title="Delivery date" />
        <NativeSelect value={params.get('status') ?? ''} onChange={(e) => update({ status: e.target.value })} aria-label="Order status">
          <option value="">All statuses</option>
          <option value="active">Active (not done)</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
          <option value="cancel_requested">Cancel requested</option>
        </NativeSelect>
        <NativeSelect value={params.get('method') ?? ''} onChange={(e) => update({ method: e.target.value })} aria-label="Payment method">
          <option value="">All payment methods</option>
          <option value="cod">COD</option>
          <option value="online">Online (all)</option>
          {ONLINE_METHODS.map((m) => (
            <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={params.get('pstatus') ?? ''} onChange={(e) => update({ pstatus: e.target.value })} aria-label="Payment status">
          <option value="">Any payment status</option>
          {Object.entries(PAYMENT_STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={params.get('store') ?? ''} onChange={(e) => update({ store: e.target.value })} aria-label="Store">
          <option value="">All stores</option>
          {cat.stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={params.get('sort') ?? ''} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
          <option value="">Newest first</option>
          <option value="delivery">By delivery date/time</option>
        </NativeSelect>
        {filtersActive && (
          <Button
            variant="ghost"
            className="sm:col-span-2 lg:col-span-4 2xl:col-span-8 justify-self-start"
            onClick={() => {
              setSearch('')
              setParams(new URLSearchParams(), { replace: true })
            }}
          >
            <FilterX /> Clear filters
          </Button>
        )}
      </div>

      {error && <ErrorBanner className="mb-4">{error}</ErrorBanner>}

      {!rows ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search />} title="No orders found">Try changing the filters.</EmptyState>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl ring-1 ring-sand-200/70 bg-white shadow-sm xl:block">
            <table className="w-full text-sm">
              <thead className="bg-sand/60 text-left text-xs uppercase tracking-wide text-navy/60">
                <tr>
                  <th className="px-3 py-2.5">Order</th>
                  <th className="px-3 py-2.5">Customer</th>
                  <th className="px-3 py-2.5">Delivery</th>
                  <th className="px-3 py-2.5">Stores</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-cream">
                    <td className="px-3 py-2.5">
                      <Link to={`/admin/orders/${o.id}`} className="whitespace-nowrap font-mono font-semibold text-brand-600 hover:underline">
                        {o.order_number}
                      </Link>
                      <p className="text-xs text-navy/50">{formatDateTime(o.created_at)}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{o.customer_name}</p>
                      <a href={`tel:${o.phone}`} className="text-xs text-navy/60 hover:text-brand-600">{formatPhone(o.phone)}</a>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{formatDate(o.delivery_date)}</p>
                      <p className="text-xs text-navy/60">{slotLabel(o.delivery_slot)}</p>
                    </td>
                    <td className="max-w-48 px-3 py-2.5 text-xs text-navy/70">
                      {[...new Set(o.order_items.map((i) => i.store_name_snapshot))].join(', ')}
                    </td>
                    <td className="px-3 py-2.5">
                      <OrderBadges order={o} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{peso(o.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:hidden">
            {rows.map((o) => (
              <li key={o.id} className="flex min-w-0 flex-col rounded-2xl ring-1 ring-sand-200/70 bg-white p-3 shadow-sm">
                <Link to={`/admin/orders/${o.id}`} className="mb-2 block">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-semibold text-brand-600">{o.order_number}</p>
                      <p className="break-words font-medium">{o.customer_name}</p>
                    </div>
                    <span className="font-semibold tabular-nums">{peso(o.subtotal)}</span>
                  </div>
                  <p className="mt-1 text-xs text-navy/60">
                    {formatDate(o.delivery_date)} · {slotLabel(o.delivery_slot)}
                  </p>
                  <p className="text-xs text-navy/60">{[...new Set(o.order_items.map((i) => i.store_name_snapshot))].join(', ')}</p>
                  <OrderBadges order={o} className="mt-2" />
                </Link>
                <a href={`tel:${o.phone}`} className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-navy px-3 py-1.5 pt-1.5 text-xs font-semibold text-white">
                  <Phone className="size-3.5" /> Call {formatPhone(o.phone)}
                </a>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => update({ page: String(page - 1) })}>
                <ChevronLeft /> Prev
              </Button>
              <span className="text-sm text-navy/60">
                Page {page + 1} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => update({ page: String(page + 1) })}>
                Next <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
