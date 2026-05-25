import axios from 'axios';

/**
 * Axios instance shared by every API call.
 *
 * - In dev the `/api` prefix is proxied by Vite (see vite.config.ts).
 * - In other envs, set VITE_API_BASE_URL to an absolute origin like
 *   "https://api.example.com" and we'll prepend it.
 */
const baseURL = (import.meta.env.VITE_API_BASE_URL || '') + '/api';

const api = axios.create({ baseURL });

// Attach JWT to every outgoing request.
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('fm_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Globally bounce the user to /login on 401.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && window.location.pathname !== '/login') {
      localStorage.removeItem('fm_token');
      localStorage.removeItem('fm_user');
      window.location.assign('/login');
    }
    return Promise.reject(err);
  }
);

export default api;
