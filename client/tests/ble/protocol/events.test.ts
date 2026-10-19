import { bytesToHex, hexToBytes } from '@/ble/protocol/bytes';
import { decodeEvent, encodeEvent, type GlassesEvent } from '@/ble/protocol/events';

describe('events', () => {
  it('BUTTON короткое нажатие', () => {
    const event: GlassesEvent = { type: 'BUTTON', kind: 1 };
    const encoded = encodeEvent(event, 1);
    expect(bytesToHex(encoded)).toBe('0101000101');
    expect(decodeEvent(hexToBytes('0101000101')).event).toEqual(event);
  });

  it('WAKEWORD без payload', () => {
    const event: GlassesEvent = { type: 'WAKEWORD' };
    const encoded = encodeEvent(event, 2);
    expect(bytesToHex(encoded)).toBe('01020002');
    expect(decodeEvent(hexToBytes('01020002')).event).toEqual(event);
  });

  it('CONFIRM_RESULT да', () => {
    const event: GlassesEvent = { type: 'CONFIRM_RESULT', id: 1, result: true };
    const encoded = encodeEvent(event, 13);
    expect(bytesToHex(encoded)).toBe('0103000d0101');
    expect(decodeEvent(hexToBytes('0103000d0101')).event).toEqual(event);
  });

  it('BATTERY', () => {
    const event: GlassesEvent = { type: 'BATTERY', percent: 82, mv: 4012, charging: false };
    const encoded = encodeEvent(event, 14);
    expect(bytesToHex(encoded)).toBe('0104000e52ac0f00');
    expect(decodeEvent(hexToBytes('0104000e52ac0f00')).event).toEqual(event);
  });

  it('ERROR с текстом', () => {
    const event: GlassesEvent = { type: 'ERROR', code: 1, text: 'BLE write timeout' };
    const hex = '0105000f0111424c452077726974652074696d656f7574';
    expect(bytesToHex(encodeEvent(event, 15))).toBe(hex);
    expect(decodeEvent(hexToBytes(hex)).event).toEqual(event);
  });
});
