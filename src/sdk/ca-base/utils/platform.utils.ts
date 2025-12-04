const MEMORYMAP: Map<string, string> = new Map()

export class PlatformUtils {
  static storageSetItem(key: string, value: string) {
    if (typeof window === 'undefined') {
      MEMORYMAP.set(key, value)
      return;
    }

    window.localStorage.setItem(key, value);
  }

  static storageGetItem(key: string): string | null {
    if (typeof window === 'undefined') {
      const v = MEMORYMAP.get(key)
      return v ? v : null
    }

    return window.localStorage.getItem(key);
  }

  static async cryptoGetRandomValues(bytes: Uint8Array): Promise<Uint8Array> {
    if (typeof window === 'undefined') {
      const crypto = await import("crypto");
      return crypto.getRandomValues(bytes);
    }

    return window.crypto.getRandomValues(bytes)
  }

  static locationProtocol(): string {
    if (typeof window === 'undefined') {
      return "https"
    }

    return window.location.protocol
  }

  static locationHost(): string {
    if (typeof window === 'undefined') {
      return "localhost"
    }

    return window.location.host
  }

  static locationOrigin(): string {
    if (typeof window === 'undefined') {
      return "https://localhost"
    }

    return window.location.origin
  }

  static isBrowser(): boolean {
    return typeof window !== 'undefined'
  }
}
