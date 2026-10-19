import { ByteReader, ByteWriter } from './bytes';

export const PROTOCOL_VERSION = 1;

export const HeaderFlags = {
  /** бит0: есть продолжение (это не последний фрагмент) */
  CONTINUATION: 0b0000_0001,
  /** бит1: последний фрагмент сообщения */
  LAST_FRAGMENT: 0b0000_0010,
} as const;

export interface PacketHeader {
  ver: number;
  type: number;
  flags: number;
  seq: number;
}

export const HEADER_SIZE = 4;

export function encodeHeader(header: PacketHeader): Uint8Array {
  return new ByteWriter()
    .u8(header.ver)
    .u8(header.type)
    .u8(header.flags)
    .u8(header.seq)
    .toUint8Array();
}

export function decodeHeader(data: Uint8Array): { header: PacketHeader; reader: ByteReader } {
  const reader = new ByteReader(data);
  const header: PacketHeader = {
    ver: reader.u8(),
    type: reader.u8(),
    flags: reader.u8(),
    seq: reader.u8(),
  };
  return { header, reader };
}

export function isUnfragmented(flags: number): boolean {
  return (flags & HeaderFlags.CONTINUATION) === 0;
}
