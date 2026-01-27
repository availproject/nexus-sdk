const MEMORYMAP: Map<string, string> = new Map();

type Platform = 'browser' | 'node' | 'react-native';

let _platform: Platform | null = null;

export function detectPlatform(): Platform {
  if (_platform) return _platform;

  const hasBrowserEnv = typeof window !== 'undefined' && typeof document !== 'undefined';

  const hasNavigator = typeof navigator !== 'undefined';

  const isReactNative =
    hasNavigator &&
    (navigator.product === 'ReactNative' || (navigator as any).userAgent?.includes('React Native'));

  const hasHermes = typeof global !== 'undefined' && !!(global as any).HermesInternal;

  if (isReactNative || hasHermes) {
    _platform = 'react-native';
    return _platform;
  }

  if (hasBrowserEnv) {
    _platform = 'browser';
    return _platform;
  }

  _platform = 'node';
  return _platform;
}

export function storageSetItem(key: string, value: string): void {
  if (detectPlatform() === 'browser') {
    window.localStorage.setItem(key, value);
    return;
  }
  MEMORYMAP.set(key, value);
}

export function storageGetItem(key: string): string | null {
  if (detectPlatform() === 'browser') {
    return window.localStorage.getItem(key);
  }
  return MEMORYMAP.get(key) ?? null;
}

export async function cryptoGetRandomValues(bytes: Uint8Array): Promise<Uint8Array> {
  const platform = detectPlatform();

  if (platform === 'browser') {
    return window.crypto.getRandomValues(bytes);
  }

  if (platform === 'react-native') {
    if (globalThis.crypto?.getRandomValues) {
      return globalThis.crypto.getRandomValues(bytes);
    }
    throw new Error(
      'React Native requires crypto polyfill. Install "expo-standard-web-crypto" and import it at app entry.'
    );
  }

  // biome-ignore lint/style/useNodejsImportProtocol: cannot externalize node:crypto
  const crypto = await import('crypto');
  return crypto.getRandomValues(bytes);
}

export function locationProtocol(): string {
  if (detectPlatform() === 'browser') {
    return window.location.protocol;
  }
  return 'https:';
}

export function locationHost(): string {
  if (detectPlatform() === 'browser') {
    return window.location.host;
  }
  return 'localhost';
}

export function locationOrigin(): string {
  if (detectPlatform() === 'browser') {
    return window.location.origin;
  }
  return 'https://localhost';
}

export function isBrowser(): boolean {
  return detectPlatform() === 'browser';
}
