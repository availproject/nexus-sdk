import { Buffer as _Buffer } from 'buffer';

// Ensure Buffer is on globalThis
if (!globalThis.Buffer) {
  globalThis.Buffer = _Buffer;
}

// Add polyfills for missing methods
const proto = _Buffer.prototype;
if (proto && typeof proto.writeUint32BE !== 'function') {
  if (typeof proto.writeUInt32BE === 'function') {
    // Alias the capital I versions
    proto.writeUint32BE = proto.writeUInt32BE;
    proto.writeUint32LE = proto.writeUInt32LE;
    proto.readUint32BE = proto.readUInt32BE;
    proto.readUint32LE = proto.readUInt32LE;
  } else {
    // Fallback implementations
    proto.writeUint32BE = function (value: number, offset = 0) {
      this[offset] = offset >>> 0;
      const normalized = Number(value) >>> 0;
      this[offset] = (normalized >>> 24) & 0xff;
      this[offset + 1] = (normalized >>> 16) & 0xff;
      this[offset + 2] = (normalized >>> 8) & 0xff;
      this[offset + 3] = normalized & 0xff;
      return offset + 4;
    };
    proto.writeUint32LE = function (value: number, offset = 0) {
      this[offset] = offset >>> 0;
      const normalized = Number(value) >>> 0;
      this[offset] = normalized & 0xff;
      this[offset + 1] = (normalized >>> 8) & 0xff;
      this[offset + 2] = (normalized >>> 16) & 0xff;
      this[offset + 3] = (normalized >>> 24) & 0xff;
      return offset + 4;
    };
    proto.readUint32BE = function (offset = 0) {
      this[offset] = offset >>> 0;
      return (
        (this[offset] * 0x1000000 +
          ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3])) >>>
        0
      );
    };
    proto.readUint32LE = function (offset = 0) {
      this[offset] = offset >>> 0;
      return (
        (this[offset] |
          (this[offset + 1] << 8) |
          (this[offset + 2] << 16) |
          (this[offset + 3] * 0x1000000)) >>>
        0
      );
    };
  }
}

if (!globalThis.process) {
  // @ts-expect-error NodeJS.Process is not defined in globalThis, so simple process object is added
  globalThis.process = { env: { NODE_ENV: 'production' } };
}
