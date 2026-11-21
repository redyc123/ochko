import { roundDistanceMeters } from '../nav/tracking';
import { agentStateLabel, iconGlyph, navStateLabel } from './render';
import { selectActiveContent } from './screenState';
import { paginate, wrapToLines } from './textLayout';

export const DISPLAY_COLS = 12;
export const DISPLAY_ROWS = 5;

/**
 * Превращает активный контент экрана очков в страницы по 12×5 символов.
 * Логика вынесена из EmulatorScreen, чтобы её могли использовать и превью,
 * и компактные карточки в новом интерфейсе.
 */
export function contentToPages(content: ReturnType<typeof selectActiveContent>): string[][] {
  switch (content.kind) {
    case 'confirm':
      return paginate(wrapToLines(content.text, DISPLAY_COLS), DISPLAY_ROWS);
    case 'agent_text':
      return paginate(wrapToLines(content.text, DISPLAY_COLS), DISPLAY_ROWS);
    case 'agent_state':
      return [[agentStateLabel(content.state)]];
    case 'nav_maneuver': {
      const dist =
        content.maneuver.distM === null ? '' : `${roundDistanceMeters(content.maneuver.distM)}м`;
      const header = `${iconGlyph(content.maneuver.icon)} ${dist}`.trim();
      const streetLines = wrapToLines(content.maneuver.street, DISPLAY_COLS);
      return paginate([header, ...streetLines], DISPLAY_ROWS);
    }
    case 'nav_progress': {
      const dist = `${roundDistanceMeters(content.progress.distM)}м`;
      const eta = `${content.progress.etaMin} мин`;
      return [[dist, eta]];
    }
    case 'nav_state':
      return [[navStateLabel(content.state)]];
    case 'notify':
      return paginate(
        [content.notify.title, ...wrapToLines(content.notify.body, DISPLAY_COLS)],
        DISPLAY_ROWS,
      );
    case 'idle':
      return [[]];
  }
}
