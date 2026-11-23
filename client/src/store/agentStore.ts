import { create } from 'zustand';
import { buildAgentNavStatus } from '../agent/context';
import { listenOnce, SpeechError, type ListenHandle } from '../agent/speech';
import { AgentState, ClearLayer } from '../ble/protocol/display';
import { ButtonKind } from '../ble/protocol/events';
import type { GeocodeResult } from '../nav/geocode';
import {
  agentTurn,
  DEFAULT_PROXY_URL,
  ServerError,
  type ServerAgentAction,
  type ServerAgentActionResult,
  type ServerGeocodeResult,
} from '../server/api';
import { useDeviceStore } from './deviceStore';
import { useNavStore } from './navStore';

/** Сколько секунд ответ висит на очках — оценка, не измерено. */
const ANSWER_TTL_S = 15;

export type AgentStatus = 'idle' | 'listening' | 'thinking' | 'awaiting_choice' | 'error';

export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentStoreState {
  proxyUrl: string;
  status: AgentStatus;
  messages: ChatEntry[];
  /** Промежуточный текст распознавания, пока говорят. */
  partial: string;
  candidates: GeocodeResult[];
  errorMessage: string | null;

  setProxyUrl: (url: string) => void;
  ask: (text: string) => Promise<void>;
  /** Нажал — слушаем; нажал ещё раз во время записи — заканчиваем фразу. */
  toggleListening: () => Promise<void>;
  chooseCandidate: (index: number) => Promise<void>;
  resetDialog: () => void;
}

/** Выполнить структурированные действия сервера через navStore. */
function executeActions(actions: ServerAgentAction[]): ServerAgentActionResult[] {
  const nav = useNavStore.getState();
  const results: ServerAgentActionResult[] = [];
  for (const action of actions) {
    try {
      if (action.type === 'start_route') {
        nav.applyServerRoute(action.destination, action.route);
      } else if (action.type === 'stop_navigation') {
        nav.stopNavigation();
      }
      results.push({ type: action.type, status: 'applied' });
    } catch (err) {
      results.push({
        type: action.type,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Неизвестная ошибка клиента',
      });
    }
  }
  return results;
}

export const useAgentStore = create<AgentStoreState>((set, get) => {
  let nextId = 1;
  let listenHandle: ListenHandle | null = null;
  let sessionId: string | null = null;
  let actionResults: ServerAgentActionResult[] = [];

  function glassesApi() {
    return useDeviceStore.getState().glassesApi;
  }

  function push(role: ChatEntry['role'], text: string) {
    set({ messages: [...get().messages, { id: nextId++, role, text }] });
  }

  function fail(message: string) {
    set({ status: 'error', errorMessage: message, partial: '' });
    void glassesApi().showAgentState(AgentState.ERROR);
    void glassesApi().showText(ANSWER_TTL_S, message);
  }

  // Двойное нажатие на очках — спросить голосом; wake word — тоже.
  glassesApi().onButton((kind) => {
    if (kind === ButtonKind.DOUBLE) void get().toggleListening();
  });
  glassesApi().onWakeword(() => {
    if (!listenHandle) void get().toggleListening();
  });

  // Вариант выбрали на экране навигации — агенту больше не нужно переспрашивать.
  useNavStore.subscribe((state, prev) => {
    if (prev.status === 'choosing' && state.status !== 'choosing' && get().candidates.length) {
      set({ candidates: [], status: get().status === 'awaiting_choice' ? 'idle' : get().status });
    }
  });

  return {
    proxyUrl: DEFAULT_PROXY_URL,
    status: 'idle',
    messages: [],
    partial: '',
    candidates: [],
    errorMessage: null,

    setProxyUrl: (url) => {
      // Смена сервера — новый диалог (новая сессия на новом адресе).
      sessionId = null;
      actionResults = [];
      set({ proxyUrl: url });
    },

    ask: async (text) => {
      const question = text.trim();
      if (!question || get().status === 'thinking') return;
      push('user', question);
      set({ status: 'thinking', errorMessage: null, partial: '' });
      void glassesApi().showAgentState(AgentState.THINKING);
      try {
        const nav = useNavStore.getState();
        const sentActionResults = actionResults;
        const result = await agentTurn(get().proxyUrl, {
          session_id: sessionId,
          user_text: question,
          context: {
            position: nav.currentPosition,
            nav_status: buildAgentNavStatus(nav),
            action_results: sentActionResults,
          },
        });
        actionResults = actionResults.slice(sentActionResults.length);
        sessionId = result.session_id;
        const reply = result.reply;
        push('assistant', reply.full);
        const awaiting = reply.candidates.length > 0;
        set({
          status: awaiting ? 'awaiting_choice' : 'idle',
          candidates: reply.candidates,
        });
        // Клиент исполняет маршрут/остановку, которые решил сервер-агент.
        actionResults.push(...executeActions(reply.actions));
        void glassesApi().showAgentState(AgentState.READY);
        void glassesApi().showText(ANSWER_TTL_S, reply.display);
      } catch (err) {
        fail(err instanceof ServerError ? err.message : 'Ошибка агента.');
      }
    },

    toggleListening: async () => {
      if (listenHandle) {
        listenHandle.stop();
        return;
      }
      if (get().status === 'thinking') return;
      set({ status: 'listening', partial: '', errorMessage: null });
      void glassesApi().showAgentState(AgentState.LISTENING);
      try {
        listenHandle = await listenOnce((partial) => set({ partial }));
        const text = await listenHandle.result;
        listenHandle = null;
        if (!text) {
          set({ status: get().candidates.length ? 'awaiting_choice' : 'idle', partial: '' });
          void glassesApi().showAgentState(AgentState.NONE);
          void glassesApi().clear(ClearLayer.AGENT);
          return;
        }
        await get().ask(text);
      } catch (err) {
        listenHandle = null;
        fail(err instanceof SpeechError ? err.message : 'Микрофон недоступен.');
      }
    },

    chooseCandidate: async (index) => {
      // Сервер сам трактует «2» как выбор кандидата (несёт свой pending).
      await get().ask(String(index + 1));
    },

    resetDialog: () => {
      listenHandle?.abort();
      listenHandle = null;
      sessionId = null;
      actionResults = [];
      set({ messages: [], status: 'idle', candidates: [], partial: '', errorMessage: null });
      void glassesApi().clear(ClearLayer.AGENT);
    },
  };
});