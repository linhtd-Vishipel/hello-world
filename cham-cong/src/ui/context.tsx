import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { AppState, AppStore } from '../state/store';

export const StoreContext = createContext<AppStore | null>(null);

export function useAppStore(): AppStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error('StoreContext chưa được cung cấp');
  return s;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(useAppStore(), selector);
}

export function useActions() {
  return useAppStore().actions;
}
