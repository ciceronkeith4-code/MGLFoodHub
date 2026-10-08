import { storage } from './utils'

/** Tracking links saved on THIS device only ("My Orders on this device"). */
export interface SavedOrder {
  order_number: string
  token: string
  created_at: string
  delivery_date?: string
}

const KEY = 'mgl_my_orders_v1'

export function getMyOrders(): SavedOrder[] {
  const list = storage.get<SavedOrder[]>(KEY, [])
  return Array.isArray(list) ? list : []
}

export function saveMyOrder(order: SavedOrder) {
  const list = getMyOrders().filter((o) => o.token !== order.token)
  storage.set(KEY, [order, ...list].slice(0, 50))
}

export function removeMyOrder(token: string) {
  storage.set(
    KEY,
    getMyOrders().filter((o) => o.token !== token),
  )
}
