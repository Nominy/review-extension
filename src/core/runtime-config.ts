import {
  ALLOW_BACKEND_OVERRIDES,
  BUILD_FLAVOR,
  DEFAULT_BACKEND_BASE_URL,
  DEFAULT_BACKEND_BASE_URL_FALLBACKS,
  ENABLE_SUBMIT_ANALYTICS
} from './build-flavor';
import type { ExtensionSettings } from './types';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: DEFAULT_BACKEND_BASE_URL,
  backendBaseUrlFallbacks: [...DEFAULT_BACKEND_BASE_URL_FALLBACKS],
  overlayMinimized: true,
  overlayPosX: 24,
  overlayPosY: 96,
  refreshTimeoutMs: 9000,
  workflowMode: 'interactive'
};

export const RUNTIME_POLICY = {
  buildFlavor: BUILD_FLAVOR,
  allowBackendOverrides: ALLOW_BACKEND_OVERRIDES,
  enableSubmitAnalytics: ENABLE_SUBMIT_ANALYTICS
} as const;

export function sanitizeSettings(input?: Partial<ExtensionSettings> | null): ExtensionSettings {
  const next: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    ...(input || {})
  };

  if (!ALLOW_BACKEND_OVERRIDES) {
    next.backendBaseUrl = DEFAULT_SETTINGS.backendBaseUrl;
    next.backendBaseUrlFallbacks = [...DEFAULT_SETTINGS.backendBaseUrlFallbacks];
  } else {
    next.backendBaseUrl = String(next.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl).trim() || DEFAULT_SETTINGS.backendBaseUrl;
    next.backendBaseUrlFallbacks = Array.isArray(next.backendBaseUrlFallbacks)
      ? next.backendBaseUrlFallbacks.map((item) => String(item || '').trim()).filter(Boolean)
      : [...DEFAULT_SETTINGS.backendBaseUrlFallbacks];
  }

  next.refreshTimeoutMs =
    Number.isFinite(next.refreshTimeoutMs) && Number(next.refreshTimeoutMs) > 0
      ? Number(next.refreshTimeoutMs)
      : DEFAULT_SETTINGS.refreshTimeoutMs;
  next.workflowMode = next.workflowMode === 'fast' ? 'fast' : 'interactive';

  return next;
}
