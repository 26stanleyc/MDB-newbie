import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { api, type ClimberProfile } from '@/api';
import type { UnitSystem } from '@/lib/units';

import { asyncStorage } from './persist';

type ProfileState = {
  /** null until the climber enters measurements (profile setup is skippable). */
  profile: ClimberProfile | null;
  unit: UnitSystem;
  setUnit: (unit: UnitSystem) => void;
  saveProfile: (profile: ClimberProfile) => Promise<void>;
};

/**
 * Climber measurements, always stored in cm (M1). Persisted. Editing these
 * means the next path request recomputes for the new body (M4/M5).
 */
export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      unit: 'imperial',
      setUnit: (unit) => set({ unit }),
      saveProfile: async (profile) => {
        await api.updateProfile(profile);
        set({ profile });
      },
    }),
    { name: 'capitan-profile', storage: asyncStorage },
  ),
);
