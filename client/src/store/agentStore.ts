import { create } from 'zustand';
import { Agent } from '../agent/agent';
import { GigaChatProvider, LlmError } from '../agent/llm';
import { listenOnce, SpeechError, type ListenHandle } from '../agent/speech';
import type { NavPort } from '../agent/tools';
import { AgentState, ClearLayer } from '../ble/protocol/display';
import { ButtonKind } from '../ble/protocol/events';
import type { GeocodeResult } from '../nav/geocode';
import { useDeviceStore } from './deviceStore';
import { useNavStore } from './navStore';

const DEFAULT_PROXY_URL = process.env.EXPO_PUBLIC_AGENT_PROXY_URL ?? 'http://localhost:8787';
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

/** Мост агента к навигатору — тот же navStore, что и у экрана навигации. */
const navPort: NavPort = {
  async search(query) {
    const results = await useNavStore.getState().searchDestination(query);
    if (results === null) throw new Error('network');
    return results;
  },
  async choose(candidate) {
    await useNavStore.getState().chooseDestination(candidate);
    const { route, status, errorMessage } = useNavStore.getState();
    if (status === 'ready' && route) {
      return {
        ok: true,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
      };
    }
    return { ok: false, error: errorMessage ?? 'Не удалось построить маршрут.' };
  },
  stop() {
    useNavStore.getState().stopNavigation();
  },
  status() {
    const { status, query, route, destination } = useNavStore.getState();
    return {
      status,
      destinationName: destination ? query : null,
      remainingDistanceMeters: route?.distanceMeters ?? null,
      remainingDurationSeconds: route?.durationSeconds ?? null,
    };
  },
};

export const useAgentStore = create<AgentStoreState>((set, get) => {
  let nextId = 1;
  let listenHandle: ListenHandle | null = null;
  let agent = buildAgent(DEFAULT_PROXY_URL);

  function buildAgent(proxyUrl: string): Agent {
    return new Agent({
      llm: new GigaChatProvider({ proxyUrl }),
      nav: navPort,
      context: () => ({ now: new Date(), position: useNavStore.getState().currentPosition }),
    });
  }

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
    if (
      prev.status === 'choosing' &&
      state.status !== 'choosing' &&
      agent.pendingCandidates.length
    ) {
      agent.clearPending();
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
      agent = buildAgent(url);
      set({ proxyUrl: url });
    },

    ask: async (text) => {
      const question = text.trim();
      if (!question || get().status === 'thinking') return;
      push('user', question);
      set({ status: 'thinking', errorMessage: null, partial: '' });
      void glassesApi().showAgentState(AgentState.THINKING);
      try {
        const reply = await agent.ask(question);
        push('assistant', reply.full);
        const awaiting = reply.candidates.length > 0;
        set({ status: awaiting ? 'awaiting_choice' : 'idle', candidates: reply.candidates });
        void glassesApi().showAgentState(AgentState.READY);
        void glassesApi().showText(ANSWER_TTL_S, reply.display);
      } catch (err) {
        fail(err instanceof LlmError ? err.message : 'Ошибка агента.');
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
          set({ status: agent.pendingCandidates.length ? 'awaiting_choice' : 'idle', partial: '' });
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
      // Тот же путь, что и голосом: «2» разбирается локально, без LLM
      await get().ask(String(index + 1));
    },

    resetDialog: () => {
      listenHandle?.abort();
      listenHandle = null;
      agent.reset();
      set({ messages: [], status: 'idle', candidates: [], partial: '', errorMessage: null });
      void glassesApi().clear(ClearLayer.AGENT);
    },
  };
});
