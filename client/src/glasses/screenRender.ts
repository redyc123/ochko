import { NavState } from '../ble/protocol/display';
import { agentStateLabel, navStateLabel } from '../emulator/render';
import type { ActiveContent, NavLayer } from '../emulator/screenState';
import { wrapToLines } from '../emulator/textLayout';
import { ManeuverIcon } from '../nav/maneuverMap';
import { Bitmap } from './bitmap';

const LINE_HEIGHT = 8;
const MAX_COLS = 12;
const WEEKDAYS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];

/** Угол стрелки (0 = прямо, по часовой) для иконок, которые рисуются одной стрелкой. */
const ARROW_ANGLES: Readonly<Record<number, number>> = {
  [ManeuverIcon.STRAIGHT]: 0,
  [ManeuverIcon.SLIGHT_RIGHT]: 45,
  [ManeuverIcon.KEEP_RIGHT]: 30,
  [ManeuverIcon.RIGHT]: 90,
  [ManeuverIcon.SHARP_RIGHT]: 135,
  [ManeuverIcon.SLIGHT_LEFT]: -45,
  [ManeuverIcon.KEEP_LEFT]: -30,
  [ManeuverIcon.LEFT]: -90,
  [ManeuverIcon.SHARP_LEFT]: -135,
};

/** «120» + «М», «1.2» + «КМ»; null — расстояние неизвестно. */
export function formatDistance(distM: number | null): { value: string; unit: string } {
  if (distM === null) return { value: '--', unit: '' };
  if (distM < 1000) return { value: String(Math.round(distM)), unit: 'М' };
  if (distM < 10_000) return { value: (distM / 1000).toFixed(1), unit: 'КМ' };
  return { value: String(Math.round(distM / 1000)), unit: 'КМ' };
}

function drawArrowHead(b: Bitmap, tipX: number, tipY: number, angleRad: number): void {
  for (const side of [-1, 1]) {
    const a = angleRad + Math.PI + side * 0.7;
    b.line(tipX, tipY, Math.round(tipX + 7 * Math.sin(a)), Math.round(tipY - 7 * Math.cos(a)));
  }
}

/** Иконка манёвра в квадрате 24×24 с левым верхним углом (ox, oy). */
export function drawManeuverIcon(b: Bitmap, icon: number, exitNo: number, ox = 0, oy = 0): void {
  const angle = ARROW_ANGLES[icon];
  if (angle !== undefined) {
    const rad = (angle * Math.PI) / 180;
    if (angle === 0) {
      b.line(ox + 11, oy + 22, ox + 11, oy + 2);
      drawArrowHead(b, ox + 11, oy + 2, 0);
      return;
    }
    // Ствол снизу до центра, затем поворот в сторону манёвра
    b.line(ox + 11, oy + 22, ox + 11, oy + 12);
    const tipX = Math.round(ox + 11 + 9 * Math.sin(rad));
    const tipY = Math.round(oy + 12 - 9 * Math.cos(rad));
    b.line(ox + 11, oy + 12, tipX, tipY);
    drawArrowHead(b, tipX, tipY, rad);
    return;
  }
  switch (icon) {
    case ManeuverIcon.UTURN:
      b.line(ox + 15, oy + 22, ox + 15, oy + 7);
      b.line(ox + 15, oy + 7, ox + 12, oy + 4);
      b.line(ox + 12, oy + 4, ox + 9, oy + 4);
      b.line(ox + 9, oy + 4, ox + 6, oy + 7);
      b.line(ox + 6, oy + 7, ox + 6, oy + 17);
      drawArrowHead(b, ox + 6, oy + 18, Math.PI);
      return;
    case ManeuverIcon.ROUNDABOUT:
      b.circle(ox + 11, oy + 9, 8);
      b.line(ox + 11, oy + 23, ox + 11, oy + 18);
      if (exitNo > 0) b.text(String(exitNo % 10), ox + 9, oy + 6);
      return;
    case ManeuverIcon.ARRIVE:
      b.line(ox + 5, oy + 2, ox + 5, oy + 22);
      b.fillRect(ox + 7, oy + 2, 12, 9);
      return;
    case ManeuverIcon.START:
      b.circle(ox + 11, oy + 11, 6, true);
      return;
    default:
      b.circle(ox + 11, oy + 11, 3, true);
  }
}

function drawLines(b: Bitmap, lines: readonly string[]): void {
  const shown = lines.slice(0, 5);
  let y = Math.floor((40 - shown.length * LINE_HEIGHT) / 2) + 1;
  for (const line of shown) {
    b.centeredText(line, y);
    y += LINE_HEIGHT;
  }
}

function drawClock(b: Bitmap, now: Date): void {
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  b.centeredText(`${hh}:${mm}`, 4, 2);
  const dd = String(now.getDate()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  b.centeredText(`${WEEKDAYS[now.getDay()]} ${dd}.${mo}`, 26);
}

function drawManeuver(
  b: Bitmap,
  maneuver: NonNullable<NavLayer['maneuver']>,
  distM: number | null,
): void {
  drawManeuverIcon(b, maneuver.icon, maneuver.exitNo);
  const { value, unit } = formatDistance(distM);
  b.text(value, 26, 1, 2);
  b.text(unit, 26, 17);
  const street = wrapToLines(maneuver.street, MAX_COLS);
  street.slice(0, 2).forEach((line, i) => b.text(line, 0, 25 + i * LINE_HEIGHT));
}

function drawProgress(b: Bitmap, distM: number, totalM: number): void {
  const { value, unit } = formatDistance(distM);
  b.centeredText(value, 2, 2);
  b.centeredText(unit, 18);
  const total = formatDistance(totalM);
  b.centeredText(`ВСЕГО ${total.value}${total.unit}`, 30);
}

/**
 * Рисует то, что сейчас должно быть на экране очков. Когда показывать нечего
 * (нет маршрута, уведомлений и агента), на экране часы.
 */
export function renderScreen(content: ActiveContent, nav: NavLayer, now: Date): Bitmap {
  const b = new Bitmap();
  switch (content.kind) {
    case 'confirm':
    case 'agent_text':
      drawLines(b, wrapToLines(content.text, MAX_COLS));
      break;
    case 'agent_state':
      drawLines(b, wrapToLines(agentStateLabel(content.state), MAX_COLS));
      break;
    case 'nav_maneuver':
      // NAV_PROGRESS приходит чаще манёвра и несёт свежее расстояние до него
      drawManeuver(b, content.maneuver, nav.progress?.distM ?? content.maneuver.distM);
      break;
    case 'notify':
      drawLines(b, [
        ...wrapToLines(content.notify.title, MAX_COLS).slice(0, 1),
        ...wrapToLines(content.notify.body, MAX_COLS).slice(0, 4),
      ]);
      break;
    case 'nav_progress':
      drawProgress(b, content.progress.distM, content.progress.totalM);
      break;
    case 'nav_state':
      if (content.state === NavState.OFF) drawClock(b, now);
      else drawLines(b, wrapToLines(navStateLabel(content.state), MAX_COLS));
      break;
    case 'idle':
      drawClock(b, now);
      break;
  }
  return b;
}
