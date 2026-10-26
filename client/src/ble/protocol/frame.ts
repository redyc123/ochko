import { ByteWriter } from './bytes';
import { encodeHeader } from './header';

/**
 * Пакет FRAME протокола v2 (okko/docs/PROTOCOL.md §3): очки больше ничего не
 * рисуют сами, телефон шлёт готовый прямоугольник в формате памяти SSD1306
 * (MONO_VLSB: страница за страницей, бит0 = верхний пиксель столбца).
 */
export const FRAME_PROTOCOL_VERSION = 2;
export const FRAME_TYPE = 0x30;

export const SCREEN_WIDTH = 72;
export const SCREEN_HEIGHT = 40;
export const SCREEN_PAGES = 5;

export const FrameEncoding = { RAW: 0, PACKBITS: 1 } as const;

export interface FrameRect {
  x: number;
  page: number;
  w: number;
  hPages: number;
}

/** PackBits так, как его распаковывает прошивка: повтор кодируется уже с 2 байт. */
export function packBitsEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    let run = 1;
    while (i + run < data.length && run < 128 && data[i + run] === data[i]) run += 1;
    if (run >= 2) {
      out.push(257 - run, data[i]!);
      i += run;
      continue;
    }
    const start = i;
    while (
      i < data.length &&
      i - start < 128 &&
      !(i + 1 < data.length && data[i + 1] === data[i])
    ) {
      i += 1;
    }
    out.push(i - start - 1);
    for (let j = start; j < i; j += 1) out.push(data[j]!);
  }
  return Uint8Array.from(out);
}

/** Кодирует FRAME, сам выбирает меньший из RAW и PackBits. */
export function encodeFrame(rect: FrameRect, data: Uint8Array, seq: number): Uint8Array {
  if (data.length !== rect.w * rect.hPages) {
    throw new RangeError('encodeFrame: длина данных не равна w × h_pages');
  }
  const packed = packBitsEncode(data);
  const usePackBits = packed.length <= data.length;
  return new ByteWriter()
    .bytes(encodeHeader({ ver: FRAME_PROTOCOL_VERSION, type: FRAME_TYPE, flags: 0, seq }))
    .u8(rect.x)
    .u8(rect.page)
    .u8(rect.w)
    .u8(rect.hPages)
    .u8(usePackBits ? FrameEncoding.PACKBITS : FrameEncoding.RAW)
    .bytes(usePackBits ? packed : data)
    .toUint8Array();
}
