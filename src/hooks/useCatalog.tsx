import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import type { HubCategory, MenuSection, OptionChoice, OptionGroup, Product, Store, Variant } from '@/lib/types'
import { useCart, type CartLine } from '@/store/cart'
import { toCents } from '@/lib/utils'

interface CatalogData {
  categories: HubCategory[]
  stores: Store[]
  sections: MenuSection[]
  products: Product[]
  variants: Variant[]
  groups: OptionGroup[]
  choices: OptionChoice[]
}

export interface Catalog extends CatalogData {
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  storeBySlug: Map<string, Store>
  storeById: Map<string, Store>
  sectionById: Map<string, MenuSection>
  productById: Map<string, Product>
  variantById: Map<string, Variant>
  categoryById: Map<string, HubCategory>
  sectionsByStore: Map<string, MenuSection[]>
  productsBySection: Map<string, Product[]>
  productsByStore: Map<string, Product[]>
  variantsByProduct: Map<string, Variant[]>
  groupsByProduct: Map<string, OptionGroup[]>
  choicesByGroup: Map<string, OptionChoice[]>
  patch: <K extends 'stores' | 'products' | 'variants'>(table: K, id: string, values: Partial<CatalogData[K][number]>) => void
}

const empty: CatalogData = { categories: [], stores: [], sections: [], products: [], variants: [], groups: [], choices: [] }
const CatalogContext = createContext<Catalog | null>(null)

/** PostgREST caps responses at 1000 rows; page through to be safe. */
async function fetchAll<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order(order).range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

const num = <T extends object>(rows: T[], keys: (keyof T)[]) =>
  rows.map((r) => {
    const o = { ...r }
    for (const k of keys) if (o[k] !== null && o[k] !== undefined) (o[k] as unknown) = Number(o[k])
    return o
  })

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CatalogData>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!supabaseConfigured) {
      setError('The store is not connected yet. Please set up Supabase (see README).')
      setLoading(false)
      return
    }
    try {
      const [categories, stores, sections, products, variants, groups, choices] = await Promise.all([
        fetchAll<HubCategory>('hub_categories', 'sort'),
        fetchAll<Store>('stores', 'sort'),
        fetchAll<MenuSection>('menu_sections', 'sort'),
        fetchAll<Product>('products', 'sort'),
        fetchAll<Variant>('product_variants', 'sort'),
        fetchAll<OptionGroup>('option_groups', 'id'),
        fetchAll<OptionChoice>('option_choices', 'sort'),
      ])
      setData({
        categories,
        stores,
        sections,
        products,
        variants: num(variants, ['price', 'addon_price']),
        groups,
        choices: num(choices, ['price_delta']),
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message || 'Could not load the menu.')
    } finally {
      setLoading(false)
    }
  }, [])

  const patch = useCallback<Catalog['patch']>((table, id, values) => {
    setData((d) => ({
      ...d,
      [table]: (d[table] as { id: string }[]).map((r) => (r.id === id ? { ...r, ...values } : r)),
    }))
  }, [])

  useEffect(() => {
    void reload()
    if (!supabaseConfigured) return
    // Live: sold-out toggles, badges, photos and store availability.
    const channel = supabase
      .channel('catalog-live')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, (p) =>
        patch('products', (p.new as Product).id, p.new as Product),
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'product_variants' }, (p) => {
        const v = p.new as Variant
        patch('variants', v.id, { ...v, price: Number(v.price), addon_price: v.addon_price === null ? null : Number(v.addon_price) })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stores' }, (p) =>
        patch('stores', (p.new as Store).id, p.new as Store),
      )
      .subscribe()
    // Safety net if the realtime socket drops (e.g. phone asleep).
    const onVisible = () => document.visibilityState === 'visible' && void reload()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload, patch])

  const value = useMemo<Catalog>(() => {
    const products = [...data.products].sort(bySort)
    return {
      ...data,
      products,
      loading,
      error,
      reload,
      patch,
      storeBySlug: new Map(data.stores.map((s) => [s.slug, s])),
      storeById: new Map(data.stores.map((s) => [s.id, s])),
      sectionById: new Map(data.sections.map((s) => [s.id, s])),
      productById: new Map(data.products.map((p) => [p.id, p])),
      variantById: new Map(data.variants.map((v) => [v.id, v])),
      categoryById: new Map(data.categories.map((c) => [c.id, c])),
      sectionsByStore: groupBy([...data.sections].sort(bySort), (s) => s.store_id),
      productsBySection: groupBy(products, (p) => p.section_id),
      productsByStore: groupBy(products, (p) => p.store_id),
      variantsByProduct: groupBy([...data.variants].sort(bySort), (v) => v.product_id),
      groupsByProduct: groupBy(data.groups, (g) => g.product_id),
      choicesByGroup: groupBy([...data.choices].sort(bySort), (c) => c.group_id),
    }
  }, [data, loading, error, reload, patch])

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): Catalog {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error('useCatalog must be used inside CatalogProvider')
  return ctx
}

// ---------------------------------------------------------------------
// Cart ↔ catalog: live availability + display prices
// ---------------------------------------------------------------------
export interface CartViewLine {
  line: CartLine
  unitPrice: number
  issue: string | null
}

export interface CartView {
  lines: CartViewLine[]
  byStore: { storeId: string; storeName: string; storeSlug: string; lines: CartViewLine[]; subtotalCents: number }[]
  subtotalCents: number
  count: number
  hasIssues: boolean
}

export function useCartView(): CartView {
  const items = useCart((s) => s.items)
  const cat = useCatalog()
  return useMemo(() => {
    const ready = !cat.loading && !cat.error
    const lines: CartViewLine[] = items.map((line) => {
      const variant = cat.variantById.get(line.variantId)
      const product = cat.productById.get(line.productId)
      const store = cat.storeById.get(line.storeId)
      if (!ready) return { line, unitPrice: line.unitPrice, issue: null }
      if (!variant || !product || !store) return { line, unitPrice: line.unitPrice, issue: 'No longer available' }
      let cents = toCents(variant.price) + (line.extraToppings ? toCents(variant.addon_price ?? 0) : 0)
      for (const c of line.choices) {
        const choice = cat.choices.find((x) => x.id === c.choiceId)
        cents += toCents(choice?.price_delta ?? c.priceDelta)
      }
      const issue = !store.is_accepting_orders
        ? 'Store temporarily unavailable'
        : product.is_sold_out || variant.is_sold_out
          ? 'Sold out'
          : null
      return { line, unitPrice: cents / 100, issue }
    })
    const byStoreMap = new Map<string, CartView['byStore'][number]>()
    for (const l of lines) {
      const g = byStoreMap.get(l.line.storeId) ?? {
        storeId: l.line.storeId,
        storeName: l.line.storeName,
        storeSlug: l.line.storeSlug,
        lines: [],
        subtotalCents: 0,
      }
      g.lines.push(l)
      g.subtotalCents += toCents(l.unitPrice) * l.line.quantity
      byStoreMap.set(l.line.storeId, g)
    }
    const byStore = [...byStoreMap.values()]
    return {
      lines,
      byStore,
      subtotalCents: byStore.reduce((n, g) => n + g.subtotalCents, 0),
      count: lines.reduce((n, l) => n + l.line.quantity, 0),
      hasIssues: lines.some((l) => l.issue),
    }
  }, [items, cat])
}
