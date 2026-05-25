import api from './client';
import type { ApiEnvelope, CurrentUser, RegisterPayload } from '@/types';

export interface LoginPayload { username: string; password: string; }
export interface AuthResponse  { token: string; user: CurrentUser; }

export const authApi = {
  login(payload: LoginPayload) {
    return api.post<ApiEnvelope<AuthResponse>>('/auth/login', payload).then(r => r.data);
  },
  register(payload: RegisterPayload) {
    return api.post<ApiEnvelope<AuthResponse>>('/auth/register', payload).then(r => r.data);
  },
  me() {
    return api.get<ApiEnvelope<CurrentUser>>('/auth/me').then(r => r.data);
  },
  logout() {
    return api.post<ApiEnvelope>('/auth/logout').then(r => r.data);
  },
  forgotPassword(payload: { email: string }) {
    return api.post<ApiEnvelope>('/auth/forgot-password', payload).then(r => r.data);
  },
  resetPassword(payload: { token: string; password: string }) {
    return api.post<ApiEnvelope>('/auth/reset-password', payload).then(r => r.data);
  },
};
