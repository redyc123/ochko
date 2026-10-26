import { GigaChatProvider, parseGigaChatReply, toGigaChatMessages } from '../../src/agent/llm';

describe('parseGigaChatReply', () => {
  it('текстовый ответ', () => {
    expect(
      parseGigaChatReply({ choices: [{ message: { role: 'assistant', content: ' Канберра ' } }] }),
    ).toEqual({ kind: 'text', text: 'Канберра' });
  });

  it('function_call с объектом аргументов', () => {
    expect(
      parseGigaChatReply({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              function_call: { name: 'navigate_to', arguments: { query: 'Красная площадь' } },
              functions_state_id: 'abc',
            },
          },
        ],
      }),
    ).toEqual({
      kind: 'functionCall',
      call: { name: 'navigate_to', arguments: { query: 'Красная площадь' } },
      functionsStateId: 'abc',
    });
  });

  it('function_call с аргументами-строкой', () => {
    const reply = parseGigaChatReply({
      choices: [{ message: { function_call: { name: 'x', arguments: '{"number":2}' } } }],
    });
    expect(reply).toMatchObject({ kind: 'functionCall', call: { arguments: { number: 2 } } });
  });

  it('пустой ответ — ошибка', () => {
    expect(() => parseGigaChatReply({ choices: [] })).toThrow();
  });
});

describe('toGigaChatMessages', () => {
  it('переводит вызов и результат функции в формат GigaChat', () => {
    expect(
      toGigaChatMessages([
        { role: 'assistant', content: '', functionCall: { name: 'f', arguments: { a: 1 } } },
        { role: 'function', name: 'f', content: '{"ok":true}' },
      ]),
    ).toEqual([
      { role: 'assistant', content: '', function_call: { name: 'f', arguments: { a: 1 } } },
      { role: 'function', name: 'f', content: '{"ok":true}' },
    ]);
  });
});

describe('GigaChatProvider', () => {
  it('шлёт functions и function_call=auto на прокси', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    const provider = new GigaChatProvider({ proxyUrl: 'http://proxy:8787/', fetchFn });
    await provider.chat(
      [{ role: 'user', content: 'hi' }],
      [{ name: 'f', description: 'd', parameters: { type: 'object', properties: {} } }],
    );
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://proxy:8787/chat');
    const body = JSON.parse(init.body);
    expect(body.function_call).toBe('auto');
    expect(body.functions).toHaveLength(1);
  });
});
