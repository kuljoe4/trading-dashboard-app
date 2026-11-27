import { useSyncExternalStore } from 'react';
import { getSelectedEngine, subscribeSelectedEngine } from '../utils/engineMode.js';

export const useSelectedEngine = () =>
  useSyncExternalStore(subscribeSelectedEngine, getSelectedEngine, getSelectedEngine);
