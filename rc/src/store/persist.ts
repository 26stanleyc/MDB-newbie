import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';

/** Shared AsyncStorage adapter for all persisted Zustand stores. */
export const asyncStorage = createJSONStorage(() => AsyncStorage);
