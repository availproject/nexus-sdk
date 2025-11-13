import { Buffer as _Buffer } from 'buffer';

if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = _Buffer;
}

if (!(globalThis as any).process) {
  (globalThis as any).process = { env: { NODE_ENV: 'production' } };
}
