import { Link, useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { AlertTriangle, ArrowRight, ShoppingBag, Store as StoreIcon, Trash2 } from 'lucide-react'
import { useCartView, useCatalog } from '@/hooks/useCatalog'
import { useCart } from '@/store/cart'
import { cn, peso } from '@/lib/utils'
import { Button } from './ui/button'
import { QuantityStepper } from './ui/controls'
import { Dialog, SheetContent } from './ui/dialog'
import { EmptyState, SmartImage } from './common'

export const useCartUI = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export const FEE_NOTE = 'Delivery fee will be confirmed by our team (higher fees may apply for long distance deliveries).'

export function lineDetails(variantLabel: string, choices: { groupName?: string; group?: string; label?: string; choice?: string }[]) {
  return [variantLabel !== 'Regular' ? variantLabel : null, ...choices.map((c) => c.label ?? c.choice)].filter(Boolean).join(' · ')
}

/** Cart lines grouped by store, with live sold-out flags. */
export function CartContents({ onNavigate, compact }: { onNavigate?: () => void; compact?: boolean }) {
  const view = useCartView()
  const setQuantity = useCart((s) => s.setQuantity)
  const remove = useCart((s) => s.remove)
  const cat = useCatalog()
  const navigate = useNavigate()

  if (view.lines.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title="Your cart is empty"
        action={
          <Button
            onClick={() => {
              onNavigate?.()
              navigate('/#stores')
            }}
          >
            Browse stores <ArrowRight />
          </Button>
        }
      >
        Busog-lusog awaits! Add something yummy from our 13 partner stores.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      {view.hasIssues && (
        <div className="flex gap-2 rounded-xl border border-brand-red/30 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>Some items are no longer available. Please remove them before checking out.</p>
        </div>
      )}
      {view.byStore.map((group) => (
        <section key={group.storeId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70">
          <header className="mb-1 flex items-center justify-between gap-2">
            <Link
              to={`/store/${group.storeSlug}`}
              onClick={onNavigate}
              className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase tracking-wide text-navy/55 hover:text-brand-600"
            >
              <StoreIcon className="size-3.5 shrink-0 text-brand-600" />
              <span className="truncate">{group.storeName}</span>
            </Link>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-navy/55">{peso(group.subtotalCents / 100)}</span>
          </header>
          <ul className="divide-y divide-sand">
            {group.lines.map(({ line, unitPrice, issue }) => (
              <li key={line.key} className="flex gap-3 py-3.5 last:pb-0">
                <SmartImage
                  src={line.imageUrl ?? cat.storeById.get(line.storeId)?.cover_image_url}
                  alt=""
                  className={cn('size-16 shrink-0 rounded-xl object-top ring-1 ring-sand-200', issue && 'grayscale')}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-semibold leading-snug', issue && 'text-navy/50 line-through')}>{line.productName}</p>
                  <p className="text-xs text-navy/55">
                    {line.sectionName && line.sectionName !== line.productName ? `${line.sectionName} · ` : ''}
                    {lineDetails(line.variantLabel, line.choices)}
                    {line.extraToppings ? ' · Extra toppings' : ''}
                  </p>
                  {issue ? (
                    <p className="mt-1.5 inline-flex rounded-full bg-brand-red px-2 py-0.5 text-[11px] font-bold uppercase text-white">{issue}</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <QuantityStepper size="sm" value={line.quantity} onChange={(n) => setQuantity(line.key, n)} />
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-brand-600">{peso(unitPrice * line.quantity)}</p>
                        {line.quantity > 1 && <p className="text-[11px] tabular-nums text-navy/50">{peso(unitPrice)} each</p>}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(line.key)}
                  className="flex size-9 shrink-0 items-center justify-center self-start rounded-full text-navy/55 transition hover:bg-red-50 hover:text-brand-red"
                  aria-label={`Remove ${line.productName}`}
                  title="Remove"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!compact && <CartTotals />}
    </div>
  )
}

export function CartTotals() {
  const view = useCartView()
  return (
    <div className="space-y-2.5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sand-200/70">
      <div className="flex justify-between text-sm">
        <span className="text-navy/65">
          Subtotal ({view.count} {view.count === 1 ? 'item' : 'items'})
        </span>
        <span className="font-semibold tabular-nums">{peso(view.subtotalCents / 100)}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-navy/65">Delivery Fee</span>
        <span className="font-medium text-navy/55">To be confirmed</span>
      </div>
      <div className="flex justify-between border-t border-sand pt-3 font-heading text-lg font-bold">
        <span>Grand total</span>
        <span className="tabular-nums">{peso(view.subtotalCents / 100)}</span>
      </div>
      <p className="text-xs leading-relaxed text-navy/55">{FEE_NOTE}</p>
    </div>
  )
}

export function CartSheet() {
  const { open, setOpen } = useCartUI()
  const view = useCartView()
  const navigate = useNavigate()
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <SheetContent title={`Cart (${view.count})`}>
        <div className="flex-1 overflow-y-auto p-4">
          <CartContents compact onNavigate={() => setOpen(false)} />
        </div>
        {view.lines.length > 0 && (
          <div className="space-y-2.5 border-t border-sand bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="flex justify-between text-sm">
              <span className="text-navy/65">Subtotal</span>
              <span className="font-semibold tabular-nums">{peso(view.subtotalCents / 100)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-navy/65">Delivery Fee</span>
              <span className="text-navy/55">To be confirmed</span>
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={view.hasIssues}
              onClick={() => {
                setOpen(false)
                navigate('/checkout')
              }}
            >
              Proceed to Checkout · {peso(view.subtotalCents / 100)} <ArrowRight />
            </Button>
            {view.hasIssues && <p className="text-center text-xs text-brand-red">Remove unavailable items to continue.</p>}
            <p className="text-center text-[11px] leading-snug text-navy/50">{FEE_NOTE}</p>
          </div>
        )}
      </SheetContent>
    </Dialog>
  )
}
