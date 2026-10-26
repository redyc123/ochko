import { Agent, toDisplayText } from '../../src/agent/agent';
import type { LlmMessage, LlmProvider, LlmReply } from '../../src/agent/llm';
import type { NavPort } from '../../src/agent/tools';
import type { GeocodeResult } from '../../src/nav/geocode';

function place(name: string): GeocodeResult {
  return { displayName: name, lat: 55.75, lon: 37.62, type: 'shop', importance: 0.5 };
}

/** LLM-заглушка: отдаёт ответы по очереди и запоминает, что ей прислали. */
function scriptedLlm(replies: LlmReply[]): LlmProvider & { calls: LlmMessage[][] } {
  const calls: LlmMessage[][] = [];
  return {
    calls,
    chat: async (messages) => {
      calls.push([...messages]);
      const next = replies.shift();
      if (!next) throw new Error('нет ответа в сценарии');
      return next;
    },
  };
}

function fakeNav(results: GeocodeResult[]): NavPort & { chosen: GeocodeResult[] } {
  const chosen: GeocodeResult[] = [];
  return {
    chosen,
    search: async () => results,
    choose: async (c) => {
      chosen.push(c);
      return { ok: true, distanceMeters: 1234, durationSeconds: 900 };
    },
    stop: () => {},
    status: () => ({
      status: 'idle',
      destinationName: null,
      remainingDistanceMeters: null,
      remainingDurationSeconds: null,
    }),
  };
}

describe('Agent', () => {
  it('отвечает на обычный вопрос', async () => {
    const llm = scriptedLlm([{ kind: 'text', text: 'Столица Австралии — Канберра.' }]);
    const agent = new Agent({ llm, nav: fakeNav([]) });
    const reply = await agent.ask('Какая столица Австралии?');
    expect(reply.full).toBe('Столица Австралии — Канберра.');
    expect(reply.candidates).toEqual([]);
  });

  it('один адрес — сразу строит маршрут', async () => {
    const nav = fakeNav([place('Красная площадь, Москва')]);
    const llm = scriptedLlm([
      {
        kind: 'functionCall',
        call: { name: 'navigate_to', arguments: { query: 'Красная площадь' } },
      },
      { kind: 'text', text: 'Маршрут готов: 1,2 км.' },
    ]);
    const agent = new Agent({ llm, nav });
    const reply = await agent.ask('Отведи на Красную площадь');
    expect(nav.chosen).toHaveLength(1);
    expect(reply.full).toBe('Маршрут готов: 1,2 км.');
    const fnResult = llm.calls[1]!.at(-1)!;
    expect(fnResult).toMatchObject({ role: 'function', name: 'navigate_to' });
  });

  it('несколько адресов — переспрашивает, «второй» выбирается без LLM', async () => {
    const nav = fakeNav([
      place('Пятёрочка, 1, Тверская улица, Москва'),
      place('Пятёрочка, 5, Арбат, Москва'),
      place('Пятёрочка, 9, Ленинский проспект, Москва'),
    ]);
    const llm = scriptedLlm([
      { kind: 'functionCall', call: { name: 'navigate_to', arguments: { query: 'Пятёрочка' } } },
      { kind: 'text', text: 'Нашёл три: 1) Тверская, 2) Арбат, 3) Ленинский. Какой?' },
    ]);
    const agent = new Agent({ llm, nav });

    const question = await agent.ask('Построй маршрут до Пятёрочки');
    expect(nav.chosen).toHaveLength(0);
    expect(question.candidates).toHaveLength(3);
    const fnResult = JSON.parse((llm.calls[1]!.at(-1) as { content: string }).content);
    expect(fnResult.need_clarification).toBe(true);

    const answer = await agent.ask('второй');
    expect(llm.calls).toHaveLength(2); // в LLM не ходили
    expect(nav.chosen[0]!.displayName).toContain('Арбат');
    expect(answer.full).toContain('1,2 км');
    expect(answer.candidates).toEqual([]);
  });

  it('уточнение словами уходит в модель, она вызывает choose_destination', async () => {
    const nav = fakeNav([place('Аптека, Тверская'), place('Аптека, Арбат')]);
    const llm = scriptedLlm([
      { kind: 'functionCall', call: { name: 'navigate_to', arguments: { query: 'аптека' } } },
      { kind: 'text', text: 'Какая: 1) Тверская, 2) Арбат?' },
      { kind: 'functionCall', call: { name: 'choose_destination', arguments: { number: 1 } } },
      { kind: 'text', text: 'Ведём на Тверскую.' },
    ]);
    const agent = new Agent({ llm, nav });
    await agent.ask('до аптеки');
    const reply = await agent.ask('та что на Тверской улице пожалуйста');
    expect(nav.chosen[0]!.displayName).toContain('Тверская');
    expect(reply.full).toBe('Ведём на Тверскую.');
  });

  it('ошибка LLM не оставляет вопрос в истории', async () => {
    const llm = scriptedLlm([]);
    const agent = new Agent({ llm, nav: fakeNav([]) });
    await expect(agent.ask('привет')).rejects.toThrow();
    llm.chat = async (messages) => {
      expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
      return { kind: 'text', text: 'ок' };
    };
    await agent.ask('ещё раз');
  });
});

describe('toDisplayText', () => {
  it('обрезает по слову до 60 символов', () => {
    const long = 'Слово '.repeat(20);
    const out = toDisplayText(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
  });

  it('короткий текст не трогает', () => {
    expect(toDisplayText('Канберра')).toBe('Канберра');
  });
});
