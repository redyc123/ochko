import { ByteWriter, bytesToHex } from './bytes';
import { encodeHeader } from './header';
import { PacketReassembler, fragmentPacket } from './fragment';

function buildPacket(type: number, seq: number, payloadLen: number): Uint8Array {
  const payload = new Uint8Array(payloadLen);
  for (let i = 0; i < payloadLen; i += 1) payload[i] = i & 0xff;
  return new ByteWriter()
    .bytes(encodeHeader({ ver: 1, type, flags: 0, seq }))
    .bytes(payload)
    .toUint8Array();
}

describe('fragmentPacket', () => {
  it('не трогает пакет, который влезает целиком', () => {
    const packet = buildPacket(0x10, 1, 10);
    expect(fragmentPacket(packet, 20)).toEqual([packet]);
  });

  it('режет payload на кадры, сохраняя seq и помечая последний кадр', () => {
    const packet = buildPacket(0x10, 5, 10); // 4 байта заголовка + 10 payload = 14
    const fragments = fragmentPacket(packet, 8); // 4 заголовка + 4 payload на кадр
    expect(fragments.length).toBe(3); // 4 + 4 + 2 байта payload
    expect(bytesToHex(fragments[0] as Uint8Array)).toBe('0110010500010203');
    expect(bytesToHex(fragments[1] as Uint8Array)).toBe('0110010504050607');
    expect(bytesToHex(fragments[2] as Uint8Array)).toBe('011002050809');
  });
});

describe('PacketReassembler', () => {
  it('собирает фрагменты обратно в исходный payload', () => {
    const packet = buildPacket(0x10, 5, 10);
    const fragments = fragmentPacket(packet, 8);
    const reassembler = new PacketReassembler();
    expect(reassembler.push(fragments[0] as Uint8Array)).toBeNull();
    expect(reassembler.push(fragments[1] as Uint8Array)).toBeNull();
    const result = reassembler.push(fragments[2] as Uint8Array);
    expect(result).not.toBeNull();
    expect(result?.header).toEqual({ ver: 1, type: 0x10, flags: 0, seq: 5 });
    expect(bytesToHex(result!.payload)).toBe('00010203040506070809');
  });

  it('пропускает нефрагментированный пакет сразу (flags=0)', () => {
    const packet = buildPacket(0x12, 9, 1);
    const reassembler = new PacketReassembler();
    const result = reassembler.push(packet);
    expect(result).not.toBeNull();
    expect(result?.header.seq).toBe(9);
  });

  it('не путает параллельные сообщения с разными seq', () => {
    const a = fragmentPacket(buildPacket(0x10, 1, 10), 8);
    const b = fragmentPacket(buildPacket(0x10, 2, 10), 8);
    const reassembler = new PacketReassembler();
    reassembler.push(a[0] as Uint8Array);
    reassembler.push(b[0] as Uint8Array);
    reassembler.push(b[1] as Uint8Array);
    const doneB = reassembler.push(b[2] as Uint8Array);
    expect(doneB?.header.seq).toBe(2);
    const doneA = reassembler.push(a[1] as Uint8Array) ?? reassembler.push(a[2] as Uint8Array);
    expect(doneA?.header.seq).toBe(1);
  });
});
