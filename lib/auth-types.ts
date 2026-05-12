/**
 * Shared auth types
 */

export type Role = 'admin' | 'instructor' | 'student' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  image?: string;
  institution?: string;
}