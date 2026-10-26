import { SCREEN_HEIGHT, SCREEN_PAGES, SCREEN_WIDTH } from '../ble/protocol/frame';
import { GLYPH_ADVANCE, GLYPH_HEIGHT, glyphColumns, normalizeText } from './font5x7';

/** Монохромный кадр 72×40 сразу в формате памяти SSD1306 (MONO_VLSB). */
export class Bitmap {
  readonly data = new Uint8Array(SCREEN_WIDTH * SCREEN_PAGES);

  setPixel(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) return;
    this.data[(y >> 3) * SCREEN_WIDTH + x]! |= 1 << (y & 7);
  }

  getPixel(x: number, y: number): boolean {
    return (this.data[(y >> 3) * SCREEN_WIDTH + x]! & (1 << (y & 7))) !== 0;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) this.setPixel(xx, yy);
    }
  }

  /** Линия Брезенхэма кистью size×size. */
  line(x0: number, y0: number, x1: number, y1: number, size = 2): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x, y, size, size);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  circle(cx: number, cy: number, r: number, filled = false): void {
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        const d = x * x + y * y;
        if (filled ? d <= r * r : d <= r * r && d >= (r - 1.5) * (r - 1.5)) {
          this.setPixel(cx + x, cy + y);
        }
      }
    }
  }

  /** Рисует строку, возвращает ширину в пикселях. scale увеличивает каждый пиксель шрифта. */
  text(s: string, x: number, y: number, scale = 1): number {
    let cx = x;
    for (const ch of normalizeText(s)) {
      const cols = glyphColumns(ch);
      cols.forEach((bits, col) => {
        for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
          if (bits & (1 << row)) this.fillRect(cx + col * scale, y + row * scale, scale, scale);
        }
      });
      cx += GLYPH_ADVANCE * scale;
    }
    return cx - x;
  }

  centeredText(s: string, y: number, scale = 1): void {
    this.text(s, Math.floor((SCREEN_WIDTH - textWidth(s, scale)) / 2), y, scale);
  }
}

/** Ширина строки без хвостового межбуквенного пробела. */
export function textWidth(s: string, scale = 1): number {
  const n = [...normalizeText(s)].length;
  return n === 0 ? 0 : (n * GLYPH_ADVANCE - 1) * scale;
}
