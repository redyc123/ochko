import {
  ByteReader,
  ByteWriter,
  base64Decode,
  base64Encode,
  bytesToHex,
  hexToBytes,
  truncateUtf8,
  utf8Decode,
  utf8Encode,
} from '@/ble/protocol/bytes';

describe('ByteWriter/ByteReader', () => {
  it('кодирует и читает все числовые типы little-endian', () => {
    const w = new ByteWriter().u8(0xab).u16(0x1234).u32(0x12345678).i16(-1).i16(-30000);
    const bytes = w.toUint8Array();
    expect(bytesToHex(bytes)).toBe('ab341278563412ffffd08a');

    const r = new ByteReader(bytes);
    expect(r.u8()).toBe(0xab);
    expect(r.u16()).toBe(0x1234);
    expect(r.u32()).toBe(0x12345678);
    expect(r.i16()).toBe(-1);
    expect(r.i16()).toBe(-30000);
  });

  it('читает произвольные байты', () => {
    const r = new ByteReader(hexToBytes('010203ff'));
    expect(Array.from(r.bytes(2))).toEqual([1, 2]);
    expect(Array.from(r.bytes(2))).toEqual([3, 255]);
  });

  it('бросает ошибку при чтении за пределы буфера', () => {
    const r = new ByteReader(new Uint8Array([1]));
    expect(() => r.u32()).toThrow(RangeError);
  });
});

describe('utf8 helpers', () => {
  it('кодирует и декодирует кириллицу без искажений', () => {
    const text = 'Привет, О.Ч.К.О.!';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('truncateUtf8 не режет символ посередине', () => {
    const text = 'ул. Ленина'; // 18 байт в UTF-8
    expect(utf8Encode(text).length).toBe(18);
    expect(truncateUtf8(text, 18)).toBe(text);
    // 17 байт обрезало бы кириллическую букву «а» пополам — должно откатиться к 16
    const truncated = truncateUtf8(text, 17);
    expect(utf8Encode(truncated).length).toBeLessThanOrEqual(17);
    expect(() => utf8Decode(utf8Encode(truncated))).not.toThrow();
  });

  it('truncateUtf8 не трогает короткие строки', () => {
    expect(truncateUtf8('abc', 10)).toBe('abc');
  });
});

describe('base64 helpers', () => {
  it('известный вектор: "man" -> "bWFu"', () => {
    expect(base64Encode(utf8Encode('man'))).toBe('bWFu');
    expect(utf8Decode(base64Decode('bWFu'))).toBe('man');
  });

  it('паддинг для длины, не кратной 3 ("ba" -> "YmE=")', () => {
    expect(base64Encode(utf8Encode('ba'))).toBe('YmE=');
    expect(utf8Decode(base64Decode('YmE='))).toBe('ba');
  });

  it('round-trip для произвольных байт, включая 0x00 и 0xFF', () => {
    const bytes = new Uint8Array([0, 255, 1, 254, 128, 127, 16, 166, 0, 0]);
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });

  it('пустой массив кодируется в пустую строку', () => {
    expect(base64Encode(new Uint8Array(0))).toBe('');
    expect(base64Decode('')).toEqual(new Uint8Array(0));
  });
});

describe('hex helpers', () => {
  it('bytesToHex/hexToBytes — взаимно обратные', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });
});
