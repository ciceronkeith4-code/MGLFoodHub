import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { CustomerLayout } from '@/components/CustomerLayout'
import Home from '@/pages/Home'
import StorePage from '@/pages/StorePage'
import NotFound from '@/pages/NotFound'
import { ADMIN_LOGIN_PATH, AdminRoot, FullScreenSpinner, RequireAdmin } from '@/admin/AdminAuth'

// Checkout/tracking pull in the date picker and QR code — load them on demand.
const CartPage = lazy(() => import('@/pages/CartPage'))
const Checkout = lazy(() => import('@/pages/Checkout'))
const OrderPlaced = lazy(() => import('@/pages/OrderPlaced'))
const Track = lazy(() => import('@/pages/Track'))
const MyOrders = lazy(() => import('@/pages/MyOrders'))
const FindOrder = lazy(() => import('@/pages/FindOrder'))

// Admin code is split into its own chunk — customers never download it.
const AdminLogin = lazy(() => import('@/admin/AdminLogin'))
const AdminLayout = lazy(() => import('@/admin/AdminLayout'))
const Dashboard = lazy(() => import('@/admin/Dashboard'))
const Orders = lazy(() => import('@/admin/Orders'))
const OrderDetail = lazy(() => import('@/admin/OrderDetail'))
const PrepList = lazy(() => import('@/admin/PrepList'))
const Products = lazy(() => import('@/admin/Products'))
const Settings = lazy(() => import('@/admin/Settings'))
const Reports = lazy(() => import('@/admin/Reports'))

export default function App() {
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route element={<CustomerLayout />}>
          <Route index element={<Home />} />
          <Route path="store/:slug" element={<StorePage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="order-placed/:token" element={<OrderPlaced />} />
          <Route path="track/:token" element={<Track />} />
          <Route path="my-orders" element={<MyOrders />} />
          <Route path="find-order" element={<FindOrder />} />
          <Route path="*" element={<NotFound />} />
        </Route>

        {/* Admin: hidden login URL (VITE_ADMIN_PATH) + protected /admin/* */}
        <Route element={<AdminRoot />}>
          <Route path={ADMIN_LOGIN_PATH} element={<AdminLogin />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<OrderDetail />} />
            <Route path="prep-list" element={<PrepList />} />
            <Route path="products" element={<Products />} />
            <Route path="settings" element={<Settings />} />
            <Route path="reports" element={<Reports />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  )
}
