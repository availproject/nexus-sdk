import { Buffer as _Buffer } from 'buffer';

// Ensure Buffer is on globalThis
if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = _Buffer;
}

// Add polyfills for missing methods
const proto = _Buffer.prototype as any;
if (proto && typeof proto.writeUint32BE !== 'function') {
  if (typeof proto.writeUInt32BE === 'function') {
    // Alias the capital I versions
    proto.writeUint32BE = proto.writeUInt32BE;
    proto.writeUint32LE = proto.writeUInt32LE;
    proto.readUint32BE = proto.readUInt32BE;
    proto.readUint32LE = proto.readUInt32LE;
  } else {
    // Fallback implementations
    proto.writeUint32BE = function (value: number, offset: number = 0) {
      offset = offset >>> 0;
      const normalized = Number(value) >>> 0;
      (this as any)[offset] = (normalized >>> 24) & 0xff;
      (this as any)[offset + 1] = (normalized >>> 16) & 0xff;
      (this as any)[offset + 2] = (normalized >>> 8) & 0xff;
      (this as any)[offset + 3] = normalized & 0xff;
      return offset + 4;
    };
    proto.writeUint32LE = function (value: number, offset: number = 0) {
      offset = offset >>> 0;
      const normalized = Number(value) >>> 0;
      (this as any)[offset] = normalized & 0xff;
      (this as any)[offset + 1] = (normalized >>> 8) & 0xff;
      (this as any)[offset + 2] = (normalized >>> 16) & 0xff;
      (this as any)[offset + 3] = (normalized >>> 24) & 0xff;
      return offset + 4;
    };
    proto.readUint32BE = function (offset: number = 0) {
      offset = offset >>> 0;
      return (
        ((this as any)[offset] * 0x1000000 +
          (((this as any)[offset + 1] << 16) |
            ((this as any)[offset + 2] << 8) |
            (this as any)[offset + 3])) >>>
        0
      );
    };
    proto.readUint32LE = function (offset: number = 0) {
      offset = offset >>> 0;
      return (
        ((this as any)[offset] |
          ((this as any)[offset + 1] << 8) |
          ((this as any)[offset + 2] << 16) |
          ((this as any)[offset + 3] * 0x1000000)) >>>
        0
      );
    };
  }
}

if (!(globalThis as any).process) {
  (globalThis as any).process = { env: { NODE_ENV: 'production' } };
}
