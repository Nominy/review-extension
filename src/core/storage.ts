import { STORAGE_KEY_SESSIONS, STORAGE_KEY_SELECTED, STORAGE_KEY_SETTINGS } from './constants';
import { sanitizeSettings } from './runtime-config';
import type { StoredState } from './types';

export async function loadState(): Promise<StoredState> {
  const data = await chrome.storage.local.get([
    STORAGE_KEY_SESSIONS,
    STORAGE_KEY_SETTINGS,
    STORAGE_KEY_SELECTED
  ]);

  return {
    sessions: (data[STORAGE_KEY_SESSIONS] as StoredState['sessions']) || {},
    settings: sanitizeSettings((data[STORAGE_KEY_SETTINGS] as Partial<StoredState['settings']>) || {}),
    selectedSessionId: (data[STORAGE_KEY_SELECTED] as string) || ''
  };
}

export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_SESSIONS]: state.sessions,
    [STORAGE_KEY_SETTINGS]: sanitizeSettings(state.settings),
    [STORAGE_KEY_SELECTED]: state.selectedSessionId
  });
}
