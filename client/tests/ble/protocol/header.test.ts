import { bytesToHex, hexToBytes } from '@/ble/protocol/bytes';
import {
  HEADER_SIZE,
  HeaderFlags,
  decodeHeader,
  encodeHeader,
  isUnfragmented,
} from '@/ble/protocol/header';

describe('заголовок пакета', () => {
  it('кодирует байт-в-байт', () => {
    const bytes = encodeHeader({ ver: 1, type: 0x10, flags: 0, seq: 42 });
    expect(bytes.length).toBe(HEADER_SIZE);
    expect(bytesToHex(bytes)).toBe('0110002a');
  });

  it('декодирует обратно', () => {
    const { header, reader } = decodeHeader(hexToBytes('0110002a'));
    expect(header).toEqual({ ver: 1, type: 0x10, flags: 0, seq: 42 });
    expect(reader.offset).toBe(4);
  });

  it('isUnfragmented учитывает только бит CONTINUATION', () => {
    expect(isUnfragmented(0)).toBe(true);
    expect(isUnfragmented(HeaderFlags.LAST_FRAGMENT)).toBe(true);
    expect(isUnfragmented(HeaderFlags.CONTINUATION)).toBe(false);
    expect(isUnfragmented(HeaderFlags.CONTINUATION | HeaderFlags.LAST_FRAGMENT)).toBe(false);
  });
});
