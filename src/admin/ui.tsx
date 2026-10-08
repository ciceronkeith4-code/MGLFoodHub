import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE,
} from '@/lib/orderStatus'
import type { OrderRow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ToneBadge } from '@/components/common'

export function AdminPageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-navy/60">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  icon,
  to,
  accent = 'navy',
  loading,
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  to?: string
  accent?: 'navy' | 'brand' | 'amber' | 'emerald' | 'red' | 'sky'
  loading?: boolean
}) {
  const accents = {
    navy: 'bg-sand text-navy',
    brand: 'bg-brand text-navy',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    sky: 'bg-sky-100 text-sky-700',
  }
  const body = (
    <div className="flex h-full min-w-0 flex-col items-start gap-2 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-sand-200/70 transition hover:shadow-md sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-full [&_svg]:size-5', accents[accent])}>{icon}</div>
      <div className="min-w-0 max-w-full">
        <p className="text-xs font-medium leading-snug text-navy/60">{label}</p>
        {loading ? <div className="mt-1 h-6 w-12 animate-pulse rounded bg-navy/10" /> : <p className="break-words font-heading text-xl font-extrabold leading-tight tabular-nums sm:text-2xl">{value}</p>}
      </div>
    </div>
  )
  return to ? <Link to={to}>{body}</Link> : body
}

export function OrderBadges({ order, className }: { order: Pick<OrderRow, 'order_status' | 'payment_status' | 'payment_method' | 'cancel_requested'>; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      <ToneBadge tone={ORDER_STATUS_TONE[order.order_status]}>{ORDER_STATUS_LABEL[order.order_status]}</ToneBadge>
      <ToneBadge tone={PAYMENT_STATUS_TONE[order.payment_status]}>
        {order.payment_method === 'cod' && order.payment_status !== 'paid' ? PAYMENT_METHOD_LABEL.cod : PAYMENT_STATUS_LABEL[order.payment_status]}
      </ToneBadge>
      {order.cancel_requested && <ToneBadge tone="danger">Cancel requested</ToneBadge>}
    </div>
  )
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70 sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-heading text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}
