import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { randomId, toCents } from '@/lib/utils'

/**
 * The cart lives ONLY in this browser's localStorage ("mgl_cart_v1").
 * Each device gets its own random device_id; nothing is shared on a server,
 * so two customers can never see or merge each other's carts.
 */
export interface CartChoice {
  groupId: string
  groupName: string
  choiceId: string
  label: string
  priceDelta: number
}

export interface CartLine {
  key: string
  storeId: string
  storeSlug: string
  storeName: string
  sectionName: string
  productId: string
  productName: string
  variantId: string
  variantLabel: string
  choices: CartChoice[]
  extraToppings: boolean
  /** Display-only. The server re-reads every price when the order is placed. */
  unitPrice: number
  quantity: number
  imageUrl: string | null
}

export type NewCartLine = Omit<CartLine, 'key'>

interface CartState {
  deviceId: string
  items: CartLine[]
  add: (line: NewCartLine) => void
  setQuantity: (key: string, quantity: number) => void
  remove: (key: string) => void
  clear: () => void
}

export const MAX_QTY = 99

export const lineKey = (l: Pick<CartLine, 'variantId' | 'choices' | 'extraToppings'>) =>
  [l.variantId, ...l.choices.map((c) => c.choiceId).sort(), l.extraToppings ? 'xt' : ''].join('|')

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      deviceId: randomId(),
      items: [],
      add: (line) =>
        set((s) => {
          const key = lineKey(line)
          const existing = s.items.find((i) => i.key === key)
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.key === key ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + line.quantity), unitPrice: line.unitPrice } : i,
              ),
            }
          }
          return { items: [...s.items, { ...line, key }] }
        }),
      setQuantity: (key, quantity) =>
        set((s) => ({
          items: s.items.map((i) => (i.key === key ? { ...i, quantity: Math.max(1, Math.min(MAX_QTY, quantity)) } : i)),
        })),
      remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'mgl_cart_v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ deviceId: s.deviceId, items: s.items }),
    },
  ),
)

export const cartCount = (items: CartLine[]) => items.reduce((n, i) => n + i.quantity, 0)
export const cartSubtotalCents = (items: CartLine[]) => items.reduce((n, i) => n + toCents(i.unitPrice) * i.quantity, 0)
