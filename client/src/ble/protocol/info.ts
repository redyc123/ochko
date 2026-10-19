import { ByteReader, ByteWriter } from './bytes';

export const Capability = {
  AUDIO: 1 << 0,
  WAKEWORD: 1 << 1,
  NAV_ICONS: 1 << 2,
  CYRILLIC: 1 << 3,
} as const;

export interface GlassesCapabilities {
  audio: boolean;
  wakeword: boolean;
  navIcons: boolean;
  cyrillic: boolean;
}

export interface GlassesInfo {
  protoVer: number;
  fwMajor: number;
  fwMinor: number;
  fwPatch: number;
  caps: GlassesCapabilities;
}

export function encodeInfo(info: GlassesInfo): Uint8Array {
  const caps =
    (info.caps.audio ? Capability.AUDIO : 0) |
    (info.caps.wakeword ? Capability.WAKEWORD : 0) |
    (info.caps.navIcons ? Capability.NAV_ICONS : 0) |
    (info.caps.cyrillic ? Capability.CYRILLIC : 0);
  return new ByteWriter()
    .u8(info.protoVer)
    .u8(info.fwMajor)
    .u8(info.fwMinor)
    .u8(info.fwPatch)
    .u16(caps)
    .toUint8Array();
}

export function decodeInfo(data: Uint8Array): GlassesInfo {
  const r = new ByteReader(data);
  const protoVer = r.u8();
  const fwMajor = r.u8();
  const fwMinor = r.u8();
  const fwPatch = r.u8();
  const caps = r.u16();
  return {
    protoVer,
    fwMajor,
    fwMinor,
    fwPatch,
    caps: {
      audio: (caps & Capability.AUDIO) !== 0,
      wakeword: (caps & Capability.WAKEWORD) !== 0,
      navIcons: (caps & Capability.NAV_ICONS) !== 0,
      cyrillic: (caps & Capability.CYRILLIC) !== 0,
    },
  };
}
