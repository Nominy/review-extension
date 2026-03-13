import {
  DEFAULT_SETTINGS,
  STORAGE_KEY_APPLY_COMMANDS,
  STORAGE_KEY_SESSIONS,
  STORAGE_KEY_SELECTED,
  STORAGE_KEY_SETTINGS
} from './constants';
import type { ReviewSessionApplyCommand, StoredState } from './types';

export async function loadState(): Promise<StoredState> {
  const data = await chrome.storage.local.get([
    STORAGE_KEY_SESSIONS,
    STORAGE_KEY_SETTINGS,
    STORAGE_KEY_SELECTED
  ]);

  return {
    sessions: (data[STORAGE_KEY_SESSIONS] as StoredState['sessions']) || {},
    settings: { ...DEFAULT_SETTINGS, ...((data[STORAGE_KEY_SETTINGS] as Partial<StoredState['settings']>) || {}) },
    selectedSessionId: (data[STORAGE_KEY_SELECTED] as string) || ''
  };
}

export async function saveState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEY_SESSIONS]: state.sessions,
    [STORAGE_KEY_SETTINGS]: state.settings,
    [STORAGE_KEY_SELECTED]: state.selectedSessionId
  });
}

export async function loadApplyCommands(): Promise<Record<string, ReviewSessionApplyCommand>> {
  const data = await chrome.storage.local.get([STORAGE_KEY_APPLY_COMMANDS]);
  return (data[STORAGE_KEY_APPLY_COMMANDS] as Record<string, ReviewSessionApplyCommand>) || {};
}

export async function enqueueApplyCommand(command: ReviewSessionApplyCommand): Promise<void> {
  const commands = await loadApplyCommands();
  commands[command.commandId] = command;
  await chrome.storage.local.set({
    [STORAGE_KEY_APPLY_COMMANDS]: commands
  });
}

export async function removeApplyCommand(commandId: string): Promise<void> {
  const commands = await loadApplyCommands();
  if (!(commandId in commands)) {
    return;
  }

  delete commands[commandId];
  await chrome.storage.local.set({
    [STORAGE_KEY_APPLY_COMMANDS]: commands
  });
}
