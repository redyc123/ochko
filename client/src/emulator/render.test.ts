import { NavState } from '../ble/protocol/display';
import { ManeuverIcon } from '../nav/maneuverMap';
import { agentStateLabel, iconGlyph, navStateLabel } from './render';

describe('iconGlyph', () => {
  it('возвращает глиф для каждого известного кода манёвра', () => {
    expect(iconGlyph(ManeuverIcon.STRAIGHT)).toBe('↑');
    expect(iconGlyph(ManeuverIcon.LEFT)).toBe('←');
    expect(iconGlyph(ManeuverIcon.RIGHT)).toBe('→');
  });

  it('неизвестный код даёт "?", а не кидает ошибку', () => {
    expect(iconGlyph(999)).toBe('?');
  });
});

describe('navStateLabel', () => {
  it('даёт короткие русские подписи для каждого состояния навигации', () => {
    expect(navStateLabel(NavState.REROUTING)).toBe('Перестраиваю…');
    expect(navStateLabel(NavState.NO_GPS)).toBe('Нет GPS');
    expect(navStateLabel(NavState.ARRIVED)).toBe('Вы на месте');
  });

  it('OFF и неизвестное состояние — пустая строка', () => {
    expect(navStateLabel(NavState.OFF)).toBe('');
    expect(navStateLabel(999)).toBe('');
  });
});

describe('agentStateLabel', () => {
  it('даёт подписи для состояний агента', () => {
    expect(agentStateLabel(1)).toBe('Слушаю…');
    expect(agentStateLabel(2)).toBe('Думаю…');
  });

  it('неизвестное состояние — пустая строка', () => {
    expect(agentStateLabel(999)).toBe('');
  });
});
