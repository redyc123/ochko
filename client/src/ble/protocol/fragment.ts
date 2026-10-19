import { ByteWriter } from './bytes';
import { HEADER_SIZE, HeaderFlags, decodeHeader, encodeHeader, type PacketHeader } from './header';

/**
 * Режет уже закодированный пакет (заголовок + payload) на фрагменты, каждый
 * не длиннее maxPacketSize байт (включая заголовок). Если пакет и так влезает,
 * возвращает [пакет] без изменений флагов.
 */
export function fragmentPacket(packet: Uint8Array, maxPacketSize: number): Uint8Array[] {
  if (packet.length <= maxPacketSize) {
    return [packet];
  }
  const { header } = decodeHeader(packet);
  const payload = packet.subarray(HEADER_SIZE);
  const chunkSize = maxPacketSize - HEADER_SIZE;
  if (chunkSize <= 0) {
    throw new RangeError('fragmentPacket: maxPacketSize слишком мал для заголовка');
  }
  const fragments: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkSize) {
    const isLast = offset + chunkSize >= payload.length;
    const chunk = payload.subarray(offset, offset + chunkSize);
    const fragHeader: PacketHeader = {
      ver: header.ver,
      type: header.type,
      flags: isLast ? HeaderFlags.LAST_FRAGMENT : HeaderFlags.CONTINUATION,
      seq: header.seq,
    };
    fragments.push(new ByteWriter().bytes(encodeHeader(fragHeader)).bytes(chunk).toUint8Array());
  }
  return fragments;
}

export interface ReassembledPacket {
  header: PacketHeader;
  payload: Uint8Array;
}

/**
 * Собирает фрагменты одного направления (display/events/control) обратно в
 * цельные пакеты. Пакет считается полным, когда во фрагменте не выставлен
 * бит CONTINUATION — так работает и обычный, нефрагментированный пакет
 * (flags = 0), и последний кусок фрагментированного сообщения.
 */
export class PacketReassembler {
  private buffers = new Map<number, { header: PacketHeader; chunks: Uint8Array[] }>();

  /** Возвращает собранный пакет, когда он завершён, иначе null. */
  push(fragment: Uint8Array): ReassembledPacket | null {
    const { header, reader } = decodeHeader(fragment);
    const payload = fragment.subarray(reader.offset);
    const pending = this.buffers.get(header.seq) ?? { header, chunks: [] };
    pending.chunks.push(payload);

    const isContinuing = (header.flags & HeaderFlags.CONTINUATION) !== 0;
    if (isContinuing) {
      this.buffers.set(header.seq, pending);
      return null;
    }

    this.buffers.delete(header.seq);
    const totalLength = pending.chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of pending.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // Собранный пакет уже не фрагмент — flags сбрасываем в 0 независимо от того,
    // какими были флаги у отдельных кадров.
    return { header: { ...pending.header, flags: 0 }, payload: merged };
  }
}
