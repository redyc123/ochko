import { ByteReader, ByteWriter } from './bytes';
import { PROTOCOL_VERSION, decodeHeader, encodeHeader } from './header';

export const ControlType = {
  SET_TIME: 0x01,
  BRIGHTNESS: 0x02,
  AUDIO_CTRL: 0x03,
  CONN_PARAMS: 0x04,
} as const;

export const AudioCtrlCmd = { STOP: 0, START: 1 } as const;
export const ConnMode = { ECONOMY: 0, FAST: 1 } as const;

export type ControlMessage =
  | { type: 'SET_TIME'; unix: number; tzMin: number }
  | { type: 'BRIGHTNESS'; level: number }
  | { type: 'AUDIO_CTRL'; cmd: number }
  | { type: 'CONN_PARAMS'; mode: number };

function encodePayload(msg: ControlMessage): { type: number; payload: Uint8Array } {
  switch (msg.type) {
    case 'SET_TIME':
      return {
        type: ControlType.SET_TIME,
        payload: new ByteWriter().u32(msg.unix).i16(msg.tzMin).toUint8Array(),
      };
    case 'BRIGHTNESS':
      return {
        type: ControlType.BRIGHTNESS,
        payload: new ByteWriter().u8(msg.level).toUint8Array(),
      };
    case 'AUDIO_CTRL':
      return { type: ControlType.AUDIO_CTRL, payload: new ByteWriter().u8(msg.cmd).toUint8Array() };
    case 'CONN_PARAMS':
      return {
        type: ControlType.CONN_PARAMS,
        payload: new ByteWriter().u8(msg.mode).toUint8Array(),
      };
  }
}

export function encodeControlMessage(msg: ControlMessage, seq: number, flags = 0): Uint8Array {
  const { type, payload } = encodePayload(msg);
  return new ByteWriter()
    .bytes(encodeHeader({ ver: PROTOCOL_VERSION, type, flags, seq }))
    .bytes(payload)
    .toUint8Array();
}

export function decodeControlMessage(packet: Uint8Array): { seq: number; message: ControlMessage } {
  const { header, reader } = decodeHeader(packet);
  const r = new ByteReader(packet.subarray(reader.offset));
  switch (header.type) {
    case ControlType.SET_TIME:
      return { seq: header.seq, message: { type: 'SET_TIME', unix: r.u32(), tzMin: r.i16() } };
    case ControlType.BRIGHTNESS:
      return { seq: header.seq, message: { type: 'BRIGHTNESS', level: r.u8() } };
    case ControlType.AUDIO_CTRL:
      return { seq: header.seq, message: { type: 'AUDIO_CTRL', cmd: r.u8() } };
    case ControlType.CONN_PARAMS:
      return { seq: header.seq, message: { type: 'CONN_PARAMS', mode: r.u8() } };
    default:
      throw new RangeError(`decodeControlMessage: неизвестный type 0x${header.type.toString(16)}`);
  }
}
