import { NavState } from '../ble/protocol/display';
import { ManeuverIcon } from '../nav/maneuverMap';

/**
 * Упрощённые глифы-заменители для превью на телефоне. Это не настоящий
 * растровый шрифт/иконки прошивки (которых у нас нет и которые рисует сама
 * плата) — приближение для разработки и защиты, см. docs/LIMITATIONS.md.
 */
const ICON_GLYPHS: Readonly<Record<number, string>> = {
  [ManeuverIcon.NONE]: '•',
  [ManeuverIcon.STRAIGHT]: '↑',
  [ManeuverIcon.SLIGHT_RIGHT]: '↗',
  [ManeuverIcon.RIGHT]: '→',
  [ManeuverIcon.SHARP_RIGHT]: '↘',
  [ManeuverIcon.UTURN]: '⟲',
  [ManeuverIcon.SHARP_LEFT]: '↙',
  [ManeuverIcon.LEFT]: '←',
  [ManeuverIcon.SLIGHT_LEFT]: '↖',
  [ManeuverIcon.ROUNDABOUT]: '◎',
  [ManeuverIcon.ARRIVE]: '⚑',
  [ManeuverIcon.START]: '●',
  [ManeuverIcon.STAIRS_OR_CROSSING]: '≡',
  [ManeuverIcon.KEEP_RIGHT]: '▸',
  [ManeuverIcon.KEEP_LEFT]: '◂',
  [ManeuverIcon.FERRY_OR_TRANSIT]: '⛴',
};

export function iconGlyph(icon: number): string {
  return ICON_GLYPHS[icon] ?? '?';
}

const NAV_STATE_LABELS: Readonly<Record<number, string>> = {
  [NavState.OFF]: '',
  [NavState.BUILDING]: 'Строю маршрут',
  [NavState.GUIDING]: 'Веду',
  [NavState.REROUTING]: 'Перестраиваю…',
  [NavState.NO_GPS]: 'Нет GPS',
  [NavState.ARRIVED]: 'Вы на месте',
  [NavState.ROUTE_ERROR]: 'Ошибка маршрута',
};

export function navStateLabel(state: number): string {
  return NAV_STATE_LABELS[state] ?? '';
}

const AGENT_STATE_LABELS: Readonly<Record<number, string>> = {
  0: '',
  1: 'Слушаю…',
  2: 'Думаю…',
  3: 'Готово',
  4: 'Ошибка',
  5: 'Жду ответа',
};

export function agentStateLabel(state: number): string {
  return AGENT_STATE_LABELS[state] ?? '';
}
