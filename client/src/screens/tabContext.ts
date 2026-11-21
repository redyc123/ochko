import { createContext, useContext } from 'react';

export type RootTab = 'map' | 'assistant' | 'glasses';

export interface RootTabContextValue {
  activeTab: RootTab;
  setActiveTab: (tab: RootTab) => void;
}

export const RootTabContext = createContext<RootTabContextValue | null>(null);

export function useRootTab(): RootTabContextValue {
  const value = useContext(RootTabContext);
  if (!value) {
    throw new Error('useRootTab must be used inside RootNavigator');
  }
  return value;
}
