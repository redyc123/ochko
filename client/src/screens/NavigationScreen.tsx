import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSpeechAvailable } from '@/agent/speech';
import { shortPlaceName } from '@/agent/tools';
import { formatDistanceRu, formatDurationRu, trackPosition } from '@/nav/tracking';
import { useAgentStore } from '@/store/agentStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useNavStore } from '@/store/navStore';
import { Button } from '@/ui/Button';
import { CandidateList } from '@/ui/CandidateList';
import { Chip } from '@/ui/Chip';
import { GlassesCard } from '@/ui/GlassesPreview';
import { Icon, maneuverIconName } from '@/ui/Icon';
import { ManeuverCard } from '@/ui/ManeuverCard';
import { SearchPill } from '@/ui/SearchPill';
import { StatusBanner } from '@/ui/StatusBanner';
import { ToggleRow } from '@/ui/ToggleRow';
import { colors, profileLabels, radii, shadows, spacing } from '@/ui/theme';

import { RouteMap } from './RouteMap';
import { useRootTab } from './tabContext';

const SIMULATION_SPEED_OPTIONS = [1, 2, 5, 10] as const;
const GPS_POLL_INTERVAL_MS = 5000;

const STATUS_LABELS: Record<string, string> = {
  idle: 'Готово к вводу цели',
  searching: 'Ищу адрес…',
  choosing: 'Выберите вариант',
  routing: 'Строю маршрут…',
  ready: 'Маршрут готов',
  navigating: 'Веду по маршруту',
  rerouting: 'Перестраиваю…',
  arrived: 'Вы на месте',
  error: 'Ошибка',
};

export function NavigationScreen(): React.JSX.Element {
  const { setActiveTab } = useRootTab();
  const insets = useSafeAreaInsets();

  const emulator = useDeviceStore((s) => s.emulator);
  const status = useNavStore((s) => s.status);
  const candidates = useNavStore((s) => s.candidates);
  const route = useNavStore((s) => s.route);
  const currentPosition = useNavStore((s) => s.currentPosition);
  const destination = useNavStore((s) => s.destination);
  const errorMessage = useNavStore((s) => s.errorMessage);
  const simulationEnabled = useNavStore((s) => s.simulationEnabled);
  const gpsOk = useNavStore((s) => s.gpsOk);

  const navigateTo = useNavStore((s) => s.navigateTo);
  const chooseDestination = useNavStore((s) => s.chooseDestination);
  const startNavigation = useNavStore((s) => s.startNavigation);
  const stopNavigation = useNavStore((s) => s.stopNavigation);
  const updatePosition = useNavStore((s) => s.updatePosition);
  const checkGpsTimeout = useNavStore((s) => s.checkGpsTimeout);
  const enableSimulation = useNavStore((s) => s.enableSimulation);
  const tickSimulation = useNavStore((s) => s.tickSimulation);

  const agentStatus = useAgentStore((s) => s.status);
  const toggleListening = useAgentStore((s) => s.toggleListening);

  const [query, setQuery] = useState('');
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(5);
  const [showManeuvers, setShowManeuvers] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(280);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Реальный GPS — только когда не включена симуляция (она подменяет источник позиции).
  useEffect(() => {
    if (simulationEnabled) {
      locationSubscription.current?.remove();
      locationSubscription.current = null;
      return;
    }
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let polling = false;
    (async () => {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted' || cancelled) return;
      locationSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        (loc) =>
          updatePosition({ lat: loc.coords.latitude, lon: loc.coords.longitude }, Date.now()),
      );
      pollTimer = setInterval(() => {
        if (polling) return;
        polling = true;
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
          .then((loc) => {
            if (!cancelled) {
              updatePosition({ lat: loc.coords.latitude, lon: loc.coords.longitude }, Date.now());
            }
          })
          .catch(() => {
            // временно нет фикса — подождём следующего тика опроса
          })
          .finally(() => {
            polling = false;
          });
      }, GPS_POLL_INTERVAL_MS);
    })();
    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      locationSubscription.current?.remove();
      locationSubscription.current = null;
    };
  }, [simulationEnabled, updatePosition]);

  // Тик симуляции / проверка таймаута GPS.
  useEffect(() => {
    const interval = setInterval(() => {
      if (simulationEnabled) {
        tickSimulation(Date.now());
      } else {
        checkGpsTimeout(Date.now());
      }
    }, 500);
    return () => clearInterval(interval);
  }, [simulationEnabled, tickSimulation, checkGpsTimeout]);

  const handleToggleSimulation = (enable: boolean) => {
    enableSimulation(enable, speedMultiplier);
    if (enable) {
      useNavStore.getState().simulator?.start(Date.now());
    }
  };

  const handleMic = () => {
    setActiveTab('assistant');
    if (isSpeechAvailable() && agentStatus !== 'listening' && agentStatus !== 'thinking') {
      void toggleListening();
    }
  };

  const handleSubmit = () => {
    const trimmed = query.trim();
    if (trimmed.length > 0) {
      void navigateTo(trimmed);
    }
  };

  const handleSelect = (candidate: (typeof candidates)[number]) => {
    void chooseDestination(candidate);
    setQuery(shortPlaceName(candidate.displayName));
  };

  const tracking = route && currentPosition ? trackPosition(route, currentPosition) : null;
  const upcoming = route
    ? (route.maneuvers[tracking?.upcomingManeuverIndex ?? 0] ?? route.maneuvers[0])
    : undefined;
  const distanceToManeuver = tracking
    ? tracking.distanceToUpcomingManeuverMeters
    : (upcoming?.distanceMeters ?? route?.distanceMeters ?? 0);
  const statusLabel = STATUS_LABELS[status] ?? status;

  return (
    <View style={styles.container}>
      <RouteMap
        shape={route?.shape ?? []}
        currentPosition={currentPosition}
        destination={destination}
        style={styles.mapFill}
        interactive={false}
      />

      <View
        style={[styles.topOverlay, { paddingTop: insets.top + spacing.sm }]}
        pointerEvents="box-none"
      >
        <SearchPill
          value={query}
          onChangeText={setQuery}
          onSubmit={handleSubmit}
          onMic={handleMic}
        />
        <View style={styles.chips}>
          <Chip label={gpsOk ? 'GPS' : 'Нет GPS'} dot tone={gpsOk ? 'accent' : 'neutral'} />
          <Chip label="Очки" icon="glasses" onPress={() => setActiveTab('glasses')} />
          {simulationEnabled ? <Chip label="Симуляция" icon="play" tone="accent" /> : null}
        </View>
        {errorMessage ? <StatusBanner message={errorMessage} tone="error" /> : null}
        {!gpsOk && status === 'navigating' ? (
          <StatusBanner message="Нет GPS — проверьте разрешение" tone="error" />
        ) : null}
      </View>

      <View
        style={[styles.floatingGlasses, { bottom: sheetHeight + spacing.md }]}
        pointerEvents="box-none"
      >
        <GlassesCard device={emulator} onPress={() => setActiveTab('glasses')} scale={1.25} />
      </View>

      <View
        style={styles.sheet}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.handle} />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {status === 'choosing' ? (
            <>
              <View style={styles.sheetHeader}>
                <Text style={styles.eyebrow}>ВЫБЕРИТЕ АДРЕС</Text>
                <Text style={styles.sheetMeta}>{candidates.length} варианта</Text>
              </View>
              <CandidateList candidates={candidates} onSelect={handleSelect} />
              <Button
                label="Отмена"
                variant="ghost"
                onPress={stopNavigation}
                style={styles.cancel}
              />
            </>
          ) : route ? (
            <>
              <View style={styles.sheetHeader}>
                <Text style={styles.eyebrow}>МАРШРУТ</Text>
                <Chip
                  label={statusLabel}
                  tone={status === 'navigating' || status === 'rerouting' ? 'accent' : 'neutral'}
                />
              </View>

              {upcoming ? (
                <ManeuverCard
                  iconType={upcoming.type}
                  distance={formatDistanceRu(distanceToManeuver)}
                  street={upcoming.streetNames[0] ?? ''}
                />
              ) : (
                <Text style={styles.emptyTitle}>Маршрут готов</Text>
              )}

              <View style={styles.stats}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatDurationRu(route.durationSeconds)}</Text>
                  <Text style={styles.statLabel}>{profileLabels[route.profile]}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatDistanceRu(route.distanceMeters)}</Text>
                  <Text style={styles.statLabel}>всего</Text>
                </View>
                {tracking ? (
                  <>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Text style={styles.statValue}>
                        {formatDistanceRu(tracking.remainingDistanceMeters)}
                      </Text>
                      <Text style={styles.statLabel}>осталось</Text>
                    </View>
                  </>
                ) : null}
              </View>

              {status === 'ready' || status === 'arrived' ? (
                <Button
                  label="Начать"
                  icon="play"
                  onPress={() => startNavigation(Date.now())}
                  fullWidth
                  style={styles.primary}
                />
              ) : null}
              {status === 'navigating' || status === 'rerouting' ? (
                <Button
                  label="Завершить"
                  icon="stop"
                  variant="danger"
                  onPress={stopNavigation}
                  fullWidth
                  style={styles.primary}
                />
              ) : null}

              <View style={styles.travelRow}>
                <ToggleRow
                  label="Симуляция поездки"
                  description="Двигаться по маршруту без GPS"
                  value={simulationEnabled}
                  onValueChange={handleToggleSimulation}
                />
                <View style={styles.speedRow}>
                  {SIMULATION_SPEED_OPTIONS.map((mult) => (
                    <Chip
                      key={mult}
                      label={`×${mult}`}
                      selected={speedMultiplier === mult}
                      onPress={() => {
                        setSpeedMultiplier(mult);
                        useNavStore.getState().simulator?.setSpeedMultiplier(mult);
                      }}
                    />
                  ))}
                </View>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Показать все манёвры"
                onPress={() => setShowManeuvers((value) => !value)}
                style={styles.expandRow}
              >
                <Text style={styles.expandLabel}>Все манёвры</Text>
                <View style={{ transform: [{ rotate: showManeuvers ? '90deg' : '0deg' }] }}>
                  <Icon name="chevronRight" size={17} color={colors.soft} strokeWidth={2} />
                </View>
              </Pressable>
              {showManeuvers ? (
                <View style={styles.maneuverList}>
                  {route.maneuvers.map((maneuver, index) => (
                    <View key={`${index}-${maneuver.beginShapeIndex}`} style={styles.maneuverRow}>
                      <View style={styles.maneuverIcon}>
                        <Icon
                          name={maneuverIconName(maneuver.type)}
                          size={17}
                          color={colors.accent}
                          strokeWidth={2}
                        />
                      </View>
                      <View style={styles.maneuverText}>
                        <Text style={styles.maneuverStreet} numberOfLines={1}>
                          {maneuver.streetNames[0] ?? '—'}
                        </Text>
                        <Text style={styles.maneuverDistance}>
                          {formatDistanceRu(maneuver.distanceMeters)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={styles.attribution}>© участники OpenStreetMap</Text>
            </>
          ) : (
            <>
              <View style={styles.sheetHeader}>
                <Text style={styles.eyebrow}>КУДА ИДЁМ?</Text>
                <Chip label={statusLabel} tone="neutral" />
              </View>
              <Text style={styles.emptyTitle}>Введите адрес или спросите голосом</Text>
              <Text style={styles.emptyText}>Построим маршрут и покажем повороты на очках.</Text>
              <View style={styles.quickRow}>
                <Chip label="Кафе рядом" onPress={() => void navigateTo('кафе')} />
                <Chip label="Парк" onPress={() => void navigateTo('парк')} />
                <Chip label="Аптека" onPress={() => void navigateTo('аптека')} />
              </View>
              <Button
                label="Спросить ассистента"
                icon="mic"
                variant="outline"
                onPress={handleMic}
                fullWidth
                style={styles.primary}
              />
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  mapFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    zIndex: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  floatingGlasses: {
    position: 'absolute',
    right: spacing.lg,
    zIndex: 2,
    alignItems: 'flex-end',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '68%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    zIndex: 3,
    ...shadows.sheet,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sand,
    marginBottom: spacing.md,
  },
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sheetContent: {
    paddingBottom: spacing.xs,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.soft,
  },
  sheetMeta: {
    fontSize: 12,
    color: colors.muted,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.ink,
  },
  statLabel: {
    marginTop: 2,
    fontSize: 11,
    color: colors.muted,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: colors.line,
    marginHorizontal: spacing.md,
  },
  primary: {
    marginTop: spacing.lg,
  },
  travelRow: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  speedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  expandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  expandLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  maneuverList: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  maneuverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 6,
  },
  maneuverIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  maneuverText: {
    flex: 1,
  },
  maneuverStreet: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  maneuverDistance: {
    marginTop: 1,
    fontSize: 11,
    color: colors.muted,
  },
  emptyTitle: {
    fontSize: 21,
    lineHeight: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.ink,
  },
  emptyText: {
    marginTop: spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cancel: {
    marginTop: spacing.sm,
  },
  attribution: {
    marginTop: spacing.md,
    fontSize: 9,
    color: colors.soft,
    textAlign: 'right',
  },
});
