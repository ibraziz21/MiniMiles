// ── Order lifecycle ───────────────────────────────────────────────────────────

export type OrderStatus =
  | "placed"
  | "accepted"
  | "packed"
  | "out_for_delivery"
  | "delivered"
  | "received"
  | "completed"
  | "cancelled";

export type MerchantActionStatus = Extract<
  OrderStatus,
  "accepted" | "packed" | "out_for_delivery" | "delivered" | "cancelled"
>;

export const ORDER_STATUSES: OrderStatus[] = [
  "placed",
  "accepted",
  "packed",
  "out_for_delivery",
  "delivered",
  "received",
  "completed",
  "cancelled",
];

export const VALID_TRANSITIONS: Record<string, MerchantActionStatus[]> = {
  placed: ["accepted", "cancelled"],
  accepted: ["packed", "cancelled"],
  packed: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered", "cancelled"],
};

export const FINAL_STATES = new Set<OrderStatus>(["received", "completed", "cancelled"]);

// ── Products ──────────────────────────────────────────────────────────────────

export interface MerchantProduct {
  id: string;
  merchant_id: string;
  name: string;
  description: string | null;
  price_cusd: number;
  category: string | null;
  image_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const PRODUCT_CATEGORIES = [
  "electronics",
  "accessories",
  "services",
  "clothing",
  "food",
  "general",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_CATEGORY_SET = new Set<string>(PRODUCT_CATEGORIES);

// ── Voucher templates ─────────────────────────────────────────────────────────

export type VoucherType = "free" | "percent_off" | "fixed_off";

export interface VoucherTemplate {
  id: string;
  partner_id: string;
  title: string;
  voucher_type: VoucherType;
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  cooldown_seconds: number;
  global_cap: number | null;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Partner settings ──────────────────────────────────────────────────────────

export interface PartnerSettings {
  id: string;
  partner_id: string;
  store_active: boolean;
  logo_url: string | null;
  support_email: string | null;
  support_phone: string | null;
  delivery_cities: string[];
  notify_new_order: boolean;
  notify_stale_order: boolean;
  stale_threshold_hours: number;
  wallet_address: string | null;
  updated_at: string;
}

// ── Team management ───────────────────────────────────────────────────────────

export type MerchantUserRole = "owner" | "manager" | "staff";

export interface MerchantUser {
  id: string;
  email: string;
  partner_id: string;
  name: string | null;
  role: MerchantUserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Notification log ──────────────────────────────────────────────────────────

export type NotificationType = "new_order" | "stale_order" | "out_for_delivery_followup";

export interface NotificationLogEntry {
  id: string;
  partner_id: string;
  merchant_user_id: string | null;
  type: NotificationType;
  order_id: string | null;
  subject: string | null;
  body_preview: string | null;
  sent_at: string;
}

// ── DB row types ──────────────────────────────────────────────────────────────

export interface MerchantOrder {
  id: string;
  partner_id: string;
  user_address: string;
  status: OrderStatus;
  // Items / products
  item_name: string | null;
  item_category: string | null;
  product_id: string | null;
  // Payment
  payment_ref: string | null;
  payment_currency: string | null;
  amount_cusd: number | null;
  amount_kes: number | null;
  // Voucher
  voucher_code: string | null;
  voucher_id: string | null;
  // Delivery
  recipient_name: string | null;
  phone: string | null;
  city: string | null;
  location_details: string | null;
  // Timestamps
  created_at: string;
  accepted_at: string | null;
  packed_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
}

export interface Partner {
  id: string;
  slug: string;
  name: string;
  country: string | null;
  image_url: string | null;
}

export interface AuditLogEntry {
  id: string;
  merchant_user_id: string;
  partner_id: string;
  action: string;
  order_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface OrdersListResponse {
  orders: MerchantOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MonthlyFinanceBucket {
  month: string; // "YYYY-MM"
  items_sold: number;
  value_sold_cusd: number;
  in_flight_cusd: number;
  vouchers_used: number;
}

export interface VoucherStats {
  active_templates: number;
  outstanding_issued: number;
  expiring_soon: number;
}

export interface OrderStatsResponse {
  new_orders: number;
  by_status: Record<OrderStatus, number>;
  recent_orders: MerchantOrder[];
  monthly: MonthlyFinanceBucket[];
  voucher_stats: VoucherStats;
}

// ── Finance ───────────────────────────────────────────────────────────────────

export interface FinanceMonthly {
  month: string; // "YYYY-MM"
  revenue_cusd: number;
  order_count: number;
}

export interface FinanceStats {
  // Revenue
  total_revenue_cusd: number;
  this_month_revenue_cusd: number;
  last_month_revenue_cusd: number;
  // Orders
  total_completed_orders: number;
  this_month_completed_orders: number;
  // Vouchers
  active_voucher_templates: number;
  issued_vouchers_outstanding: number; // issued but not redeemed
  // Estimates
  estimated_receivable_cusd: number; // revenue from orders in flight (accepted/packed/out_for_delivery)
  // Monthly breakdown (last 6 months)
  monthly: FinanceMonthly[];
  // Payment details
  wallet_address: string | null;
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface MerchantSessionData {
  merchantUserId: string;
  email: string;
  partnerId: string;
  partnerName: string;
  role: MerchantUserRole;
  issuedAt: number;
}
