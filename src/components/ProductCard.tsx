import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Plus } from 'lucide-react'
import type { Catalog } from '@/hooks/useCatalog'
import type { MenuSection, Product, Store } from '@/lib/types'
import { cn, peso, toCents } from '@/lib/utils'
import { useCart } from '@/store/cart'
import { Button } from './ui/button'
import { Checkbox, Chip, QuantityStepper } from './ui/controls'
import { ProductBadge, SmartImage } from './common'
import { useCartUI } from './Cart'

export function ProductCard({
  product,
  store,
  section,
  catalog,
  highlight,
}: {
  product: Product
  store: Store
  section: MenuSection
  catalog: Catalog
  highlight?: boolean
}) {
  const variants = catalog.variantsByProduct.get(product.id) ?? []
  const groups = catalog.groupsByProduct.get(product.id) ?? []
  const add = useCart((s) => s.add)
  const openCart = useCartUI((s) => s.setOpen)

  const firstAvailable = variants.find((v) => !v.is_sold_out) ?? variants[0]
  const [variantId, setVariantId] = useState<string | undefined>(firstAvailable?.id)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState(false)
  const [qty, setQty] = useState(1)
  const [justAdded, setJustAdded] = useState(false)

  // If the selected variant sells out while viewing, move to one that's available.
  const variant = variants.find((v) => v.id === variantId && !v.is_sold_out) ?? firstAvailable
  const productSoldOut = product.is_sold_out || variants.every((v) => v.is_sold_out)
  const unavailable = !store.is_accepting_orders
  const hasAddon = variants.some((v) => v.addon_price !== null)
  const missingGroup = groups.find((g) => g.is_required && !choices[g.id])

  const unitCents = useMemo(() => {
    if (!variant) return 0
    let c = toCents(variant.price) + (extra && variant.addon_price !== null ? toCents(variant.addon_price) : 0)
    for (const g of groups) {
      const ch = (catalog.choicesByGroup.get(g.id) ?? []).find((x) => x.id === choices[g.id])
      if (ch) c += toCents(ch.price_delta)
    }
    return c
  }, [variant, extra, groups, choices, catalog.choicesByGroup])

  const disabled = productSoldOut || unavailable || !variant || variant.is_sold_out

  function handleAdd() {
    if (disabled || !variant) return
    if (missingGroup) {
      toast.error(`Please choose a ${missingGroup.name.toLowerCase()} first.`)
      return
    }
    add({
      storeId: store.id,
      storeSlug: store.slug,
      storeName: store.name,
      sectionName: section.name,
      productId: product.id,
      productName: product.name,
      variantId: variant.id,
      variantLabel: variant.label,
      choices: groups
        .filter((g) => choices[g.id])
        .map((g) => {
          const ch = (catalog.choicesByGroup.get(g.id) ?? []).find((x) => x.id === choices[g.id])!
          return { groupId: g.id, groupName: g.name, choiceId: ch.id, label: ch.label, priceDelta: Number(ch.price_delta) }
        }),
      extraToppings: extra && variant.addon_price !== null,
      unitPrice: unitCents / 100,
      quantity: qty,
      imageUrl: product.image_url,
    })
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 1400)
    toast.success(`Added ${qty} × ${product.name}`, {
      action: { label: 'View cart', onClick: () => openCart(true) },
    })
    setQty(1)
  }

  const fromPrice = Math.min(...variants.map((v) => Number(v.price)))

  return (
    <article
      id={`product-${product.id}`}
      className={cn(
        'relative flex scroll-mt-36 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 transition-shadow hover:shadow-lg hover:shadow-navy/10',
        highlight ? 'ring-2 ring-brand' : 'ring-sand-200/70',
        productSoldOut && 'opacity-75',
      )}
    >
      {productSoldOut && (
        <div className="pointer-events-none absolute right-[-38px] top-[18px] z-10 w-[150px] rotate-45 bg-brand-red py-1 text-center text-xs font-extrabold tracking-widest text-white shadow">
          SOLD OUT
        </div>
      )}
      {product.image_url && (
        <SmartImage src={product.image_url} alt={product.name} className={cn('aspect-[16/10] w-full', productSoldOut && 'grayscale')} />
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ProductBadge badge={product.badge} />
          </div>
          <h3 className={cn('mt-1 font-heading text-base font-bold leading-snug', productSoldOut && 'text-navy/50')}>{product.name}</h3>
          {product.description && <p className="mt-1 text-sm text-navy/65">{product.description}</p>}
          {variants.length > 1 && (
            <p className="mt-1 text-xs font-medium text-navy/50">from {peso(fromPrice)}</p>
          )}
        </div>

        {variants.length > 1 && (
          <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-1.5">
            {variants.map((v) => (
              <Chip
                key={v.id}
                selected={variant?.id === v.id}
                disabled={v.is_sold_out || productSoldOut}
                onClick={() => setVariantId(v.id)}
                className="text-xs sm:text-sm"
                title={v.is_sold_out ? 'Sold out' : undefined}
              >
                <span className={cn(v.is_sold_out && 'line-through')}>{v.label}</span>
                <span className={cn('tabular-nums', variant?.id === v.id ? 'text-navy/75' : 'text-navy/55')}>{peso(v.price)}</span>
                {v.is_sold_out && <span className="text-[10px] font-bold uppercase text-brand-red">Sold out</span>}
              </Chip>
            ))}
          </div>
        )}

        {groups.map((g) => (
          <div key={g.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-navy/60">
              {g.name}
              {g.is_required && <span className="ml-1 normal-case text-brand-red">(choose 1)</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(catalog.choicesByGroup.get(g.id) ?? []).map((c) => (
                <Chip
                  key={c.id}
                  selected={choices[g.id] === c.id}
                  disabled={productSoldOut}
                  onClick={() => setChoices((s) => ({ ...s, [g.id]: c.id }))}
                  className="text-xs sm:text-sm"
                >
                  {c.label}
                  {Number(c.price_delta) > 0 && <span className="text-navy/55">+{peso(c.price_delta)}</span>}
                </Chip>
              ))}
            </div>
          </div>
        ))}

        {hasAddon && variant?.addon_price !== null && variant?.addon_price !== undefined && (
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-brand/50 bg-[#fdf3e3] px-3 py-2.5 text-sm">
            <Checkbox checked={extra} onCheckedChange={(v) => setExtra(v === true)} disabled={productSoldOut} />
            <span className="flex-1 font-medium">Add Extra Toppings</span>
            <span className="font-semibold tabular-nums text-brand-600">+{peso(variant.addon_price)}</span>
          </label>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div>
            <p className="font-heading text-xl font-bold tabular-nums text-brand-600">{peso((unitCents * qty) / 100)}</p>
            {qty > 1 && <p className="text-xs text-navy/50 tabular-nums">{peso(unitCents / 100)} each</p>}
          </div>
          <QuantityStepper size="sm" value={qty} onChange={setQty} disabled={disabled} />
        </div>
        <Button onClick={handleAdd} disabled={disabled} className="w-full" aria-disabled={!!missingGroup}>
          {productSoldOut ? (
            'Sold Out'
          ) : unavailable ? (
            'Temporarily unavailable'
          ) : justAdded ? (
            <>
              <Check /> Added!
            </>
          ) : (
            <>
              <Plus /> Add to Cart
            </>
          )}
        </Button>
        {missingGroup && !disabled && (
          <p className="-mt-1.5 text-center text-xs text-navy/55">Choose a {missingGroup.name.toLowerCase()} to continue</p>
        )}
      </div>
    </article>
  )
}
