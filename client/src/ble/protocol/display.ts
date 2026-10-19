import { ByteReader, ByteWriter, truncateUtf8, utf8Decode, utf8Encode } from './bytes';
import { PROTOCOL_VERSION, decodeHeader, encodeHeader } from './header';

export const DisplayType = {
  NOTIFY: 0x01,
  NAV_MANEUVER: 0x10,
  NAV_PROGRESS: 0x11,
  NAV_STATE: 0x12,
  AGENT_STATE: 0x20,
  AGENT_TEXT: 0x21,
  CONFIRM: 0x22,
  CLEAR: 0x7f,
} as const;

export const NotifyApp = {
  OTHER: 0,
  SMS: 1,
  CALL: 2,
  MESSENGER: 3,
  MAIL: 4,
  CALENDAR: 5,
} as const;
export type NotifyAppCode = (typeof NotifyApp)[keyof typeof NotifyApp];

export const NotifyPriority = { NORMAL: 0, HIGH: 1 } as const;

export const AgentState = {
  NONE: 0,
  LISTENING: 1,
  THINKING: 2,
  READY: 3,
  ERROR: 4,
  AWAITING_CONFIRM: 5,
} as const;

export const NavState = {
  OFF: 0,
  BUILDING: 1,
  GUIDING: 2,
  REROUTING: 3,
  NO_GPS: 4,
  ARRIVED: 5,
  ROUTE_ERROR: 6,
} as const;

export const ClearLayer = { ALL: 0, NOTIFY: 1, NAV: 2, AGENT: 3 } as const;

/** Расстояние 0xFFFF в NAV_MANEUVER/NAV_PROGRESS означает «неизвестно». */
export const DIST_UNKNOWN = 0xffff;

export const STREET_MAX_BYTES = 24;
export const AGENT_TEXT_MAX_CHARS = 60;
export const NOTIFY_BODY_MAX_CHARS = 60;

export type DisplayMessage =
  | {
      type: 'NOTIFY';
      app: NotifyAppCode;
      prio: number;
      ttlS: number;
      title: string;
      body: string;
    }
  | {
      type: 'NAV_MANEUVER';
      icon: number;
      exitNo: number;
      distM: number | null;
      totalM: number;
      etaMin: number;
      street: string;
    }
  | { type: 'NAV_PROGRESS'; distM: number; totalM: number; etaMin: number }
  | { type: 'NAV_STATE'; state: number }
  | { type: 'AGENT_STATE'; state: number }
  | { type: 'AGENT_TEXT'; ttlS: number; text: string }
  | { type: 'CONFIRM'; id: number; timeoutS: number; text: string }
  | { type: 'CLEAR'; layer: number };

function writeLengthPrefixedUtf8(w: ByteWriter, text: string, maxBytes = 255): ByteWriter {
  const bytes = utf8Encode(maxBytes < 255 ? truncateUtf8(text, maxBytes) : text);
  if (bytes.length > 255) {
    throw new RangeError('writeLengthPrefixedUtf8: строка длиннее 255 байт');
  }
  return w.u8(bytes.length).bytes(bytes);
}

function readLengthPrefixedUtf8(r: ByteReader): string {
  const len = r.u8();
  return utf8Decode(r.bytes(len));
}

function encodePayload(msg: DisplayMessage): { type: number; payload: Uint8Array } {
  switch (msg.type) {
    case 'NOTIFY': {
      const w = new ByteWriter().u8(msg.app).u8(msg.prio).u8(msg.ttlS);
      writeLengthPrefixedUtf8(w, msg.title);
      writeLengthPrefixedUtf8(w, msg.body, NOTIFY_BODY_MAX_CHARS * 4);
      return { type: DisplayType.NOTIFY, payload: w.toUint8Array() };
    }
    case 'NAV_MANEUVER': {
      const w = new ByteWriter()
        .u8(msg.icon)
        .u8(msg.exitNo)
        .u16(msg.distM === null ? DIST_UNKNOWN : msg.distM)
        .u32(msg.totalM)
        .u16(msg.etaMin);
      writeLengthPrefixedUtf8(w, msg.street, STREET_MAX_BYTES);
      return { type: DisplayType.NAV_MANEUVER, payload: w.toUint8Array() };
    }
    case 'NAV_PROGRESS': {
      const w = new ByteWriter().u16(msg.distM).u32(msg.totalM).u16(msg.etaMin);
      return { type: DisplayType.NAV_PROGRESS, payload: w.toUint8Array() };
    }
    case 'NAV_STATE':
      return {
        type: DisplayType.NAV_STATE,
        payload: new ByteWriter().u8(msg.state).toUint8Array(),
      };
    case 'AGENT_STATE':
      return {
        type: DisplayType.AGENT_STATE,
        payload: new ByteWriter().u8(msg.state).toUint8Array(),
      };
    case 'AGENT_TEXT': {
      const w = new ByteWriter().u8(msg.ttlS);
      writeLengthPrefixedUtf8(w, msg.text, AGENT_TEXT_MAX_CHARS * 4);
      return { type: DisplayType.AGENT_TEXT, payload: w.toUint8Array() };
    }
    case 'CONFIRM': {
      const w = new ByteWriter().u8(msg.id).u8(msg.timeoutS);
      writeLengthPrefixedUtf8(w, msg.text);
      return { type: DisplayType.CONFIRM, payload: w.toUint8Array() };
    }
    case 'CLEAR':
      return { type: DisplayType.CLEAR, payload: new ByteWriter().u8(msg.layer).toUint8Array() };
  }
}

export function encodeDisplayMessage(msg: DisplayMessage, seq: number, flags = 0): Uint8Array {
  const { type, payload } = encodePayload(msg);
  return new ByteWriter()
    .bytes(encodeHeader({ ver: PROTOCOL_VERSION, type, flags, seq }))
    .bytes(payload)
    .toUint8Array();
}

export function decodeDisplayMessage(packet: Uint8Array): { seq: number; message: DisplayMessage } {
  const { header, reader } = decodeHeader(packet);
  const message = decodeDisplayPayload(header.type, packet.subarray(reader.offset));
  return { seq: header.seq, message };
}

function decodeDisplayPayload(type: number, payload: Uint8Array): DisplayMessage {
  const r = new ByteReader(payload);
  switch (type) {
    case DisplayType.NOTIFY: {
      const app = r.u8() as NotifyAppCode;
      const prio = r.u8();
      const ttlS = r.u8();
      const title = readLengthPrefixedUtf8(r);
      const body = readLengthPrefixedUtf8(r);
      return { type: 'NOTIFY', app, prio, ttlS, title, body };
    }
    case DisplayType.NAV_MANEUVER: {
      const icon = r.u8();
      const exitNo = r.u8();
      const distRaw = r.u16();
      const totalM = r.u32();
      const etaMin = r.u16();
      const street = readLengthPrefixedUtf8(r);
      return {
        type: 'NAV_MANEUVER',
        icon,
        exitNo,
        distM: distRaw === DIST_UNKNOWN ? null : distRaw,
        totalM,
        etaMin,
        street,
      };
    }
    case DisplayType.NAV_PROGRESS: {
      const distM = r.u16();
      const totalM = r.u32();
      const etaMin = r.u16();
      return { type: 'NAV_PROGRESS', distM, totalM, etaMin };
    }
    case DisplayType.NAV_STATE:
      return { type: 'NAV_STATE', state: r.u8() };
    case DisplayType.AGENT_STATE:
      return { type: 'AGENT_STATE', state: r.u8() };
    case DisplayType.AGENT_TEXT: {
      const ttlS = r.u8();
      const text = readLengthPrefixedUtf8(r);
      return { type: 'AGENT_TEXT', ttlS, text };
    }
    case DisplayType.CONFIRM: {
      const id = r.u8();
      const timeoutS = r.u8();
      const text = readLengthPrefixedUtf8(r);
      return { type: 'CONFIRM', id, timeoutS, text };
    }
    case DisplayType.CLEAR:
      return { type: 'CLEAR', layer: r.u8() };
    default:
      throw new RangeError(`decodeDisplayMessage: неизвестный type 0x${type.toString(16)}`);
  }
}
