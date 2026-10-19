import { bytesToHex, hexToBytes } from './bytes';
import { decodeControlMessage, encodeControlMessage, type ControlMessage } from './control';

describe('control', () => {
  it('SET_TIME', () => {
    const msg: ControlMessage = { type: 'SET_TIME', unix: 1792000000, tzMin: 300 };
    const encoded = encodeControlMessage(msg, 1);
    expect(bytesToHex(encoded)).toBe('0101000100c0cf6a2c01');
    expect(decodeControlMessage(hexToBytes('0101000100c0cf6a2c01')).message).toEqual(msg);
  });

  it('BRIGHTNESS', () => {
    const msg: ControlMessage = { type: 'BRIGHTNESS', level: 180 };
    const encoded = encodeControlMessage(msg, 2);
    expect(bytesToHex(encoded)).toBe('01020002b4');
    expect(decodeControlMessage(hexToBytes('01020002b4')).message).toEqual(msg);
  });

  it('AUDIO_CTRL старт записи', () => {
    const msg: ControlMessage = { type: 'AUDIO_CTRL', cmd: 1 };
    const encoded = encodeControlMessage(msg, 3);
    expect(bytesToHex(encoded)).toBe('0103000301');
    expect(decodeControlMessage(hexToBytes('0103000301')).message).toEqual(msg);
  });

  it('CONN_PARAMS быстрый режим', () => {
    const msg: ControlMessage = { type: 'CONN_PARAMS', mode: 1 };
    const encoded = encodeControlMessage(msg, 4);
    expect(bytesToHex(encoded)).toBe('0104000401');
    expect(decodeControlMessage(hexToBytes('0104000401')).message).toEqual(msg);
  });

  it('tz_min — знаковое число (отрицательные часовые пояса)', () => {
    const msg: ControlMessage = { type: 'SET_TIME', unix: 0, tzMin: -480 };
    const encoded = encodeControlMessage(msg, 1);
    expect(decodeControlMessage(encoded).message).toEqual(msg);
  });
});
