'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Key, LayoutDashboard, LogOut, Plus, Shield } from 'lucide-react';

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthSessionUser {
  id: string;
  email: string;
  name?: string | null;
  role?: string | null;
}

/**
 * Small auth-aware nav component.
 * Shows user identity + links to settings (instructors/admins) and logout.
 * Only rendered when AUTH_ENABLED=true.
 */
export function AuthNav() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data } = await authClient.getSession();
        if (data?.user) {
          const sessionUser = data.user as AuthSessionUser;
          setUser({
            id: sessionUser.id,
            email: sessionUser.email,
            name: sessionUser.name || sessionUser.email,
            role: sessionUser.role || 'student',
          });
        }
      } catch {
        // Not authenticated — nothing to show
      }
    }
    checkAuth();
  }, []);

  if (!user) return null;

  const isInstructorOrAbove = user.role === 'admin' || user.role === 'instructor';

  const handleLogout = async () => {
    // Capture current path for post-login redirect before navigating away
    const callbackUrl = encodeURIComponent(window.location.pathname);
    try {
      await authClient.signOut();
    } catch {
      // Server sign-out failed — clear the session cookie client-side as fallback
      // so the user isn't silently left in a broken half-signed-out state.
      document.cookie = 'better-auth.session_token=; Max-Age=0; path=/';
      document.cookie = '__Secure-better-auth.session_token=; Max-Age=0; path=/; Secure';
      document.cookie = 'better-auth.session_data=; Max-Age=0; path=/';
      document.cookie = '__Secure-better-auth.session_data=; Max-Age=0; path=/; Secure';
    }
    router.push(`/login?callbackUrl=${callbackUrl}`);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        <div className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">
          {(user.name || user.email)[0].toUpperCase()}
        </div>
        <span className="hidden sm:inline max-w-[120px] truncate">{user.name || user.email}</span>
        <span className="text-[9px] opacity-60">{user.role}</span>
      </button>

      {dropdownOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setDropdownOpen(false)}
          />
          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
            <div className="px-3 py-2 border-b">
              <p className="text-sm font-medium truncate">{user.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {user.role}
              </span>
            </div>

            {/* Student links */}
            <button
              onClick={() => {
                setDropdownOpen(false);
                router.push('/dashboard');
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <LayoutDashboard className="w-4 h-4 text-muted-foreground" />
              My Classrooms
            </button>
            <button
              onClick={() => {
                setDropdownOpen(false);
                router.push('/enroll');
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
              Join Classroom
            </button>

            {/* Admin Panel — admins only (instructors get 403) */}
            {user.role === 'admin' && (
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  router.push('/admin');
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <Shield className="w-4 h-4 text-muted-foreground" />
                Admin Panel
              </button>
            )}
            {/* My AI Stack — instructors and admins */}
            {isInstructorOrAbove && (
              <button
                onClick={() => {
                  setDropdownOpen(false);
                  router.push('/settings');
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
              >
                <Key className="w-4 h-4 text-muted-foreground" />
                My AI Stack
              </button>
            )}

            <div className="border-t">
              <button
                onClick={handleLogout}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-destructive"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
