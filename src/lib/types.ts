// Row types mirroring supabase/migrations. Keep in sync when the schema changes
// (or regenerate with `npx supabase gen types typescript`).

export type MemberRole = 'owner' | 'manager' | 'receptionist' | 'stylist';
export type ApptStatus = 'waiting' | 'booked' | 'confirmed' | 'checked_in' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export type BookingSource = 'walk_in' | 'phone' | 'online' | 'whatsapp' | 'staff';
export type PayMethod = 'cash' | 'upi' | 'card' | 'wallet' | 'other';
export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'void';
export type Hours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>>;

export interface Salon {
  id: string; name: string; slug: string; legal_name: string | null; gstin: string | null;
  phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null;
  timezone: string; currency: string; brand_color: string; logo_url: string | null;
  prices_include_tax: boolean; default_gst_rate: number; invoice_prefix: string; next_invoice_no: number;
  booking_enabled: boolean; slot_interval_min: number; booking_lead_min: number; booking_window_days: number;
  plan: 'trial' | 'starter' | 'growth' | 'pro'; plan_status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trial_ends_at: string | null;
  wa_phone_number_id: string | null; wa_business_account_id: string | null; wa_display_number: string | null;
  wa_bot_enabled: boolean; wa_bot_instructions: string | null;
  created_at: string;
}

export interface Branch { id: string; salon_id: string; name: string; address: string | null; phone: string | null; is_default: boolean; business_hours: Hours }

export interface Staff {
  id: string; salon_id: string; branch_id: string | null; user_id: string | null; name: string; phone: string | null;
  title: string | null; color: string; commission_pct: number; working_hours: Hours | null;
  bookable: boolean; active: boolean; sort: number;
}

export interface Member { salon_id: string; user_id: string; role: MemberRole; staff_id: string | null; created_at: string }

export interface ServiceCategory { id: string; salon_id: string; name: string; sort: number }

export interface Service {
  id: string; salon_id: string; category_id: string | null; name: string; description: string | null;
  duration_min: number; price: number; gst_rate: number | null; gender: 'unisex' | 'female' | 'male';
  online_bookable: boolean; active: boolean; sort: number;
}

export interface Customer {
  id: string; salon_id: string; name: string; phone: string; email: string | null; gender: 'female' | 'male' | 'other' | null;
  birthday: string | null; notes: string | null; tags: string[]; user_id: string | null; marketing_opt_in: boolean;
  visit_count: number; total_spent: number; last_visit_at: string | null; created_at: string;
}

export interface AppointmentService { id: string; appointment_id: string; service_id: string | null; name: string; price: number; duration_min: number; sort: number }

export interface Appointment {
  id: string; salon_id: string; branch_id: string | null; customer_id: string; staff_id: string | null;
  start_at: string; end_at: string; status: ApptStatus; source: BookingSource; token_no: number | null;
  notes: string | null; cancelled_reason: string | null; invoice_id: string | null; created_at: string;
}

/** Appointment joined with its client and services, as the calendar uses it. */
export interface AppointmentFull extends Appointment {
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'visit_count' | 'notes'>;
  services: Pick<AppointmentService, 'service_id' | 'name' | 'price' | 'duration_min'>[];
}

export interface Invoice {
  id: string; salon_id: string; invoice_no: string; customer_id: string | null; appointment_id: string | null;
  prices_include_tax: boolean; subtotal: number; discount_total: number; taxable_total: number;
  cgst: number; sgst: number; igst: number; round_off: number; total: number; paid_total: number;
  status: InvoiceStatus; notes: string | null; void_reason: string | null; created_at: string;
}

export interface InvoiceItem {
  id: string; invoice_id: string; kind: 'service' | 'product' | 'custom'; service_id: string | null; staff_id: string | null;
  name: string; qty: number; unit_price: number; discount: number; gst_rate: number; taxable: number; tax: number; line_total: number;
}

export interface Payment { id: string; invoice_id: string; method: PayMethod; amount: number; reference: string | null; created_at: string }

export interface WaConversation {
  id: string; salon_id: string; customer_id: string | null; wa_id: string; profile_name: string | null;
  bot_paused: boolean; needs_attention: boolean; state: Record<string, unknown>;
  last_inbound_at: string | null; last_message_at: string; unread_count: number;
}

export interface WaMessage {
  id: string; conversation_id: string; direction: 'in' | 'out'; author: 'customer' | 'bot' | 'staff' | 'system';
  kind: string; body: string | null; payload: unknown; status: string | null; created_at: string;
}

export interface SalonReport {
  revenue: number; collected: number; tax: number; bills: number; avg_bill: number; new_clients: number;
  appointments: Partial<Record<ApptStatus, number>>;
  by_source: Partial<Record<BookingSource, number>>;
  by_day: { day: string; revenue: number; bills: number }[];
  by_staff: { staff_id: string; name: string; color: string; revenue: number; services: number; commission: number }[];
  by_service: { name: string; revenue: number; count: number }[];
  by_method: Partial<Record<PayMethod, number>>;
}

/** Result shape every server action returns, so forms can show errors inline. */
export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export const STATUS_LABEL: Record<ApptStatus, string> = {
  waiting: 'Waiting', booked: 'Booked', confirmed: 'Confirmed', checked_in: 'Arrived', in_service: 'In chair',
  completed: 'Done', cancelled: 'Cancelled', no_show: 'No-show',
};
export const SOURCE_LABEL: Record<BookingSource, string> = {
  walk_in: 'Walk-in', phone: 'Phone', online: 'Online', whatsapp: 'WhatsApp', staff: 'Front desk',
};
export const METHOD_LABEL: Record<PayMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', wallet: 'Wallet', other: 'Other' };
export const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Owner', manager: 'Manager', receptionist: 'Front desk', stylist: 'Stylist' };
