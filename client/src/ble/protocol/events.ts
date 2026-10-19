import { ByteReader, ByteWriter, truncateUtf8, utf8Decode, utf8Encode } from './bytes';
import { PROTOCOL_VERSION, decodeHeader, encodeHeader } from './header';

export const EventType = {
  BUTTON: 0x01,
  WAKEWORD: 0x02,
  CONFIRM_RESULT: 0x03,
  BATTERY: 0x04,
  ERROR: 0x05,
} as const;

export const ButtonKind = {
  SHORT: 1,
  HOLD_START: 2,
  RELEASE: 3,
  DOUBLE: 4,
} as const;
export type ButtonKindCode = (typeof ButtonKind)[keyof typeof ButtonKind];

export type GlassesEvent =
  | { type: 'BUTTON'; kind: ButtonKindCode }
  | { type: 'WAKEWORD' }
  | { type: 'CONFIRM_RESULT'; id: number; result: boolean }
  | { type: 'BATTERY'; percent: number; mv: number; charging: boolean }
  | { type: 'ERROR'; code: number; text: string };

function encodePayload(event: GlassesEvent): { type: number; payload: Uint8Array } {
  switch (event.type) {
    case 'BUTTON':
      return { type: EventType.BUTTON, payload: new ByteWriter().u8(event.kind).toUint8Array() };
    case 'WAKEWORD':
      return { type: EventType.WAKEWORD, payload: new Uint8Array(0) };
    case 'CONFIRM_RESULT':
      return {
        type: EventType.CONFIRM_RESULT,
        payload: new ByteWriter()
          .u8(event.id)
          .u8(event.result ? 1 : 0)
          .toUint8Array(),
      };
    case 'BATTERY':
      return {
        type: EventType.BATTERY,
        payload: new ByteWriter()
          .u8(event.percent)
          .u16(event.mv)
          .u8(event.charging ? 1 : 0)
          .toUint8Array(),
      };
    case 'ERROR': {
      const textBytes = utf8Encode(truncateUtf8(event.text, 255));
      return {
        type: EventType.ERROR,
        payload: new ByteWriter()
          .u8(event.code)
          .u8(textBytes.length)
          .bytes(textBytes)
          .toUint8Array(),
      };
    }
  }
}

export function encodeEvent(event: GlassesEvent, seq: number, flags = 0): Uint8Array {
  const { type, payload } = encodePayload(event);
  return new ByteWriter()
    .bytes(encodeHeader({ ver: PROTOCOL_VERSION, type, flags, seq }))
    .bytes(payload)
    .toUint8Array();
}

export function decodeEvent(packet: Uint8Array): { seq: number; event: GlassesEvent } {
  const { header, reader } = decodeHeader(packet);
  const r = new ByteReader(packet.subarray(reader.offset));
  switch (header.type) {
    case EventType.BUTTON:
      return { seq: header.seq, event: { type: 'BUTTON', kind: r.u8() as ButtonKindCode } };
    case EventType.WAKEWORD:
      return { seq: header.seq, event: { type: 'WAKEWORD' } };
    case EventType.CONFIRM_RESULT: {
      const id = r.u8();
      const result = r.u8() === 1;
      return { seq: header.seq, event: { type: 'CONFIRM_RESULT', id, result } };
    }
    case EventType.BATTERY: {
      const percent = r.u8();
      const mv = r.u16();
      const charging = r.u8() === 1;
      return { seq: header.seq, event: { type: 'BATTERY', percent, mv, charging } };
    }
    case EventType.ERROR: {
      const code = r.u8();
      const len = r.u8();
      const text = utf8Decode(r.bytes(len));
      return { seq: header.seq, event: { type: 'ERROR', code, text } };
    }
    default:
      throw new RangeError(`decodeEvent: неизвестный type 0x${header.type.toString(16)}`);
  }
}
