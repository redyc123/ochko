/**
 * Перенос текста на экран 72×40 (шрифт 6×8 → 12 символов × 5 строк, ТЗ §1).
 * Работает на уровне символов (строка уже декодирована из UTF-8 байтов —
 * обрезка до байтового лимита происходит раньше, при кодировании пакета).
 */
export function wrapToLines(text: string, maxCols = 12): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > maxCols) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += maxCols) {
        lines.push(word.slice(i, i + maxCols));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCols) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/** Разбивает строки на страницы по maxRows — листаются коротким нажатием D1. */
export function paginate<T>(lines: readonly T[], maxRows = 5): T[][] {
  if (lines.length === 0) {
    return [[]];
  }
  const pages: T[][] = [];
  for (let i = 0; i < lines.length; i += maxRows) {
    pages.push(lines.slice(i, i + maxRows));
  }
  return pages;
}
