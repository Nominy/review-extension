export type BuildFlavor = 'dev' | 'release';

declare const __BUILD_FLAVOR__: BuildFlavor;
declare const __DEFAULT_BACKEND_BASE_URL__: string;
declare const __DEFAULT_BACKEND_BASE_URL_FALLBACKS__: string[];
declare const __ALLOW_BACKEND_OVERRIDES__: boolean;
declare const __ENABLE_SUBMIT_ANALYTICS__: boolean;

export const BUILD_FLAVOR = __BUILD_FLAVOR__;
export const DEFAULT_BACKEND_BASE_URL = __DEFAULT_BACKEND_BASE_URL__;
export const DEFAULT_BACKEND_BASE_URL_FALLBACKS = __DEFAULT_BACKEND_BASE_URL_FALLBACKS__;
export const ALLOW_BACKEND_OVERRIDES = __ALLOW_BACKEND_OVERRIDES__;
export const ENABLE_SUBMIT_ANALYTICS = __ENABLE_SUBMIT_ANALYTICS__;
export const IS_RELEASE_BUILD = BUILD_FLAVOR === 'release';
