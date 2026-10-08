import { Suspense, useEffect, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ArrowRight, Banknote, ClipboardList, Home, Info, Leaf, Search, ShoppingBag, Smartphone, Store as StoreIcon, type LucideIcon } from 'lucide-react'
import { useCartView, useCatalog } from '@/hooks/useCatalog'
import { cn, peso } from '@/lib/utils'
import { Logo } from './Logo'
import { CartSheet, useCartUI } from './Cart'
import { OrderingGuidelines, useGuidelines } from './OrderingGuidelines'
import { DELIVERY_DISCLAIMER, ScheduledNotice } from './common'
import { Skeleton } from './ui/controls'

/** Same rule everywhere so the bars never hide content. */
function useFloatingCartVisible() {
  const { count } = useCartView()
  const { pathname } = useLocation()
  return count > 0 && !['/checkout', '/cart'].includes(pathname) && !/^\/(track|order-placed)/.test(pathname)
}

function CartButton() {
  const { count } = useCartView()
  const setOpen = useCartUI((s) => s.setOpen)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="relative flex size-11 items-center justify-center rounded-full text-navy transition hover:bg-sand active:scale-95"
      aria-label={`Open cart, ${count} items`}
    >
      <ShoppingBag className="size-[22px]" />
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-bold leading-5 text-navy ring-2 ring-white animate-pop"
        >
          {count}
        </span>
      )}
    </button>
  )
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative py-2 text-sm font-medium transition-colors hover:text-navy after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-brand after:transition-transform',
    isActive ? 'text-navy after:scale-x-100' : 'text-navy/65 after:scale-x-0 hover:after:scale-x-100',
  )

function Navbar() {
  const { pathname } = useLocation()
  const openGuidelines = useGuidelines((s) => s.setOpen)
  return (
    <header className="sticky top-0 z-40 border-b border-sand-200/70 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-center gap-3 px-4 md:h-[68px] md:justify-between">
        <Link to="/" className="shrink-0" aria-label="MGL Food Hub home">
          <Logo className="h-11 md:h-12" />
        </Link>

        {/* Desktop / tablet: text links (on phones these live in the bottom bar) */}
        <nav className="hidden items-center gap-6 md:flex lg:gap-8" aria-label="Main">
          <NavLink to="/" end className={() => navLink({ isActive: pathname === '/' })}>
            Home
          </NavLink>
          <Link to="/#stores" className={navLink({ isActive: pathname.startsWith('/store/') })}>
            Stores
          </Link>
          <NavLink to="/my-orders" className={navLink}>
            My Orders
          </NavLink>
          <NavLink to="/find-order" className={navLink}>
            Find my order
          </NavLink>
          <button type="button" onClick={() => openGuidelines(true)} className={navLink({ isActive: false })} aria-label="Ordering guidelines">
            Guidelines
          </button>
        </nav>

        <div className="hidden md:block">
          <CartButton />
        </div>
      </div>
    </header>
  )
}

/** Phones: everything from the navbar moves to a bottom bar — icons only. */
function MobileNav() {
  const { pathname, hash } = useLocation()
  const { count } = useCartView()
  const openCart = useCartUI((s) => s.setOpen)
  const cartOpen = useCartUI((s) => s.open)
  const openGuidelines = useGuidelines((s) => s.setOpen)
  const guidelinesOpen = useGuidelines((s) => s.open)

  const item = (active: boolean) =>
    cn(
      'relative flex h-11 w-11 items-center justify-center rounded-full transition-colors active:scale-95',
      active ? 'bg-brand text-navy shadow-sm shadow-brand/30' : 'text-navy/55 hover:bg-sand hover:text-navy',
    )
  const links: { to: string; label: string; icon: LucideIcon; active: boolean }[] = [
    { to: '/', label: 'Home', icon: Home, active: pathname === '/' && hash !== '#stores' && !cartOpen && !guidelinesOpen },
    { to: '/#stores', label: 'Stores', icon: StoreIcon, active: (pathname.startsWith('/store/') || (pathname === '/' && hash === '#stores')) && !cartOpen && !guidelinesOpen },
  ]
  const after: { to: string; label: string; icon: LucideIcon; active: boolean }[] = [
    { to: '/my-orders', label: 'My orders', icon: ClipboardList, active: (pathname === '/my-orders' || pathname.startsWith('/track/')) && !cartOpen && !guidelinesOpen },
    { to: '/find-order', label: 'Find my order', icon: Search, active: pathname === '/find-order' && !cartOpen && !guidelinesOpen },
  ]

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sand-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_rgba(13,43,78,0.25)] backdrop-blur-md md:hidden"
      aria-label="Main"
    >
      <ul className="mx-auto flex h-16 max-w-md items-center justify-around px-2">
        {links.map(({ to, label, icon: Icon, active }) => (
          <li key={label}>
            <Link to={to} className={item(active)} aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
              <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.9} />
            </Link>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => openCart(true)} className={item(cartOpen)} aria-label={`Cart, ${count} items`} title="Cart">
            <ShoppingBag className="size-[22px]" strokeWidth={cartOpen ? 2.2 : 1.9} />
            {count > 0 && (
              <span
                key={count}
                className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-brand-red px-1 text-[11px] font-bold leading-5 text-white ring-2 ring-white animate-pop"
              >
                {count}
              </span>
            )}
          </button>
        </li>
        {after.map(({ to, label, icon: Icon, active }) => (
          <li key={label}>
            <Link to={to} className={item(active)} aria-label={label} title={label} aria-current={active ? 'page' : undefined}>
              <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.9} />
            </Link>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => openGuidelines(true)} className={item(guidelinesOpen)} aria-label="Ordering guidelines" title="Ordering guidelines">
            <Info className="size-[22px]" strokeWidth={guidelinesOpen ? 2.2 : 1.9} />
          </button>
        </li>
      </ul>
    </nav>
  )
}

function Footer() {
  const { categories } = useCatalog()
  const openGuidelines = useGuidelines((s) => s.setOpen)
  const heading = 'mb-3 font-heading text-sm font-semibold text-white'
  const item = 'block py-1 text-sm text-white/65 transition hover:text-brand'
  return (
    <footer className="mx-auto mt-16 w-full max-w-6xl px-0 sm:px-4 sm:pb-6">
      <div className="relative overflow-hidden bg-navy text-white sm:rounded-3xl">
        <Leaf className="pointer-events-none absolute -bottom-6 -right-6 size-40 rotate-12 text-white/[0.06]" strokeWidth={1} aria-hidden />
        <div className="relative grid grid-cols-2 gap-x-6 gap-y-8 px-6 py-10 sm:px-10 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div className="col-span-2 space-y-4 lg:col-span-1">
            <Logo light className="h-16 rounded-xl p-1.5" />
            <p className="font-script text-2xl text-brand">Good food, on schedule.</p>
            <p className="max-w-xs text-sm text-white/65">13 Malabon favorites in one cart — scheduled delivery straight to your door.</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
                <Banknote className="size-3.5" /> Cash on Delivery
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
                <Smartphone className="size-3.5" /> GCash
              </span>
            </div>
          </div>
          <div>
            <p className={heading}>Quick Links</p>
            <Link to="/" className={item}>Home</Link>
            <Link to="/#stores" className={item}>All stores</Link>
            <Link to="/cart" className={item}>Cart</Link>
            <Link to="/checkout" className={item}>Checkout</Link>
          </div>
          <div>
            <p className={heading}>Your Orders</p>
            <Link to="/my-orders" className={item}>My orders on this device</Link>
            <Link to="/find-order" className={item}>Find my order</Link>
            <button type="button" onClick={() => openGuidelines(true)} className={cn(item, 'text-left')}>
              Ordering guidelines
            </button>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className={heading}>Categories</p>
            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-1">
              {categories.map((c) => (
                <Link key={c.id} to={`/?cat=${c.slug}#stores`} className={item}>
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <div className="relative border-t border-white/10 px-6 py-5 sm:px-10">
          <p className="max-w-3xl text-xs leading-relaxed text-white/45">{DELIVERY_DISCLAIMER}</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/55">
            <span>© {new Date().getFullYear()} MGL Food Hub. All rights reserved.</span>
            <button type="button" onClick={() => openGuidelines(true)} className="hover:text-brand">
              Ordering guidelines
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}

/** "View cart" bar on phones, floating just above the bottom navigation. */
function FloatingCartBar() {
  const { count, subtotalCents } = useCartView()
  const setOpen = useCartUI((s) => s.setOpen)
  if (!useFloatingCartVisible()) return null
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 px-3 pb-2.5 md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex w-full max-w-md items-center justify-between rounded-full bg-navy px-5 py-3 font-semibold text-white shadow-xl shadow-navy/25 animate-fade-up active:scale-[0.98]"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand text-sm text-navy">{count}</span>
          View cart
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          {peso(subtotalCents / 100)} <ArrowRight className="size-4" />
        </span>
      </button>
    </div>
  )
}

export function CustomerLayout() {
  const { pathname, hash } = useLocation()
  const cartBar = useFloatingCartVisible()
  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0 })
    }
  }, [pathname, hash])

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col md:pb-0',
        // keep the footer clear of the bottom bar (and the cart bar when it shows)
        cartBar ? 'pb-[calc(8.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]',
      )}
    >
      <ScheduledNotice />
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      <FloatingCartBar />
      <MobileNav />
      <CartSheet />
      <OrderingGuidelines />
    </div>
  )
}

export function PageShell({ title, subtitle, children, icon }: { title: string; subtitle?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-7 flex items-start gap-3 animate-fade-up">
        {icon && <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sand text-brand-600 [&_svg]:size-5">{icon}</div>}
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-navy/60">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function PageLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <Skeleton className="h-9 w-1/2" />
      <Skeleton className="h-40" />
      <Skeleton className="h-64" />
    </div>
  )
}
