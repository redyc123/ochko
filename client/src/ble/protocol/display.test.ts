import { bytesToHex, hexToBytes } from './bytes';
import {
  NotifyApp,
  decodeDisplayMessage,
  encodeDisplayMessage,
  STREET_MAX_BYTES,
  type DisplayMessage,
} from './display';

// Hex-примеры совпадают байт-в-байт с docs/PROTOCOL.md §3 — это намеренно:
// один и тот же вектор проверяет и документ, и код.
describe('display: NOTIFY', () => {
  const msg: DisplayMessage = {
    type: 'NOTIFY',
    app: NotifyApp.MESSENGER,
    prio: 1,
    ttlS: 0,
    title: 'Telegram',
    body: 'Мама: позвони',
  };
  const hex = '010100070301000854656c656772616d18d09cd0b0d0bcd0b03a20d0bfd0bed0b7d0b2d0bed0bdd0b8';

  it('кодирует байт-в-байт', () => {
    expect(bytesToHex(encodeDisplayMessage(msg, 7))).toBe(hex);
  });

  it('декодирует обратно', () => {
    const { seq, message } = decodeDisplayMessage(hexToBytes(hex));
    expect(seq).toBe(7);
    expect(message).toEqual(msg);
  });
});

describe('display: NAV_MANEUVER', () => {
  const msg: DisplayMessage = {
    type: 'NAV_MANEUVER',
    icon: 7,
    exitNo: 0,
    distM: 150,
    totalM: 1200,
    etaMin: 18,
    street: 'ул. Ленина',
  };
  const hex = '0110000307009600b0040000120012d183d0bb2e20d09bd0b5d0bdd0b8d0bdd0b0';

  it('кодирует байт-в-байт', () => {
    expect(bytesToHex(encodeDisplayMessage(msg, 3))).toBe(hex);
  });

  it('декодирует обратно', () => {
    const { seq, message } = decodeDisplayMessage(hexToBytes(hex));
    expect(seq).toBe(3);
    expect(message).toEqual(msg);
  });

  it('dist_m = 0xFFFF означает «неизвестно»', () => {
    const unknown: DisplayMessage = { ...msg, distM: null };
    const encoded = encodeDisplayMessage(unknown, 3);
    const { message } = decodeDisplayMessage(encoded);
    expect(message).toEqual(unknown);
    expect(bytesToHex(encoded)).toContain('ffff');
  });

  it('обрезает название улицы до 24 байт по границе символа', () => {
    const long: DisplayMessage = { ...msg, street: 'Улица Двадцать Пятого Октября' };
    const encoded = encodeDisplayMessage(long, 3);
    const { message } = decodeDisplayMessage(encoded);
    if (message.type !== 'NAV_MANEUVER') throw new Error('unreachable');
    expect(new TextEncoder().encode(message.street).length).toBeLessThanOrEqual(STREET_MAX_BYTES);
  });
});

describe('display: NAV_PROGRESS', () => {
  const msg: DisplayMessage = { type: 'NAV_PROGRESS', distM: 140, totalM: 1190, etaMin: 18 };
  const hex = '011100048c00a60400001200';

  it('кодирует и декодирует', () => {
    const encoded = encodeDisplayMessage(msg, 4);
    expect(bytesToHex(encoded)).toBe(hex);
    expect(decodeDisplayMessage(encoded).message).toEqual(msg);
  });
});

describe('display: NAV_STATE', () => {
  it('кодирует и декодирует', () => {
    const msg: DisplayMessage = { type: 'NAV_STATE', state: 2 };
    const encoded = encodeDisplayMessage(msg, 5);
    expect(bytesToHex(encoded)).toBe('0112000502');
    expect(decodeDisplayMessage(encoded).message).toEqual(msg);
  });
});

describe('display: AGENT_STATE', () => {
  it('кодирует и декодирует', () => {
    const msg: DisplayMessage = { type: 'AGENT_STATE', state: 2 };
    const encoded = encodeDisplayMessage(msg, 9);
    expect(bytesToHex(encoded)).toBe('0120000902');
    expect(decodeDisplayMessage(encoded).message).toEqual(msg);
  });
});

describe('display: AGENT_TEXT', () => {
  const msg: DisplayMessage = { type: 'AGENT_TEXT', ttlS: 10, text: 'Будильник на 7:00 поставлен' };
  const hex =
    '0121000a0a2fd091d183d0b4d0b8d0bbd18cd0bdd0b8d0ba20d0bdd0b020373a303020d0bfd0bed181d182d0b0d0b2d0bbd0b5d0bd';

  it('кодирует байт-в-байт', () => {
    expect(bytesToHex(encodeDisplayMessage(msg, 10))).toBe(hex);
  });

  it('декодирует обратно', () => {
    expect(decodeDisplayMessage(hexToBytes(hex)).message).toEqual(msg);
  });
});

describe('display: CONFIRM', () => {
  const msg: DisplayMessage = { type: 'CONFIRM', id: 1, timeoutS: 5, text: 'Позвонить Маме?' };
  const hex = '0122000b01051cd09fd0bed0b7d0b2d0bed0bdd0b8d182d18c20d09cd0b0d0bcd0b53f';

  it('кодирует байт-в-байт', () => {
    expect(bytesToHex(encodeDisplayMessage(msg, 11))).toBe(hex);
  });

  it('декодирует обратно', () => {
    expect(decodeDisplayMessage(hexToBytes(hex)).message).toEqual(msg);
  });
});

describe('display: CLEAR', () => {
  it('кодирует и декодирует', () => {
    const msg: DisplayMessage = { type: 'CLEAR', layer: 0 };
    const encoded = encodeDisplayMessage(msg, 12);
    expect(bytesToHex(encoded)).toBe('017f000c00');
    expect(decodeDisplayMessage(encoded).message).toEqual(msg);
  });
});
