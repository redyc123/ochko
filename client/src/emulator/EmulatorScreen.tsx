import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { selectActiveContent, type EmulatorScreenState } from './screenState';
import { agentStateLabel, iconGlyph, navStateLabel } from './render';
import { paginate, wrapToLines } from './textLayout';
import type { EmulatorDevice } from './EmulatorDevice';
import { ButtonKind } from '../ble/protocol/events';
import { roundDistanceMeters } from '../nav/tracking';

const COLS = 12;
const ROWS = 5;
/** Масштаб превью: реальный экран очков — 72×40 монохромных пикселей. */
const SCALE = 4;

function contentToPages(content: ReturnType<typeof selectActiveContent>): string[][] {
  switch (content.kind) {
    case 'confirm':
      return paginate(wrapToLines(content.text, COLS), ROWS);
    case 'agent_text':
      return paginate(wrapToLines(content.text, COLS), ROWS);
    case 'agent_state':
      return [[agentStateLabel(content.state)]];
    case 'nav_maneuver': {
      const dist =
        content.maneuver.distM === null ? '' : `${roundDistanceMeters(content.maneuver.distM)}м`;
      const header = `${iconGlyph(content.maneuver.icon)} ${dist}`.trim();
      const streetLines = wrapToLines(content.maneuver.street, COLS);
      return paginate([header, ...streetLines], ROWS);
    }
    case 'nav_progress': {
      const dist = `${roundDistanceMeters(content.progress.distM)}м`;
      const eta = `${content.progress.etaMin} мин`;
      return [[dist, eta]];
    }
    case 'nav_state':
      return [[navStateLabel(content.state)]];
    case 'notify':
      return paginate([content.notify.title, ...wrapToLines(content.notify.body, COLS)], ROWS);
    case 'idle':
      return [[]];
  }
}

export interface EmulatorScreenProps {
  device: EmulatorDevice;
}

/**
 * Превью экрана очков 72×40 (увеличено в SCALE раз) + кнопка D1. Рисует
 * ровно то, что декодировал EmulatorDevice из тех же байтов display/control —
 * не берёт ничего из стора приложения напрямую (ТЗ §2).
 */
export function EmulatorScreen({ device }: EmulatorScreenProps): React.JSX.Element {
  const [screen, setScreen] = useState<EmulatorScreenState>(device.getScreenState());
  const [page, setPage] = useState(0);
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = React.useRef(false);

  useEffect(() => device.onScreenChange(setScreen), [device]);

  const content = useMemo(() => selectActiveContent(screen), [screen]);
  const pages = useMemo(() => contentToPages(content), [content]);
  const currentPage = pages[page % pages.length] ?? [];

  // Сбрасываем страницу при смене типа контента прямо во время рендера
  // (а не в эффекте) — так React делает это без лишнего промежуточного кадра.
  const [prevKind, setPrevKind] = useState(content.kind);
  if (prevKind !== content.kind) {
    setPrevKind(content.kind);
    setPage(0);
  }

  const handlePressIn = () => {
    holdFired.current = false;
    holdTimer.current = setTimeout(() => {
      holdFired.current = true;
      device.pressButton(ButtonKind.HOLD_START);
    }, 500);
  };

  const handlePressOut = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdFired.current) {
      device.pressButton(ButtonKind.RELEASE);
    } else {
      device.pressButton(ButtonKind.SHORT);
      setPage((p) => p + 1);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.screen}>
        {Array.from({ length: ROWS }).map((_, row) => (
          <Text key={row} style={styles.row} numberOfLines={1}>
            {(currentPage[row] ?? '').padEnd(COLS, ' ')}
          </Text>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Кнопка D1"
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>D1</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: 12 },
  screen: {
    width: 72 * SCALE,
    height: 40 * SCALE,
    backgroundColor: '#000',
    padding: 2 * SCALE,
    justifyContent: 'space-between',
  },
  row: {
    color: '#5fe88a',
    fontFamily: 'monospace',
    fontSize: 7 * SCALE,
    lineHeight: 7.5 * SCALE,
  },
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    color: '#fff',
  },
});
