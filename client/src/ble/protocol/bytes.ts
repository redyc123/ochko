export class ByteWriter {
  private chunks: number[] = [];

  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }

  i16(value: number): this {
    const v = value < 0 ? value + 0x10000 : value;
    this.chunks.push(v & 0xff, (v >> 8) & 0xff);
    return this;
  }

  u16(value: number): this {
    this.chunks.push(value & 0xff, (value >> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    this.chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  bytes(data: Uint8Array): this {
    for (let i = 0; i < data.length; i += 1) {
      this.chunks.push(data[i] ?? 0);
    }
    return this;
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

export class ByteReader {
  private pos = 0;

  constructor(private readonly data: Uint8Array) {}

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.data.length - this.pos;
  }

  private need(n: number): void {
    if (this.remaining < n) {
      throw new RangeError(
        `ByteReader: нужно ${n} байт, осталось ${this.remaining} (offset=${this.pos})`,
      );
    }
  }

  u8(): number {
    this.need(1);
    const v = this.data[this.pos] as number;
    this.pos += 1;
    return v;
  }

  i16(): number {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u16(): number {
    this.need(2);
    const v = (this.data[this.pos] as number) | ((this.data[this.pos + 1] as number) << 8);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const b0 = this.data[this.pos] as number;
    const b1 = this.data[this.pos + 1] as number;
    const b2 = this.data[this.pos + 2] as number;
    const b3 = this.data[this.pos + 3] as number;
    this.pos += 4;
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const slice = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
}

/** Кодирует строку в UTF-8 без нулевого терминатора. */
export function utf8Encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/** Декодирует UTF-8 байты в строку. */
export function utf8Decode(input: Uint8Array): string {
  return new TextDecoder('utf-8').decode(input);
}

/**
 * Обрезает строку до maxBytes байт в UTF-8, не разрывая символ посередине
 * (важно для кириллицы — 2 байта на букву).
 */
export function truncateUtf8(input: string, maxBytes: number): string {
  const encoded = utf8Encode(input);
  if (encoded.length <= maxBytes) {
    return input;
  }
  let end = maxBytes;
  // UTF-8: байты продолжения символа имеют вид 10xxxxxx — не резать посередине.
  while (end > 0 && (encoded[end] as number) >= 0x80 && (encoded[end] as number) < 0xc0) {
    end -= 1;
  }
  return utf8Decode(encoded.subarray(0, end));
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hexToBytes: нечётная длина строки');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Собственная реализация base64 (без `Buffer`/`atob`, которых нет в Hermes
 * «из коробки») — react-native-ble-plx передаёт значения характеристик
 * именно в base64.
 */
export function base64Encode(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const b0 = data[i] as number;
    const b1 = data[i + 1];
    const b2 = data[i + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out +=
      b1 === undefined
        ? '='
        : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}
