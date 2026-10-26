// \b в JS не понимает кириллицу — фраза обрамляется пробелами, и границы слов
// в шаблонах ниже — явные (?<= ) / (?= ).
const word = (body: string): RegExp => new RegExp(`(?<= )(?:${body})(?= )`, 'u');

// Окончания перечислены явно, чтобы «вторник» или «пятница» не сошли за номер
const ADJ = '(?:ый|ой|ий|ая|ья|ое|ье|ую|ью|ого|его|ьего)';
const ORDINALS: [RegExp, number][] = [
  [word(`перв${ADJ}|один|одну`), 1],
  [word(`втор${ADJ}|два|две`), 2],
  [word(`трет${ADJ}|три`), 3],
  [word(`четв[её]рт${ADJ}|четыре`), 4],
  [word(`пят${ADJ}|пять`), 5],
];

const LAST_RE = word(`последн${ADJ}`);
const CANCEL_RE = word('отмен\\S*|не надо|никак\\S*|стоп');
const DIGIT_RE = /(?<= )(\d{1,2})(?= )/;
/** Длинная фраза — скорее новое уточнение («нет, тот что на Тверской»), а не номер. */
const MAX_WORDS = 4;

export type ChoiceParse = { kind: 'index'; index: number } | { kind: 'cancel' } | null;

/**
 * Быстрый разбор ответа на уточнение «какой из адресов?» без LLM: «второй»,
 * «номер 3», «давай последний», «отмена». Индекс — с нуля. Если фраза похожа
 * на что-то другое — null, решает модель.
 */
export function parseChoice(text: string, count: number): ChoiceParse {
  const normalized = text
    .toLowerCase()
    .replace(/[.,!?;:«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length === 0 || normalized.split(' ').length > MAX_WORDS) return null;
  const t = ` ${normalized} `;

  if (CANCEL_RE.test(t)) return { kind: 'cancel' };
  if (LAST_RE.test(t)) return count > 0 ? { kind: 'index', index: count - 1 } : null;

  const digit = t.match(DIGIT_RE);
  if (digit) {
    const n = Number(digit[1]);
    return n >= 1 && n <= count ? { kind: 'index', index: n - 1 } : null;
  }
  for (const [re, n] of ORDINALS) {
    if (re.test(t)) {
      return n <= count ? { kind: 'index', index: n - 1 } : null;
    }
  }
  return null;
}
