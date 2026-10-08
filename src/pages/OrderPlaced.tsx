import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, PackageSearch } from 'lucide-react'
import { useTrackedOrder } from '@/hooks/useTrackedOrder'
import { saveMyOrder } from '@/lib/myOrders'
import { PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import { formatDate, peso, slotLabel, trackingUrl } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner } from '@/components/common'
import { OrderItemsList, TrackingLinkActions } from '@/components/OrderBits'

export default function OrderPlaced() {
  const { token = '' } = useParams()
  const { order, loading, error, notFound } = useTrackedOrder(token)
  const url = trackingUrl(token)

  useEffect(() => {
    if (order) {
      saveMyOrder({ order_number: order.order_number, token, created_at: order.created_at, delivery_date: order.delivery_date })
      document.title = `Order ${order.order_number} placed · MGL Food Hub`
    }
  }, [order, token])

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (notFound) {
    return <EmptyState icon={<PackageSearch />} title="Order not found" action={<Button asChild><Link to="/find-order">Find my order</Link></Button>} />
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:py-12">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="relative overflow-hidden rounded-[2rem] bg-white px-5 pb-8 pt-10 text-center shadow-sm ring-1 ring-sand-200/70 animate-fade-up">
        {/* Confetti doodles like the reference */}
        <span aria-hidden className="pointer-events-none absolute left-[14%] top-8 font-script text-3xl text-brand rotate-12">~</span>
        <span aria-hidden className="pointer-events-none absolute right-[16%] top-6 font-script text-3xl text-brand -rotate-12">ʃ</span>
        <span aria-hidden className="pointer-events-none absolute left-[22%] top-24 size-1.5 rounded-full bg-brand" />
        <span aria-hidden className="pointer-events-none absolute right-[24%] top-28 size-2 rounded-full bg-brand/60" />
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-brand text-navy shadow-lg shadow-brand/30 animate-pop">
          <CheckCircle2 className="size-11" strokeWidth={2.2} />
        </div>
        <h1 className="mt-5 font-display text-3xl font-bold sm:text-4xl">Order Placed!</h1>
        <p className="mt-2 text-navy/65">Thank you for your order. Salamat po!</p>
        {order && (
          <>
            <p className="mt-1 text-sm text-navy/65">
              Order number <strong className="font-mono text-navy">{order.order_number}</strong>
            </p>
            <div className="mx-auto mt-6 max-w-xs border-t border-sand pt-5">
              <p className="text-sm text-navy/55">Scheduled Delivery</p>
              <p className="mt-1 font-heading text-lg font-semibold">{formatDate(order.delivery_date)}</p>
              <p className="text-sm text-navy/70">{slotLabel(order.delivery_slot)}</p>
            </div>
          </>
        )}
        <Button size="lg" className="mt-6" asChild>
          <Link to={`/track/${token}`}>
            View Order Details <ArrowRight />
          </Link>
        </Button>
        <p className="mt-6 font-script text-3xl text-navy">
          Enjoy your meal! <span className="text-brand-red">♡</span>
        </p>
      </div>

      <div className="rounded-2xl border-2 border-brand bg-brand-50 p-4 shadow-lg shadow-brand/10 sm:p-5">
        <p className="font-heading text-lg font-extrabold leading-snug text-brand-red">
          ⚠️ SAVE THIS ORDER LINK. This is the only way to check your order status.
        </p>
        <p className="mb-4 mt-1 text-sm text-navy/70">
          We also saved it under <Link to="/my-orders" className="font-semibold underline">My Orders</Link> on this device. Take a screenshot or share it to yourself to be safe.
        </p>
        <TrackingLinkActions url={url} orderNumber={order?.order_number ?? 'order'} />
      </div>

      {order && (
        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70 sm:p-5">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-navy/55">Delivery</p>
              <p className="font-semibold">{formatDate(order.delivery_date)}</p>
              <p className="text-navy/70">{slotLabel(order.delivery_slot)}</p>
            </div>
            <div>
              <p className="text-xs text-navy/55">Payment</p>
              <p className="font-semibold">{PAYMENT_METHOD_LABEL[order.payment_method]}</p>
              <p className="text-navy/70">
                {order.payment_method === 'cod' ? "We'll call you to confirm" : 'Verifying your payment'}
              </p>
            </div>
          </div>
          <OrderItemsList items={order.items} />
          <div className="flex justify-between border-t border-sand pt-3 font-heading text-lg font-bold">
            <span>Food subtotal</span>
            <span className="tabular-nums">{peso(order.subtotal)}</span>
          </div>
          <p className="text-xs text-navy/55">Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries).</p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" className="sm:flex-1" asChild>
          <Link to={`/track/${token}`}>Track my order</Link>
        </Button>
        <Button size="lg" variant="outline" className="sm:flex-1" asChild>
          <Link to="/">Back to stores</Link>
        </Button>
      </div>
    </div>
  )
}
