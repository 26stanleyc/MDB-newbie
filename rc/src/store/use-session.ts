import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, type User } from '@/api';

import { asyncStorage } from './persist';

type SessionState = {
  hasHydrated: boolean;
  hasSeenOnboarding: boolean;
  user: User | null;
  setHydrated: () => void;
  completeOnboarding: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/** Auth + onboarding state. Persisted so login/onboarding survive restart (M1). */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      hasSeenOnboarding: false,
      user: null,
      setHydrated: () => set({ hasHydrated: true }),
      completeOnboarding: () => set({ hasSeenOnboarding: true }),
      signIn: async (email, password) => {
        const user = await api.logIn(email, password);
        set({ user });
      },
      signUp: async (email, password) => {
        const user = await api.signUp(email, password);
        set({ user });
      },
      signOut: async () => {
        await api.logOut();
        set({ user: null });
      },
    }),
    {
      name: 'capitan-session',
      storage: asyncStorage,
      partialize: (s) => ({
        hasSeenOnboarding: s.hasSeenOnboarding,
        user: s.user,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
