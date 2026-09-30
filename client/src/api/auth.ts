import type { AuthUser } from '@fantasteel/shared';
import { api } from './client';

export const authApi = {
  login: (employeeNo: string, password: string) => api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { employeeNo, password }),
  me: () => api.get<AuthUser>('/auth/me'),
  logout: () => api.post<{ loggedOut: boolean }>('/auth/logout'),
};
