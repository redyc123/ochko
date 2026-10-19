import { bytesToHex, hexToBytes } from './bytes';
import { decodeInfo, encodeInfo, type GlassesInfo } from './info';

describe('info', () => {
  const info: GlassesInfo = {
    protoVer: 1,
    fwMajor: 0,
    fwMinor: 3,
    fwPatch: 1,
    caps: { audio: true, wakeword: true, navIcons: true, cyrillic: true },
  };
  const hex = '010003010f00';

  it('кодирует байт-в-байт', () => {
    expect(bytesToHex(encodeInfo(info))).toBe(hex);
  });

  it('декодирует обратно', () => {
    expect(decodeInfo(hexToBytes(hex))).toEqual(info);
  });

  it('отдельные биты возможностей читаются независимо', () => {
    const onlyAudio: GlassesInfo = {
      protoVer: 1,
      fwMajor: 1,
      fwMinor: 0,
      fwPatch: 0,
      caps: { audio: true, wakeword: false, navIcons: false, cyrillic: false },
    };
    expect(decodeInfo(encodeInfo(onlyAudio))).toEqual(onlyAudio);
  });

  it('proto_ver больше известного — приложение должно это обнаружить', () => {
    const futureProto: GlassesInfo = { ...info, protoVer: 2 };
    const decoded = decodeInfo(encodeInfo(futureProto));
    expect(decoded.protoVer).toBeGreaterThan(1);
  });
});
