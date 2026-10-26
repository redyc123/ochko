import { AGENT_TEXT_MAX_CHARS } from '../ble/protocol/display';
import type { GeocodeResult } from '../nav/geocode';
import type { LatLng } from '../nav/types';
import { LlmError, type LlmMessage, type LlmProvider } from './llm';
import { parseChoice } from './parseChoice';
import {
  AGENT_FUNCTIONS,
  formatDistanceShortRu,
  formatDurationRu,
  shortPlaceName,
  type NavPort,
  type RouteOutcome,
} from './tools';

/** Сколько последних сообщений диалога отдаём модели — оценка, не измерено. */
const MAX_HISTORY_MESSAGES = 20;
/** Защита от зацикливания function calling. */
const MAX_TOOL_STEPS = 4;
/** Сколько вариантов адреса показываем при уточнении. */
const MAX_CANDIDATES = 5;

const SYSTEM_PROMPT = [
  'Ты — голосовой ассистент смарт-очков О.Ч.К.О. Отвечай по-русски, коротко и по делу:',
  'ответ показывается на маленьком экране очков, первые ~60 символов — самое важное.',
  'Без markdown, списков и эмодзи, если о них не просят.',
  'Отвечай на любые вопросы пользователя.',
  'Если просят проложить маршрут, отвести или подсказать дорогу — вызывай navigate_to.',
  'Если navigate_to вернул несколько вариантов — НЕ выбирай сам: коротко перечисли их с номерами',
  'и спроси, какой нужен. Когда пользователь ответит — вызови choose_destination с номером.',
  'Если ничего не найдено — попроси уточнить адрес.',
].join(' ');

export interface AgentReply {
  /** Короткий текст для экрана очков (≤ AGENT_TEXT_MAX_CHARS). */
  display: string;
  /** Полный ответ — для экрана истории в приложении. */
  full: string;
  /** Варианты адреса, если агент ждёт уточнения. */
  candidates: GeocodeResult[];
}

export interface AgentContext {
  now: Date;
  position: LatLng | null;
}

export interface AgentOptions {
  llm: LlmProvider;
  nav: NavPort;
  context?: () => AgentContext;
}

/** Обрезка по границе слова с многоточием. */
export function toDisplayText(text: string, max = AGENT_TEXT_MAX_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

export class Agent {
  private readonly llm: LlmProvider;
  private readonly nav: NavPort;
  private readonly context: () => AgentContext;
  private history: LlmMessage[] = [];
  private pending: GeocodeResult[] = [];

  constructor(options: AgentOptions) {
    this.llm = options.llm;
    this.nav = options.nav;
    this.context = options.context ?? (() => ({ now: new Date(), position: null }));
  }

  get pendingCandidates(): GeocodeResult[] {
    return this.pending;
  }

  /** Пользователь выбрал вариант на экране телефона — уточнение больше не нужно. */
  clearPending(): void {
    this.pending = [];
  }

  reset(): void {
    this.history = [];
    this.pending = [];
  }

  async ask(text: string): Promise<AgentReply> {
    const userText = text.trim();
    if (userText.length === 0) return this.reply('Не расслышал, повторите.');

    // Быстрый путь: ответ на уточнение адреса без похода в LLM
    if (this.pending.length > 0) {
      const choice = parseChoice(userText, this.pending.length);
      if (choice) {
        this.history.push({ role: 'user', content: userText });
        let answer: string;
        if (choice.kind === 'cancel') {
          this.pending = [];
          answer = 'Хорошо, маршрут не строю.';
        } else {
          answer = await this.chooseIndex(choice.index).then((r) => r.message);
        }
        this.history.push({ role: 'assistant', content: answer });
        this.trimHistory();
        return this.reply(answer);
      }
    }

    this.history.push({ role: 'user', content: userText });
    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const result = await this.llm.chat(this.buildMessages(), AGENT_FUNCTIONS);
        if (result.kind === 'text') {
          const answer = result.text || 'Не знаю, что ответить.';
          this.history.push({ role: 'assistant', content: answer });
          this.trimHistory();
          return this.reply(answer);
        }
        this.history.push({
          role: 'assistant',
          content: '',
          functionCall: result.call,
          functionsStateId: result.functionsStateId,
        });
        const output = await this.runTool(result.call.name, result.call.arguments);
        this.history.push({
          role: 'function',
          name: result.call.name,
          content: JSON.stringify(output),
        });
      }
      return this.reply('Не получилось выполнить запрос.');
    } catch (err) {
      // Неотвеченный вопрос не оставляем в истории — иначе модель «ответит» на него позже
      this.dropDanglingTurn();
      const message = err instanceof LlmError ? err.message : 'Ошибка агента.';
      throw new LlmError(message);
    }
  }

  private reply(full: string): AgentReply {
    return { display: toDisplayText(full), full, candidates: this.pending };
  }

  private buildMessages(): LlmMessage[] {
    const { now, position } = this.context();
    const nav = this.nav.status();
    const facts = [
      `Сейчас ${now.toLocaleString('ru-RU')}.`,
      position
        ? `Пользователь в точке ${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}.`
        : 'Положение пользователя неизвестно.',
      nav.destinationName
        ? `Навигация: ${nav.status}, цель — ${nav.destinationName}.`
        : `Навигация: ${nav.status}.`,
    ];
    if (this.pending.length > 0) {
      facts.push(
        'Ждём выбора адреса: ' +
          this.pending.map((c, i) => `${i + 1}) ${shortPlaceName(c.displayName)}`).join('; '),
      );
    }
    return [{ role: 'system', content: `${SYSTEM_PROMPT}\n${facts.join(' ')}` }, ...this.history];
  }

  private async runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'navigate_to':
        return this.navigateTo(String(args.query ?? ''));
      case 'choose_destination': {
        const n = Number(args.number);
        if (!Number.isInteger(n) || n < 1 || n > this.pending.length) {
          return { error: 'Нет варианта с таким номером.' };
        }
        const res = await this.chooseIndex(n - 1);
        return res.ok ? { result: res.message } : { error: res.message };
      }
      case 'stop_navigation':
        this.nav.stop();
        this.pending = [];
        return { result: 'Навигация остановлена.' };
      case 'get_navigation_status':
        return this.nav.status();
      default:
        return { error: `Неизвестная функция ${name}` };
    }
  }

  private async navigateTo(query: string): Promise<unknown> {
    if (query.trim().length === 0) return { error: 'Пустой адрес.' };
    let results: GeocodeResult[];
    try {
      results = await this.nav.search(query);
    } catch {
      return { error: 'Нет сети: не удалось найти адрес.' };
    }
    this.pending = [];
    if (results.length === 0) {
      return { found: 0, error: 'Ничего не найдено, попроси уточнить адрес.' };
    }
    if (results.length === 1) {
      const outcome = await this.nav.choose(results[0]!);
      return { found: 1, ...describeOutcome(outcome, results[0]!) };
    }
    this.pending = results.slice(0, MAX_CANDIDATES);
    return {
      found: this.pending.length,
      need_clarification: true,
      candidates: this.pending.map((c, i) => ({
        number: i + 1,
        name: shortPlaceName(c.displayName),
      })),
    };
  }

  private async chooseIndex(index: number): Promise<{ ok: boolean; message: string }> {
    const candidate = this.pending[index];
    if (!candidate) return { ok: false, message: 'Нет такого варианта.' };
    this.pending = [];
    const outcome = await this.nav.choose(candidate);
    const described = describeOutcome(outcome, candidate);
    return 'error' in described
      ? { ok: false, message: described.error }
      : { ok: true, message: described.result };
  }

  private trimHistory(): void {
    if (this.history.length <= MAX_HISTORY_MESSAGES) return;
    let start = this.history.length - MAX_HISTORY_MESSAGES;
    // Не начинаем историю с ответа функции без её вызова
    while (start < this.history.length && this.history[start]!.role !== 'user') start++;
    this.history = this.history.slice(start);
  }

  private dropDanglingTurn(): void {
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.role === 'user') {
        this.history = this.history.slice(0, i);
        return;
      }
    }
  }
}

function describeOutcome(
  outcome: RouteOutcome,
  place: GeocodeResult,
): { result: string } | { error: string } {
  if (!outcome.ok) return { error: outcome.error };
  return {
    result:
      `Маршрут до «${shortPlaceName(place.displayName)}»: ` +
      `${formatDistanceShortRu(outcome.distanceMeters)}, ${formatDurationRu(outcome.durationSeconds)}. ` +
      'Нажмите кнопку на очках, чтобы начать.',
  };
}
