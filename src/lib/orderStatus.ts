import type { OrderStatus, PaymentMethod, PaymentStatus, PublicOrder } from './types'
import { formatDate, formatPhone, peso } from './utils'

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  processing: 'Processing',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  cod_unpaid: 'COD – unpaid',
  pending_verification: 'GCash – to verify',
  paid: 'Paid',
  rejected: 'GCash – rejected',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cod: 'Cash on Delivery',
  gcash: 'GCash',
}

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  processing: 'warning',
  confirmed: 'info',
  preparing: 'info',
  out_for_delivery: 'info',
  delivered: 'success',
  cancelled: 'danger',
}

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  cod_unpaid: 'neutral',
  pending_verification: 'warning',
  paid: 'success',
  rejected: 'danger',
}

/** Label for a status-history row, as the customer/admin sees it. */
export function historyLabel(status: string, method: PaymentMethod): string {
  switch (status) {
    case 'processing':
      return method === 'gcash' ? 'Processing Payment' : 'Order Processed'
    case 'confirmed':
      return 'Confirmed'
    case 'payment_confirmed':
      return 'Payment Confirmed'
    case 'payment_rejected':
      return 'Payment Rejected'
    case 'proof_resubmitted':
      return 'New Payment Proof Sent'
    case 'preparing':
      return 'Preparing'
    case 'out_for_delivery':
      return 'Out for Delivery'
    case 'delivered':
      return 'Delivered'
    case 'cancelled':
      return 'Cancelled'
    case 'cancel_requested':
      return 'Cancellation Requested'
    case 'cancel_request_declined':
      return 'Cancellation Request Declined'
    case 'delivery_fee_updated':
      return 'Delivery Fee Added'
    default:
      return status.replace(/_/g, ' ')
  }
}

export interface StatusMessage {
  title: string
  message: string
  tone: Tone
}

/** The big status message on the tracking page (depends on payment method + status). */
export function customerStatus(o: PublicOrder): StatusMessage {
  const due = peso(o.total)
  const fee = Number(o.delivery_fee) > 0 ? peso(o.delivery_fee) : null

  if (o.order_status === 'cancelled') {
    return { title: 'Cancelled', message: o.cancel_reason ? `Reason: ${o.cancel_reason}` : 'This order was cancelled.', tone: 'danger' }
  }

  if (o.payment_method === 'cod') {
    switch (o.order_status) {
      case 'processing':
        return {
          title: 'Order Processed ✅',
          message: `Our team will call you at ${formatPhone(o.phone)} to confirm your order.`,
          tone: 'success',
        }
      case 'confirmed':
        return { title: 'Confirmed', message: 'Your order has been confirmed by phone.', tone: 'info' }
      case 'preparing':
        return { title: 'Preparing', message: `The stores are preparing your order for ${formatDate(o.delivery_date)}.`, tone: 'info' }
      case 'out_for_delivery':
        return { title: 'Out for Delivery', message: `Your rider is on the way. Please prepare ${due} in cash.`, tone: 'info' }
      case 'delivered':
        return { title: 'Delivered', message: `Please pay ${due} in cash to the rider.`, tone: 'success' }
    }
  }

  // GCash
  switch (o.order_status) {
    case 'processing':
      if (o.payment_status === 'rejected') {
        return {
          title: 'Payment Rejected ❌',
          message: o.payment_rejection_reason || 'We could not verify your GCash payment. Please upload a new proof.',
          tone: 'danger',
        }
      }
      return {
        title: 'Processing Payment ⏳',
        message: `We are verifying your GCash payment (Ref: ${o.gcash_reference ?? '—'}).`,
        tone: 'warning',
      }
    case 'confirmed':
      return { title: 'Payment Confirmed ✅', message: 'Thank you! Your GCash payment is verified and your order is confirmed.', tone: 'success' }
    case 'preparing':
      return { title: 'Preparing', message: `The stores are preparing your order for ${formatDate(o.delivery_date)}.`, tone: 'info' }
    case 'out_for_delivery':
      return {
        title: 'Out for Delivery',
        message: fee ? `Your rider is on the way. Please prepare ${fee} for the delivery fee.` : 'Your rider is on the way.',
        tone: 'info',
      }
    default:
      return {
        title: 'Delivered',
        message: fee ? `Enjoy your meal! Please pay the delivery fee of ${fee} to the rider.` : 'Enjoy your meal! Salamat po!',
        tone: 'success',
      }
  }
}

export interface Step {
  key: string
  label: string
  done: boolean
  current: boolean
  at?: string
}

const RANK: Record<OrderStatus, number> = {
  processing: 0,
  confirmed: 1,
  preparing: 2,
  out_for_delivery: 3,
  delivered: 4,
  cancelled: -1,
}

/** Five-step progress tracker for the tracking page. */
export function progressSteps(o: PublicOrder): Step[] {
  const keys =
    o.payment_method === 'gcash'
      ? ['processing', 'payment_confirmed', 'preparing', 'out_for_delivery', 'delivered']
      : ['processing', 'confirmed', 'preparing', 'out_for_delivery', 'delivered']
  const rank = RANK[o.order_status]
  const lastAt = (key: string) => [...o.history].reverse().find((h) => h.status === key)?.created_at
  return keys.map((key, i) => ({
    key,
    label: historyLabel(key, o.payment_method),
    done: rank >= i,
    current: rank === i,
    at: lastAt(key),
  }))
}
