import api from './client';
import type { ApiEnvelope, InboxItem, BookingApprovalRow, BookingStatus, FacilityType } from '@/types';

export interface DecidePayload {
  decision: 'approved' | 'rejected';
  remark?: string;
  token?: string;       // optional - consumed when acting from email link
}

// Shape returned by GET /approvals/by-token.
// Includes the approval row + booking summary + prior decisions.
export interface ApprovalActPayload {
  approval: {
    id: number;
    booking_id: number;
    step_id?: number | null;
    step_order: number;
    approver_user_id: number;
    decision: 'pending' | 'approved' | 'rejected';
    remark?: string;
    decided_at?: string;
    tenant_id: number;
    title?: string;
    start_at: string;
    end_at: string;
    booking_status: BookingStatus;
    booking_remarks?: string;
    facility_name: string;
    facility_type: FacilityType;
    booker_id: number;
    booker_name?: string;
    booker_lname?: string;
    booker_username?: string;
    booker_email?: string;
  };
  prior_decisions: BookingApprovalRow[];
}

export const approvalsApi = {
  inbox: () =>
    api.get<ApiEnvelope<InboxItem[]>>('/approvals/inbox').then((r) => r.data),

  history: (limit = 50) =>
    api.get<ApiEnvelope<InboxItem[]>>('/approvals/history', { params: { limit } }).then((r) => r.data),

  decide: (id: number, body: DecidePayload) =>
    api.post<ApiEnvelope>(`/approvals/${id}/decide`, body).then((r) => r.data),

  byToken: (token: string) =>
    api.get<ApiEnvelope<ApprovalActPayload>>('/approvals/by-token', { params: { token } }).then((r) => r.data),
};
