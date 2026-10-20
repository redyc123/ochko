import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmulatorScreen } from '../emulator/EmulatorScreen';
import { formatDistanceRu } from '../nav/tracking';
import { useDeviceStore } from '../store/deviceStore';
import { useNavStore } from '../store/navStore';
import { RouteMap } from './RouteMap';

const SIMULATION_SPEED_OPTIONS = [1, 2, 5, 10] as const;

const STATUS_LABELS: Record<string, string> = {
  idle: 'Готово к вводу цели',
  searching: 'Ищу адрес…',
  choosing: 'Выберите вариант',
  routing: 'Строю маршрут…',
  navigating: 'Веду по маршруту',
  rerouting: 'Перестраиваю…',
  arrived: 'Вы на месте',
  error: 'Ошибка',
};

export function NavigationScreen(): React.JSX.Element {
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

  const [query, setQuery] = useState('');
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(5);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);

  // Реальный GPS — только когда не включена симуляция (она подменяет источник позиции).
  useEffect(() => {
    if (simulationEnabled) {
      locationSubscription.current?.remove();
      locationSubscription.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted' || cancelled) return;
      locationSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        (loc) =>
          updatePosition({ lat: loc.coords.latitude, lon: loc.coords.longitude }, Date.now()),
      );
    })();
    return () => {
      cancelled = true;
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

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Куда вам нужно?"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => navigateTo(query)}
        />
        <Pressable style={styles.button} onPress={() => navigateTo(query)}>
          <Text style={styles.buttonText}>Найти</Text>
        </Pressable>
      </View>

      <Text style={styles.status}>{STATUS_LABELS[status] ?? status}</Text>
      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      {!gpsOk && <Text style={styles.error}>Нет GPS</Text>}

      {status === 'choosing' && (
        <FlatList
          data={candidates}
          keyExtractor={(c, i) => `${c.lat},${c.lon},${i}`}
          renderItem={({ item }) => (
            <Pressable style={styles.candidateRow} onPress={() => chooseDestination(item)}>
              <Text numberOfLines={2}>{item.displayName}</Text>
            </Pressable>
          )}
        />
      )}

      {route && (
        <>
          <RouteMap
            shape={route.shape}
            currentPosition={currentPosition}
            destination={destination}
          />
          <Text style={styles.attribution}>© участники OpenStreetMap</Text>

          <ScrollView style={styles.maneuverList}>
            {route.maneuvers.map((m, i) => (
              <Text key={i} style={styles.maneuverRow}>
                {m.streetNames[0] ?? '—'} · {formatDistanceRu(m.distanceMeters)}
              </Text>
            ))}
          </ScrollView>

          <View style={styles.row}>
            {(status === 'ready' || status === 'arrived') && (
              <Pressable style={styles.button} onPress={() => startNavigation(Date.now())}>
                <Text style={styles.buttonText}>Начать</Text>
              </Pressable>
            )}
            {(status === 'navigating' || status === 'rerouting') && (
              <Pressable style={[styles.button, styles.dangerButton]} onPress={stopNavigation}>
                <Text style={styles.buttonText}>Стоп</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.row}>
            <Pressable
              style={[styles.toggle, simulationEnabled && styles.toggleActive]}
              onPress={() => handleToggleSimulation(!simulationEnabled)}
            >
              <Text style={styles.buttonText}>Симуляция поездки</Text>
            </Pressable>
            {SIMULATION_SPEED_OPTIONS.map((mult) => (
              <Pressable
                key={mult}
                style={[styles.speedButton, speedMultiplier === mult && styles.toggleActive]}
                onPress={() => {
                  setSpeedMultiplier(mult);
                  useNavStore.getState().simulator?.setSpeedMultiplier(mult);
                }}
              >
                <Text style={styles.buttonText}>×{mult}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Text style={styles.previewLabel}>Превью экрана очков</Text>
      <EmulatorScreen device={emulator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  status: { fontWeight: '600' },
  error: { color: '#c0392b' },
  button: {
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  dangerButton: { backgroundColor: '#c0392b' },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  toggle: { backgroundColor: '#555', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  toggleActive: { backgroundColor: '#1565c0' },
  speedButton: {
    backgroundColor: '#777',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  candidateRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  attribution: { fontSize: 10, color: '#888' },
  maneuverList: { maxHeight: 120 },
  maneuverRow: { paddingVertical: 4 },
  previewLabel: { marginTop: 8, fontWeight: '600' },
});
