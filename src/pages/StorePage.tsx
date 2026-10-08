import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Clock, Info, MapPin, MessageCircle, Store as StoreIcon } from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import { cn, formatHours, isOpenNow } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { Disclaimer, EmptyState, Lightbox, SmartImage } from '@/components/common'
import { ProductCard } from '@/components/ProductCard'

export default function StorePage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const focusProduct = params.get('p')
  const cat = useCatalog()
  const store = cat.storeBySlug.get(slug)
  const sections = store ? (cat.sectionsByStore.get(store.id) ?? []) : []
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (store) document.title = `${store.name} · MGL Food Hub`
    return () => {
      document.title = 'MGL Food Hub · Scheduled Food Delivery'
    }
  }, [store])

  // Highlight the section in view.
  useEffect(() => {
    if (!sections.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id.replace('section-', ''))
      },
      { rootMargin: '-140px 0px -60% 0px' },
    )
    sections.forEach((s) => {
      const el = document.getElementById(`section-${s.id}`)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [sections])

  // Keep the active tab visible in the scrolling tab bar.
  useEffect(() => {
    if (!active) return
    const tab = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`)
    tab?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])

  // Deep link from search: scroll to the product.
  useEffect(() => {
    if (!focusProduct || cat.loading) return
    const t = setTimeout(() => document.getElementById(`product-${focusProduct}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250)
    return () => clearTimeout(t)
  }, [focusProduct, cat.loading])

  if (cat.loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        <Skeleton className="h-52 w-full rounded-3xl" />
        <Skeleton className="h-10 w-2/3" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!store) {
    return (
      <EmptyState icon={<StoreIcon />} title="Store not found" action={<Button asChild><Link to="/">See all stores</Link></Button>}>
        This store may have moved. Balik tayo sa listahan?
      </EmptyState>
    )
  }

  const open = isOpenNow(store.open_time, store.close_time)
  const category = cat.categoryById.get(store.hub_category_id)

  return (
    <div>
      {/* Header — light rounded hero card, like the reference */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-navy/70 hover:text-brand-600">
          <ArrowLeft className="size-4" /> All stores
        </Link>
        <section className="relative mt-3 overflow-hidden rounded-[2rem] bg-[#fdf3e3]">
          <div className="pointer-events-none absolute -right-20 top-0 hidden h-full w-[40%] rounded-l-[45%] bg-[#f6dcae] sm:block" />
          <div className="relative flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:p-8">
            <div className="min-w-0 flex-1 animate-fade-up">
              {category && <p className="text-xs font-semibold uppercase tracking-[0.25em] text-navy/60">{category.name}</p>}
              <h1 className="mt-2 font-display text-[2.2rem] font-bold leading-tight sm:text-5xl">{store.name}</h1>
              {store.tagline && <p className="mt-2 text-navy/70">{store.tagline}</p>}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-navy/75">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" /> {formatHours(store.open_time, store.close_time)}
                  <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[11px] font-bold', open ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-navy/55')}>
                    {open ? 'Open now' : 'Closed now'}
                  </span>
                </span>
                {store.address && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-4" /> {store.address}
                  </span>
                )}
                {store.contact_note && (
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle className="size-4" /> {store.contact_note}
                  </span>
                )}
              </div>
              <Button size="md" className="mt-5" onClick={() => setMenuOpen(true)}>
                <BookOpen /> View original menu
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="group relative mx-auto w-40 shrink-0 -rotate-3 overflow-hidden rounded-3xl shadow-xl shadow-navy/15 ring-4 ring-white transition-transform hover:rotate-0 sm:mx-0 sm:w-48"
              aria-label="View original menu"
            >
              <SmartImage src={store.menu_image_url} alt={`${store.name} menu`} className="aspect-[3/4] w-full object-top" />
              <span className="absolute inset-x-0 bottom-0 bg-navy/80 py-1.5 text-center text-[11px] font-semibold text-white">Tap to view menu</span>
            </button>
          </div>
        </section>
      </div>

      {!store.is_accepting_orders && (
        <div className="mx-auto mt-4 max-w-6xl px-4"><div className="rounded-2xl bg-brand-red px-4 py-3 text-center text-sm font-semibold text-white">
          {store.name} is temporarily unavailable. You can browse the menu, but items can't be added right now.
        </div></div>
      )}

      {/* Sticky section tabs */}
      {sections.length > 1 && (
        <div className="sticky top-16 z-30 mt-4 md:top-[68px] border-b border-sand-200/70 bg-cream/95 backdrop-blur">
          <div ref={tabsRef} className="mx-auto flex max-w-6xl gap-1.5 overflow-x-auto px-4 py-2.5 scrollbar-none">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#section-${s.id}`}
                data-tab={s.id}
                onClick={(e) => {
                  e.preventDefault()
                  document.getElementById(`section-${s.id}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors',
                  active === s.id ? 'bg-brand text-navy shadow-sm' : 'bg-white text-navy/70 ring-1 ring-sand-200 hover:text-brand-600',
                )}
              >
                {s.name}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-6">
        {sections.map((section) => {
          const products = cat.productsBySection.get(section.id) ?? []
          return (
            <section key={section.id} id={`section-${section.id}`} className="scroll-mt-32">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl font-bold sm:text-3xl">{section.name}</h2>
                <span className="shrink-0 text-xs text-navy/50">{products.length} {products.length === 1 ? 'item' : 'items'}</span>
              </div>
              {section.note && (
                <p className="mb-3 flex items-center gap-1.5 text-sm text-navy/65">
                  <Info className="size-4 text-brand-600" /> {section.note}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} store={store} section={section} catalog={cat} highlight={p.id === focusProduct} />
                ))}
              </div>
            </section>
          )
        })}
        <Disclaimer />
      </div>

      <Lightbox open={menuOpen} onOpenChange={setMenuOpen} src={store.menu_image_url} title={`${store.name} · Original menu`} />
    </div>
  )
}
