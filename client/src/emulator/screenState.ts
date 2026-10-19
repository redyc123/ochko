import { ClearLayer, type DisplayMessage, NavState } from '../ble/protocol/display';

export interface NotifyLayer {
  app: number;
  prio: number;
  ttlS: number;
  title: string;
  body: string;
}

export interface NavLayer {
  maneuver: {
    icon: number;
    exitNo: number;
    distM: number | null;
    totalM: number;
    etaMin: number;
    street: string;
  } | null;
  progress: { distM: number; totalM: number; etaMin: number } | null;
  state: number;
}

export interface AgentLayer {
  state: number;
  text: string | null;
  confirm: { id: number; timeoutS: number; text: string } | null;
}

export interface EmulatorScreenState {
  notify: NotifyLayer | null;
  nav: NavLayer;
  agent: AgentLayer;
}

export function createInitialScreenState(): EmulatorScreenState {
  return {
    notify: null,
    nav: { maneuver: null, progress: null, state: NavState.OFF },
    agent: { state: 0, text: null, confirm: null },
  };
}

/**
 * Чистый редьюсер экрана эмулятора: применяет один пакет `display` к состоянию.
 * Эмулятор получает те же байты, что уходят в очки, декодирует их тем же
 * декодером, что и реальная прошивка будет использовать как контракт — так
 * состояние экрана никогда не берётся напрямую из стора приложения.
 */
export function applyDisplayMessage(
  state: EmulatorScreenState,
  message: DisplayMessage,
): EmulatorScreenState {
  switch (message.type) {
    case 'NOTIFY':
      return {
        ...state,
        notify: {
          app: message.app,
          prio: message.prio,
          ttlS: message.ttlS,
          title: message.title,
          body: message.body,
        },
      };
    case 'NAV_MANEUVER':
      return {
        ...state,
        nav: {
          ...state.nav,
          maneuver: {
            icon: message.icon,
            exitNo: message.exitNo,
            distM: message.distM,
            totalM: message.totalM,
            etaMin: message.etaMin,
            street: message.street,
          },
        },
      };
    case 'NAV_PROGRESS':
      return {
        ...state,
        nav: {
          ...state.nav,
          progress: { distM: message.distM, totalM: message.totalM, etaMin: message.etaMin },
        },
      };
    case 'NAV_STATE':
      return { ...state, nav: { ...state.nav, state: message.state } };
    case 'AGENT_STATE':
      return { ...state, agent: { ...state.agent, state: message.state } };
    case 'AGENT_TEXT':
      return { ...state, agent: { ...state.agent, text: message.text } };
    case 'CONFIRM':
      return {
        ...state,
        agent: {
          ...state.agent,
          confirm: { id: message.id, timeoutS: message.timeoutS, text: message.text },
        },
      };
    case 'CLEAR':
      return applyClear(state, message.layer);
  }
}

function applyClear(state: EmulatorScreenState, layer: number): EmulatorScreenState {
  const fresh = createInitialScreenState();
  switch (layer) {
    case ClearLayer.ALL:
      return fresh;
    case ClearLayer.NOTIFY:
      return { ...state, notify: null };
    case ClearLayer.NAV:
      return { ...state, nav: fresh.nav };
    case ClearLayer.AGENT:
      return { ...state, agent: fresh.agent };
    default:
      return state;
  }
}

export type ActiveContent =
  | { kind: 'confirm'; text: string }
  | { kind: 'agent_text'; text: string }
  | { kind: 'agent_state'; state: number }
  | { kind: 'nav_maneuver'; maneuver: NonNullable<NavLayer['maneuver']> }
  | { kind: 'notify'; notify: NotifyLayer }
  | { kind: 'nav_progress'; progress: NonNullable<NavLayer['progress']>; navState: number }
  | { kind: 'nav_state'; state: number }
  | { kind: 'idle' };

const NEAR_MANEUVER_THRESHOLD_M = 50;

/**
 * Выбирает, что сейчас показывать на экране, по приоритетам из docs/PROTOCOL.md §3:
 * CONFIRM > AGENT_* > NAV_* (манёвр < 50 м) > NOTIFY высокий > NAV_* > NOTIFY.
 */
export function selectActiveContent(state: EmulatorScreenState): ActiveContent {
  if (state.agent.confirm) {
    return { kind: 'confirm', text: state.agent.confirm.text };
  }
  if (state.agent.text) {
    return { kind: 'agent_text', text: state.agent.text };
  }
  if (state.agent.state !== 0) {
    return { kind: 'agent_state', state: state.agent.state };
  }

  const nearManeuver =
    state.nav.maneuver !== null &&
    state.nav.maneuver.distM !== null &&
    state.nav.maneuver.distM < NEAR_MANEUVER_THRESHOLD_M;
  if (nearManeuver && state.nav.maneuver) {
    return { kind: 'nav_maneuver', maneuver: state.nav.maneuver };
  }

  if (state.notify && state.notify.prio === 1) {
    return { kind: 'notify', notify: state.notify };
  }

  if (state.nav.maneuver) {
    return { kind: 'nav_maneuver', maneuver: state.nav.maneuver };
  }
  if (state.nav.progress) {
    return { kind: 'nav_progress', progress: state.nav.progress, navState: state.nav.state };
  }
  if (state.nav.state !== NavState.OFF) {
    return { kind: 'nav_state', state: state.nav.state };
  }

  if (state.notify) {
    return { kind: 'notify', notify: state.notify };
  }

  return { kind: 'idle' };
}
