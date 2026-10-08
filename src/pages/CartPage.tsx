import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { useCartView } from '@/hooks/useCatalog'
import { peso } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CartContents } from '@/components/Cart'
import { PageShell } from '@/components/CustomerLayout'

export default function CartPage() {
  const view = useCartView()
  const navigate = useNavigate()
  return (
    <PageShell title="Your Cart" subtitle="Items are grouped by store. Your cart is saved on this device only." icon={<ShoppingBag />}>
      <CartContents />
      {view.lines.length > 0 && (
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/">Add more items</Link>
          </Button>
          <Button size="lg" disabled={view.hasIssues} onClick={() => navigate('/checkout')}>
            Checkout · {peso(view.subtotalCents / 100)}
          </Button>
        </div>
      )}
    </PageShell>
  )
}
