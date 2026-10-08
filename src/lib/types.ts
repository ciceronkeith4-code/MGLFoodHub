export type Badge = 'best_seller' | 'new' | 'all_time_favorite'
export type PaymentMethod = 'cod' | 'gcash'
export type PaymentStatus = 'cod_unpaid' | 'pending_verification' | 'paid' | 'rejected'
export type OrderStatus = 'processing' | 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled'

export interface HubCategory {
  id: string
  name: string
  slug: string
  sort: number
}

export interface Store {
  id: string
  slug: string
  name: string
  tagline: string | null
  hub_category_id: string
  open_time: string
  close_time: string
  address: string | null
  contact_note: string | null
  cover_image_url: string | null
  menu_image_url: string | null
  is_accepting_orders: boolean
  sort: number
}

export interface MenuSection {
  id: string
  store_id: string
  name: string
  note: string | null
  sort: number
}

export interface Product {
  id: string
  store_id: string
  section_id: string
  name: string
  description: string | null
  badge: Badge | null
  image_url: string | null
  is_sold_out: boolean
  sort: number
}

export interface Variant {
  id: string
  product_id: string
  label: string
  price: number
  addon_price: number | null
  is_sold_out: boolean
  sort: number
}

export interface OptionGroup {
  id: string
  product_id: string
  name: string
  is_required: boolean
}

export interface OptionChoice {
  id: string
  group_id: string
  label: string
  price_delta: number
  sort: number
}

export interface OrderOption {
  group: string
  choice: string
  price_delta: number
}

export interface PublicOrderItem {
  store_name: string
  section_name: string | null
  product_name: string
  variant_label: string
  options: OrderOption[]
  unit_price: number
  quantity: number
  line_total: number
}

export interface HistoryEntry {
  status: string
  note: string | null
  created_at: string
}

/** Shape returned by the get_order_by_token RPC (customer-safe). */
export interface PublicOrder {
  order_number: string
  tracking_token: string
  customer_name: string
  phone: string
  address: string
  barangay: string
  city: string
  landmark: string | null
  delivery_date: string
  delivery_slot: string
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  order_status: OrderStatus
  gcash_reference: string | null
  payment_rejection_reason: string | null
  subtotal: number
  delivery_fee: number
  total: number
  customer_notes: string | null
  cancel_reason: string | null
  cancel_requested: boolean
  created_at: string
  updated_at: string
  items: PublicOrderItem[]
  history: HistoryEntry[]
}

export interface OrderSummary {
  tracking_token: string
  order_number: string
  order_status: OrderStatus
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  delivery_date: string
  delivery_slot: string
  total: number
  created_at: string
}

export interface CheckoutInfo {
  today: string
  min_date: string
  max_date: string
  cutoff_time: string
  blocked_dates: string[]
  gcash_account_name: string
  gcash_number: string
  gcash_qr_url: string
  delivery_fee_note: string
  email_notifications_enabled: boolean
  ordering_guidelines?: string[]
}

/** Full order row (admin only). */
export interface OrderRow {
  id: string
  order_number: string
  tracking_token: string
  device_id: string | null
  customer_name: string
  phone: string
  email: string
  social_media: string
  address: string
  barangay: string
  city: string
  landmark: string | null
  delivery_date: string
  delivery_slot: string
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  order_status: OrderStatus
  gcash_reference: string | null
  gcash_proof_path: string | null
  payment_rejection_reason: string | null
  subtotal: number
  delivery_fee: number
  total: number
  customer_notes: string | null
  admin_notes: string | null
  cancel_reason: string | null
  cancel_requested: boolean
  cancel_request_reason: string | null
  created_at: string
  updated_at: string
}

export interface OrderItemRow {
  id: string
  order_id: string
  line_no: number
  store_id: string
  product_id: string
  variant_id: string
  store_name_snapshot: string
  section_name_snapshot: string | null
  product_name_snapshot: string
  variant_label_snapshot: string
  options_snapshot: OrderOption[]
  unit_price_snapshot: number
  quantity: number
  line_total: number
}

export interface HistoryRow {
  id: string
  order_id: string
  status: string
  note: string | null
  changed_by: string | null
  changed_by_email: string | null
  created_at: string
}

export interface CallLogRow {
  id: string
  order_id: string
  result: 'answered' | 'no_answer' | 'wrong_number'
  note: string | null
  created_by_email: string | null
  created_at: string
}
