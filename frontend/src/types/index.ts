// Shared types for the multi-tenant Facility Booking app.

export type Role = 'super_admin' | 'tenant_admin' | 'approver' | 'employee';

export interface ApiEnvelope<T = unknown> {
  status: boolean;
  msg?: string;
  data?: T;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  current_page: number;
  per_page: number;
  last_page?: number;
}

// ----- Auth ---------------------------------------------------------------

export interface CurrentUser {
  id: number;
  username: string;
  name?: string;
  lname?: string;
  email?: string;
  role: Role;
  tenant_id: number | null;
  tenant_name?: string | null;
  department_id?: number | null;
}

export interface RegisterPayload {
  username: string;
  password: string;
  tenant_slug: string;
  name?: string;
  lname?: string;
  email?: string;
  mobile?: string;
}

// ----- Super-admin masters ------------------------------------------------

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  contact_email?: string;
  contact_phone?: string;
  currency_code: string;
  timezone: string;
  locale: string;
  status: 'trial' | 'active' | 'suspended';
  created_at?: string;
}

export interface Currency { code: string; name: string; symbol: string; decimals: number; status?: 0 | 1; }
export interface Timezone { name: string; display_name: string; utc_offset: string; status?: 0 | 1; }
export interface Locale   { code: string; name: string; native_name?: string; status?: 0 | 1; }

// ----- Tenant-admin masters ----------------------------------------------

export interface Site {
  id: number;
  tenant_id: number;
  tenant_name?: string;
  name: string;
  code?: string;
  address?: string;
  timezone?: string;
  status: 0 | 1;
  created_at?: string;
}

export interface Floor {
  id: number;
  tenant_id: number;
  tenant_name?: string;
  site_id: number;
  site_name?: string;
  name: string;
  level_number?: number;
  status: 0 | 1;
}

export type FacilityType =
  | 'meeting_room' | 'gym' | 'conference_room' | 'desk' | 'swimming_pool' | 'other';

export interface Facility {
  id: number;
  tenant_id: number;
  tenant_name?: string;
  site_id: number;
  floor_id?: number | null;
  name: string;
  type: FacilityType;
  capacity: number;
  description?: string;
  image_url?: string;
  requires_approval: 0 | 1;
  // When 1, multiple bookings can co-exist for any overlapping window as
  // long as total attendees stay <= capacity. Default 0 = exclusive.
  shared_booking?: 0 | 1;
  facility_approver_user_id?: number | null;
  status: 0 | 1;
  site_name?: string;
  floor_name?: string;
  operating_hours?: OperatingHour[];
  approval_chain?: FacilityApprovalChainStep[];
}

// One step in a facility's approval chain. `approver_kind` decides whether
// approver_user_id is required (for 'user') or resolved at booking time
// (for 'dynamic_dept_manager').
export interface FacilityApprovalChainStep {
  id?: number;
  facility_id?: number;
  // F02 - which workflow this step belongs to. Defaults to 'checkin' for
  // backwards compat with existing chains.
  stage?: 'checkin' | 'checkout';
  step_order: number;
  approver_kind: 'user' | 'dynamic_dept_manager';
  approver_user_id?: number | null;
  // Joined from the backend (only when approver_kind === 'user'):
  approver_name?: string;
  approver_lname?: string;
  approver_username?: string;
  approver_email?: string;
  approver_designation?: string;
}

export interface OperatingHour {
  id?: number;
  day_of_week: number; // 0=Sun .. 6=Sat
  open_time: string;   // 'HH:MM' or 'HH:MM:SS'
  close_time: string;
  slot_minutes: number;
}

export interface Department {
  id: number;
  tenant_id: number;
  site_id?: number | null;
  site_name?: string;          // joined from sites on list/getOne
  name: string;
  code?: string;
  parent_dept_id?: number | null;
  parent_dept_name?: string;
  manager_user_id?: number | null;
  manager_name?: string;
  manager_lname?: string;
  status: 0 | 1;
}

export interface MealTime {
  id: number;
  tenant_id: number;
  name: string;
  start_time: string;
  end_time: string;
  status: 0 | 1;
}

// (Tenant-level ApprovalWorkflow types removed in migration 019 - replaced
// by per-facility chains. See FacilityApprovalChainStep above and the
// facility form for editing.)

// ----- Users (admin CRUD) -------------------------------------------------

export interface User {
  id: number;
  tenant_id?: number | null;
  department_id?: number | null;
  site_id?: number | null;
  username: string;
  name?: string;
  lname?: string;
  email?: string;
  mobile?: string;
  designation?: string;
  role: Role;
  status?: 0 | 1;
  is_approved?: 0 | 1;
  is_approver?: 0 | 1;
  created_at?: string;
  // Joined display fields
  department_name?: string;
  site_name?: string;
}

export interface CreateUserPayload {
  username: string;
  password: string;
  name?: string;
  lname?: string;
  email?: string;
  mobile?: string;
  designation?: string;
  department_id?: number | null;
  site_id?: number | null;
  role?: Role;
  tenant_id?: number;
  status?: 0 | 1;
  is_approved?: 0 | 1;
  is_approver?: 0 | 1;
}

// Slim shape from GET /api/users/approvers - used by workflow step picker.
export interface ApproverOption {
  id: number;
  username: string;
  name?: string;
  lname?: string;
  email?: string;
  designation?: string;
  role?: Role;
}

// ----- Bookings (live, from backend) --------------------------------------

export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
export type RepeatType   = 'none' | 'daily' | 'weekly_wed' | 'custom';

export interface LiveBooking {
  id: number;
  tenant_id: number;
  facility_id: number;
  user_id: number;
  department_id?: number | null;
  department_name?: string;
  title?: string;
  start_at: string;        // 'YYYY-MM-DD HH:MM:SS'
  end_at: string;
  repeat_type: RepeatType;
  status: BookingStatus;
  remarks?: string;
  dont_disturb?: 0 | 1;
  created_at?: string;

  // joined fields (from list/getOne)
  facility_name?: string;
  facility_type?: FacilityType;
  booker_name?: string;
  booker_lname?: string;
  booker_username?: string;

  // "Pending with" - populated only for pending bookings in /bookings list.
  // The first pending booking_approvals row, ordered by step_order.
  pending_with_user_id?: number | null;
  pending_with_name?: string | null;
  pending_with_email?: string | null;

  // detail-only
  guests?: BookingGuestRow[];
  meals?: { id: number; name: string; start_time: string; end_time: string }[];
  approvals?: BookingApprovalRow[];
}

export interface BookingGuestRow {
  id?: number;
  fname?: string;
  lname?: string;
  contact_no?: string;
  email?: string;
}

export interface BookingApprovalRow {
  id: number;
  step_id?: number | null;       // legacy column, now nullable (migration 019)
  approver_user_id: number;
  decision: 'pending' | 'approved' | 'rejected';
  remark?: string;
  decided_at?: string;
  step_order: number;
  approver_name?: string;
  approver_lname?: string;
  approver_username?: string;
  approver_email?: string;
  approver_designation?: string;
}

export interface CreateBookingPayload {
  facility_id: number;
  start_at: string;        // 'YYYY-MM-DD HH:MM:SS'
  end_at: string;
  title?: string;
  remarks?: string;
  repeat_type?: RepeatType;
  dont_disturb?: boolean;
  guests?: { fname?: string; lname?: string; contact_no?: string; email?: string }[];
  meal_time_ids?: number[];
  // F06 - pantry orders. Each entry references a pantry_menu_items.id linked
  // to a pantry that's both on this facility's site AND in facility_pantries.
  pantry_orders?: { menu_item_id: number; quantity: number }[];
}

// Approval inbox row (joined view from GET /approvals/inbox)
// Approval inbox row (joined view from GET /approvals/inbox).
// The same shape is also returned by GET /approvals/history, where decision
// is 'approved' | 'rejected' and decided_at/remark are populated.
export interface InboxItem {
  id: number;                 // booking_approvals.id
  booking_id: number;
  step_id?: number | null;    // legacy column, now nullable (migration 019)
  approver_user_id: number;
  // F02 - per-row stage. 'checkin' is the pre-booking workflow; 'checkout'
  // is the post-booking sign-off (cleaning, returns, etc).
  stage?: 'checkin' | 'checkout';
  decision: 'pending' | 'approved' | 'rejected';
  remark?: string;
  decided_at?: string;
  step_order: number;

  title?: string;
  start_at: string;
  end_at: string;
  booking_status: BookingStatus;
  remarks?: string;
  facility_name: string;
  facility_type: FacilityType;

  booker_id: number;
  booker_name?: string;
  booker_lname?: string;
  booker_username?: string;
}

// ----- Facility booking UI-only types -------------------------------------

export type FacilityKind = FacilityType;

export interface FacilityCard {
  kind: FacilityKind;
  label: string;
  description: string;
  image: string;
  disabled?: boolean;
}

export interface Booking {
  bookingId: string;
  title: string;
  facility: string;
  bookedBy: string;
  guests: number;
  slot: string;
  status?: 'upcoming' | 'past' | 'cancelled';
}

export interface Guest {
  fname: string;
  lname: string;
  contactNo: string;
  email: string;
}
 facility: string;
  bookedBy: string;
  guests: number;
  slot: string;
  status?: 'upcoming' | 'past' | 'cancelled';
}

export interface Guest {
  fname: string;
  lname: string;
  contactNo: string;
  email: string;
}
: string;
  disabled?: boolean;
}

export interface Booking {
  bookingId: string;
  title: string;
  facility: string;
  bookedBy: string;
  guests: number;
  slot: string;
  status?: 'upcoming' | 'past' | 'cancelled';
}

export interface Guest {
  fname: string;
  lname: string;
  contactNo: string;
  email: string;
}
