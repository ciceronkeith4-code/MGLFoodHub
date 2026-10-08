import { Banknote } from 'lucide-react'
import { isOnline, PAYMENT_LOGO, PAYMENT_METHOD_LABEL } from '@/lib/orderStatus'
import type { PaymentMethod } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Official payment logo on a white tile. Cash on Delivery uses a cash icon. */
export function PaymentLogo({ method, className }: { method: PaymentMethod; className?: string }) {
  return (
    <span className={cn('flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-sand-200', className)}>
      {isOnline(method) ? (
        <img src={PAYMENT_LOGO[method]} alt={`${PAYMENT_METHOD_LABEL[method]} logo`} className="max-h-[70%] max-w-[84%] object-contain" />
      ) : (
        <Banknote className="size-6 text-emerald-600" aria-hidden />
      )}
    </span>
  )
}
