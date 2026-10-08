import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight, Banknote, Beef, CakeSlice, CalendarClock, ChevronRight, Clock, CookingPot, Flame, LayoutGrid, MapPin, Radio, Sandwich,
  Search, ShieldCheck, Soup, Store as StoreIcon, Truck, UtensilsCrossed, X, type LucideIcon,
} from 'lucide-react'
import { useCatalog } from '@/hooks/useCatalog'
import type { Store } from '@/lib/types'
import { cn, formatHours, isOpenNow, peso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/controls'
import { EmptyState, ErrorBanner, SmartImage } from '@/components/common'
import { Logo } from '@/components/Logo'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const CATEGORY_ICON: Record<string, LucideIcon> = {
  'puto-kakanin': CakeSlice,
  'pancit-bilao': Soup,
  restaurants: UtensilsCrossed,
  carinderia: CookingPot,
  'merienda-street-food': Sandwich,
  diner: Beef,
  'sisig-crispy-favorites': Flame,
}

export default function Home() {
  const cat = useCatalog()
  const [params, setParams] = useSearchParams()
  const [category, setCategory] = useState<string>('all')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const searchRef = useRef<HTMLInputElement>(null)

  // Footer category links use ?cat=<slug>
  useEffect(() => {
    const slug = params.get('cat')
    if (!slug || !cat.categories.length) return
    const found = cat.categories.find((c) => c.slug === slug)
    if (found) setCategory(found.id)
    const next = new URLSearchParams(params)
    next.delete('cat')
    setParams(next, { replace: true })
  }, [params, cat.categories, setParams])

  const stores = useMemo(
    () => cat.stores.filter((s) => category === 'all' || s.hub_category_id === category),
    [cat.stores, category],
  )

  const results = useMemo(() => {
    if (q.length < 2) return []
    const terms = norm(q).split(/\s+/)
    return cat.products
      .map((p) => {
        const store = cat.storeById.get(p.store_id)!
        const section = cat.sectionById.get(p.section_id)
        const hay = norm(`${p.name} ${section?.name ?? ''} ${store?.name ?? ''} ${p.description ?? ''}`)
        return { p, store, section, hit: terms.every((t) => hay.includes(t)) }
      })
      .filter((r) => r.hit && r.store)
      .slice(0, 40)
  }, [q, cat])

  const goToStores = () => document.getElementById('stores')?.scrollIntoView({ behavior: 'smooth' })
  const pickCategory = (id: string) => {
    setCategory(id)
    setQuery('')
    requestAnimationFrame(goToStores)
  }
  const activeCategory = cat.categoryById.get(category)

  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* ------------------------------------------------------------ Hero */}
      <section className="relative mt-4 overflow-hidden rounded-[2rem] bg-[#fdf3e3] sm:mt-6">
        <div className="pointer-events-none absolute -right-24 top-0 hidden h-full w-[55%] rounded-l-[45%] bg-[#f6dcae] md:block" />
        <div className="relative grid grid-cols-1 items-center gap-8 px-5 py-10 sm:px-10 sm:py-14 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-navy/70">Scheduled Food Delivery</p>
            <h1 className="mt-4 font-display text-[2.4rem] font-bold leading-[1.06] text-navy sm:text-[3rem] lg:text-[3.35rem]">
              Malabon's favorites,
              <br />
              delivered
              <br />
              <span className="text-brand-600">on schedule.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-navy/70">
              Puto, pancit bilao, crispy pata and lutong bahay ulam from the stores you love. Pick a date, pick a time, and we'll handle the rest.
            </p>

            {/* Search pill (reference: address input with round arrow button) */}
            <form
              className="mt-7 flex max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-lg shadow-navy/5 ring-1 ring-sand-200"
              onSubmit={(e) => {
                e.preventDefault()
                goToStores()
              }}
            >
              <Search className="size-5 shrink-0 text-brand-600" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search puto, crispy pata, sisig…"
                className="h-11 min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-navy/40 focus:outline-none"
                aria-label="Search all products"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="rounded-full p-1.5 text-navy/45 hover:bg-sand" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              )}
              <button type="submit" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-navy transition hover:bg-[#f9a23a] active:scale-95" aria-label="Show results">
                <ArrowRight className="size-5" />
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" className="w-full px-4 text-[15px] sm:w-auto sm:px-7 sm:text-base" onClick={goToStores}>
                <CalendarClock /> Order Now · Scheduled Delivery
              </Button>
              <Button size="lg" variant="outline" className="w-full border-navy/15 bg-transparent sm:w-auto" asChild>
                <Link to="/my-orders">Track my order</Link>
              </Button>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3 text-sm text-navy/80">
              {[
                { icon: Truck, t: 'Scheduled Delivery' },
                { icon: Banknote, t: 'COD or Online Payment' },
                { icon: ShieldCheck, t: 'Private order tracking' },
              ].map(({ icon: Icon, t }) => (
                <li key={t} className="flex items-center gap-2">
                  <Icon className="size-5 text-navy" strokeWidth={1.6} /> {t}
                </li>
              ))}
            </ul>
          </div>

          <HeroCollage stores={cat.stores} />
        </div>
      </section>

      {/* ------------------------------------------------------------ Categories */}
      <section className="mt-10" aria-label="Categories">
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 scrollbar-none sm:gap-6 lg:justify-between">
          <CategoryTile icon={LayoutGrid} label="All stores" active={category === 'all'} onClick={() => pickCategory('all')} />
          {cat.categories.map((c) => (
            <CategoryTile
              key={c.id}
              icon={CATEGORY_ICON[c.slug] ?? StoreIcon}
              label={c.name}
              active={category === c.id}
              onClick={() => pickCategory(c.id)}
            />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ Stores / search results */}
      <section id="stores" className="mt-12 scroll-mt-24">
        {cat.error && <ErrorBanner className="mb-6">{cat.error}</ErrorBanner>}

        {q.length >= 2 ? (
          <div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <h2 className="font-display text-3xl font-bold sm:text-4xl">
                {results.length ? `Results for “${q}”` : `No results for “${q}”`}
              </h2>
              <button type="button" onClick={() => setQuery('')} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-600">
                Clear search <X className="size-4" />
              </button>
            </div>
            {results.length === 0 ? (
              <EmptyState icon={<Search />} title="Wala kaming nahanap">Try another word, like “puto” or “pancit”.</EmptyState>
            ) : (
              <ul className="divide-y divide-sand overflow-hidden rounded-2xl border border-sand-200/70 bg-white">
                {results.map(({ p, store, section }) => {
                  const variants = cat.variantsByProduct.get(p.id) ?? []
                  const from = Math.min(...variants.map((v) => Number(v.price)))
                  return (
                    <li key={p.id}>
                      <Link to={`/store/${store.slug}?p=${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-cream">
                        <SmartImage src={store.cover_image_url} alt="" className="hidden size-12 shrink-0 rounded-xl object-top min-[360px]:block" />
                        <div className="min-w-0 flex-1">
                          <p className={cn('font-semibold', p.is_sold_out && 'text-navy/45 line-through')}>{p.name}</p>
                          <p className="truncate text-xs text-navy/55">
                            {store.name} · {section?.name}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {p.is_sold_out ? <span className="text-brand-red">Sold out</span> : `${variants.length > 1 ? 'from ' : ''}${peso(from)}`}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-navy/30" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-3xl font-bold sm:text-4xl">{activeCategory ? activeCategory.name : 'Our Partner Stores'}</h2>
                <p className="mt-1 text-sm text-navy/55">{stores.length} {stores.length === 1 ? 'store' : 'stores'} · schedule your delivery from tomorrow</p>
              </div>
              {category !== 'all' && (
                <button type="button" onClick={() => setCategory('all')} className="flex items-center gap-1.5 text-sm font-medium text-navy hover:text-brand-600">
                  View All <ArrowRight className="size-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
              {cat.loading
                ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)
                : stores.map((s, i) => <StoreCard key={s.id} store={s} index={i} category={cat.categoryById.get(s.hub_category_id)?.name} />)}
            </div>
            {!cat.loading && stores.length === 0 && !cat.error && <EmptyState title="No stores in this category yet" />}
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ Promo banner */}
      <section className="relative mt-14 overflow-hidden rounded-[2rem] bg-[#fbe6c4]">
        <div className="grid grid-cols-1 items-center md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative z-10 px-6 py-10 sm:px-10">
            <h2 className="font-display text-3xl font-bold leading-tight sm:text-[2.6rem]">
              Order from every store,
              <br />
              pay one delivery fee.
            </h2>
            <p className="mt-3 max-w-sm text-navy/70">Mix puto, pancit bilao and crispy pata from different merchants in one order.</p>
            <Button size="lg" className="mt-6" onClick={goToStores}>
              Start your order <ArrowRight />
            </Button>
          </div>
          <div className="relative h-56 md:h-full md:min-h-72">
            <SmartImage
              src={cat.storeBySlug.get('okoy-ni-jay-r')?.cover_image_url}
              alt="Okoy"
              className="absolute inset-0 h-full w-full object-[50%_82%] md:rounded-l-[45%]"
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ Feature strip */}
      <section className="mt-10 grid grid-cols-1 gap-4 rounded-[2rem] bg-white/70 p-5 ring-1 ring-sand-200/70 sm:grid-cols-2 sm:p-7 lg:grid-cols-4">
        {[
          { icon: CalendarClock, t: 'Scheduled Delivery', d: 'Book for tomorrow or any day within 30 days.' },
          { icon: Banknote, t: 'COD or Online Payment', d: 'Pay cash to the rider or send via GCash, MariBank or GoTyme.' },
          { icon: Radio, t: 'Live Order Tracking', d: 'Your own private link shows every update.' },
          { icon: StoreIcon, t: 'One Delivery Fee', d: 'Order from all 13 merchants in one go.' },
        ].map(({ icon: Icon, t, d }) => (
          <div key={t} className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sand text-brand-600">
              <Icon className="size-5" strokeWidth={1.8} />
            </span>
            <div>
              <p className="font-heading text-sm font-semibold">{t}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-navy/55">{d}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

/** Shows one region of a (tall, text-heavy) menu photo — e.g. just the food shot. */
function CropImage({ src, size, position, className }: { src: string | null | undefined; size: string; position: string; className?: string }) {
  return (
    <div
      className={cn('bg-sand bg-no-repeat', className)}
      style={src ? { backgroundImage: `url('${src}')`, backgroundSize: size, backgroundPosition: position } : undefined}
    />
  )
}

/** Food photos from the stores' own menus, arranged like the reference hero image. */
function HeroCollage({ stores }: { stores: Store[] }) {
  const img = (slug: string) => stores.find((s) => s.slug === slug)?.cover_image_url
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-lg md:block" aria-hidden>
      <div className="absolute inset-[6%] overflow-hidden rounded-full shadow-2xl shadow-navy/25 ring-8 ring-white">
        <CropImage src={img('rody-days')} size="215% auto" position="50% 0%" className="h-full w-full" />
      </div>
      <div className="absolute bottom-[2%] left-[-2%] w-[36%] -rotate-6 overflow-hidden rounded-3xl shadow-xl ring-4 ring-white">
        <CropImage src={img('hazels-special-puto')} size="230% auto" position="4% 64%" className="aspect-square w-full" />
      </div>
      <div className="absolute right-[6%] top-[2%] flex size-24 items-center justify-center rounded-full bg-white p-3 shadow-lg">
        <Logo className="h-16" />
      </div>
      <p className="absolute left-[4%] top-[2%] -rotate-12 font-script text-3xl leading-none text-navy">
        Fresh
        <br />& Tasty
      </p>
    </div>
  )
}

function CategoryTile({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="group flex w-24 shrink-0 flex-col items-center text-center sm:w-28">
      <span
        className={cn(
          'flex size-20 items-center justify-center rounded-full transition-all sm:size-24',
          active ? 'bg-brand text-navy shadow-lg shadow-brand/30' : 'bg-sand text-brand-600 group-hover:bg-sand-200',
        )}
      >
        <Icon className="size-8 sm:size-9" strokeWidth={1.6} />
      </span>
      <span className="mt-3 text-sm font-semibold leading-tight text-navy">{label}</span>
      <span className={cn('mt-1 flex items-center gap-1 text-xs', active ? 'text-brand-600' : 'text-navy/50 group-hover:text-brand-600')}>
        Shop Now <ArrowRight className="size-3" />
      </span>
    </button>
  )
}

function StoreCard({ store, category, index }: { store: Store; category?: string; index: number }) {
  const open = isOpenNow(store.open_time, store.close_time)
  return (
    <Link
      to={`/store/${store.slug}`}
      className="group flex flex-row overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-sand-200/70 sm:flex-col transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-navy/10 animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div className="relative w-28 shrink-0 overflow-hidden sm:w-auto">
        <SmartImage
          src={store.cover_image_url}
          alt={store.name}
          fallbackLabel={store.name}
          className={cn('h-full w-full object-top transition-transform sm:aspect-[4/3] sm:h-auto duration-500 group-hover:scale-105', !store.is_accepting_orders && 'grayscale')}
        />
        {!store.is_accepting_orders && (
          <span className="absolute inset-x-2 bottom-2 rounded-full bg-brand-red px-2 py-1 text-center text-[10px] font-bold leading-tight text-white shadow sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:px-2.5 sm:text-[11px]">Temporarily unavailable</span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3.5 sm:gap-1.5 sm:p-4">
        <h3 className="font-heading text-base font-semibold leading-snug group-hover:text-brand-600">{store.name}</h3>
        <p className="truncate text-xs text-navy/55" title={store.tagline ?? undefined}>
          {[category, store.tagline].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-navy/65">
          <Clock className="size-3.5 shrink-0" /> {formatHours(store.open_time, store.close_time)}
        </p>
        {store.address && (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-navy/65">
            <MapPin className="size-3.5 shrink-0" /> <span className="truncate">{store.address}</span>
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', open ? 'text-emerald-600' : 'text-navy/45')}>
            <span className={cn('size-1.5 rounded-full', open ? 'bg-emerald-500' : 'bg-navy/30')} />
            {open ? 'Open now' : 'Closed now'}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
            Open store <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
