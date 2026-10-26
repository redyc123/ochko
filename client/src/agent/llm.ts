/** Описание инструмента в JSON Schema — один раз для всех провайдеров. */
export interface LlmFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmFunctionCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      functionCall?: LlmFunctionCall;
      functionsStateId?: string;
    }
  | { role: 'function'; name: string; content: string };

export type LlmReply =
  | { kind: 'text'; text: string }
  | { kind: 'functionCall'; call: LlmFunctionCall; functionsStateId?: string };

export interface LlmProvider {
  chat(messages: LlmMessage[], functions: LlmFunction[]): Promise<LlmReply>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface GigaChatProviderOptions {
  /** Адрес сервера ../server (main.py) — сам токен живёт только там. */
  proxyUrl: string;
  model?: string;
  temperature?: number;
  fetchFn?: FetchFn;
}

/** Сообщения в формате GigaChat: аргументы функции — объект, результат — role "function". */
export function toGigaChatMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.functionCall) {
      return {
        role: 'assistant',
        content: m.content,
        function_call: { name: m.functionCall.name, arguments: m.functionCall.arguments },
        ...(m.functionsStateId ? { functions_state_id: m.functionsStateId } : {}),
      };
    }
    if (m.role === 'function') {
      return { role: 'function', name: m.name, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

export function parseGigaChatReply(data: unknown): LlmReply {
  const choices = (data as { choices?: unknown[] } | null)?.choices;
  const message = (choices?.[0] as { message?: Record<string, unknown> } | undefined)?.message;
  if (!message) {
    throw new LlmError('GigaChat вернул пустой ответ.');
  }
  const fc = message.function_call as { name?: unknown; arguments?: unknown } | undefined;
  if (fc && typeof fc.name === 'string') {
    let args: Record<string, unknown> = {};
    if (typeof fc.arguments === 'string') {
      try {
        args = JSON.parse(fc.arguments) as Record<string, unknown>;
      } catch {
        args = {};
      }
    } else if (fc.arguments && typeof fc.arguments === 'object') {
      args = fc.arguments as Record<string, unknown>;
    }
    const stateId = message.functions_state_id;
    return {
      kind: 'functionCall',
      call: { name: fc.name, arguments: args },
      functionsStateId: typeof stateId === 'string' ? stateId : undefined,
    };
  }
  return { kind: 'text', text: String(message.content ?? '').trim() };
}

export class GigaChatProvider implements LlmProvider {
  private readonly proxyUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly fetchFn: FetchFn | undefined;

  constructor(options: GigaChatProviderOptions) {
    this.proxyUrl = options.proxyUrl.replace(/\/+$/, '');
    this.model = options.model ?? 'GigaChat';
    this.temperature = options.temperature ?? 0.3;
    this.fetchFn = options.fetchFn;
  }

  async chat(messages: LlmMessage[], functions: LlmFunction[]): Promise<LlmReply> {
    const fetchFn = this.fetchFn ?? (globalThis.fetch as FetchFn);
    const body: Record<string, unknown> = {
      model: this.model,
      temperature: this.temperature,
      messages: toGigaChatMessages(messages),
    };
    if (functions.length > 0) {
      body.functions = functions;
      body.function_call = 'auto';
    }
    let response;
    try {
      response = await fetchFn(`${this.proxyUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new LlmError('Нет связи с сервером агента.');
    }
    if (!response.ok) {
      throw new LlmError(`GigaChat ответил ${response.status}`);
    }
    return parseGigaChatReply(await response.json());
  }
}
