'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from '@/lib/auth-client';

export interface UserPreferences {
  theme?: 'light' | 'dark' | 'system';
  dashboardArchivedExpanded?: boolean;
  adminVisFilter?: string;
  adminLcFilter?: string;
}

interface PreferencesContextType {
  prefs: UserPreferences;
  setPref: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  loaded: boolean;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [prefs, setPrefs]   = useState<UserPreferences>({});
  const [loaded, setLoaded] = useState(false);
  const pending   = useRef<Partial<UserPreferences>>({});
  const timer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchedId = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) { setLoaded(true); return; }
    // Only fetch once per user ID in this session
    if (fetchedId.current === userId) return;
    fetchedId.current = userId;

    fetch('/api/user/preferences')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.success) return;
        const serverPrefs: UserPreferences = d.preferences || {};
        setPrefs(serverPrefs);

        // Sync theme: overwrite localStorage so ThemeProvider picks it up
        // on the next storage event (cross-device sync).
        if (serverPrefs.theme) {
          const local = localStorage.getItem('theme');
          if (serverPrefs.theme !== local) {
            localStorage.setItem('theme', serverPrefs.theme);
            window.dispatchEvent(
              new StorageEvent('storage', { key: 'theme', newValue: serverPrefs.theme }),
            );
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [userId]);

  const flush = useCallback(() => {
    const patch = { ...pending.current };
    if (!Object.keys(patch).length) return;
    pending.current = {};
    fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  const setPref = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPrefs(p => ({ ...p, [key]: value }));
      pending.current[key] = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  return (
    <PreferencesContext.Provider value={{ prefs, setPref, loaded }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}
