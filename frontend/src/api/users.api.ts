import api from './client';
import type { ApiEnvelope, ApproverOption, CreateUserPayload, Paginated, Role, User } from '@/types';

// Backend exposes the body-driven update/delete pattern on /users (not /:id).
export const usersApi = {
  list(params: {
    page?: number; limit?: number; q?: string; tenant_id?: number;
    // Optional exact-match filters supported by the backend (since the
    // designation/role columns are denormalised onto users):
    designation?: string;
    role?: Role;
  } = {}) {
    return api.get<ApiEnvelope<Paginated<User>>>('/users', { params }).then((r) => r.data);
  },
  getOne(id: number) {
    return api.get<ApiEnvelope<User>>(`/users/${id}`).then((r) => r.data);
  },
  create(payload: CreateUserPayload) {
    return api.post<ApiEnvelope<{ id: number }>>('/users', payload).then((r) => r.data);
  },
  update(payload: Partial<User> & { id: number }) {
    return api.put<ApiEnvelope>('/users', payload).then((r) => r.data);
  },
  remove(id: number) {
    return api.delete<ApiEnvelope>('/users', { data: { id } }).then((r) => r.data);
  },
  // Eligible approvers (is_approver=1) in the caller's tenant. The optional
  // site_id / department_id filters power the per-facility chain picker
  // (Site -> Department -> Approver cascade).
  approvers(params: { tenant_id?: number; site_id?: number; department_id?: number } = {}) {
    return api.get<ApiEnvelope<ApproverOption[]>>('/users/approvers', { params }).then((r) => r.data);
  },
  // Lightweight self-info for the approver dashboard.
  meSummary() {
    return api.get<ApiEnvelope<{
      is_dept_manager: boolean;
      managed_dept_ids: number[];
      managed_dept_names: string[];
      pending_count: number;
      history_count: number;
    }>>('/users/me-summary').then((r) => r.data);
  },
};
