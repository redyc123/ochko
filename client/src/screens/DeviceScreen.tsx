import React, { useEffect, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationListener } from '../../modules/notification-listener';
import type { ScannedGlasses } from '../ble/connection';
import { EmulatorScreen } from '../emulator/EmulatorScreen';
import { useDeviceStore } from '../store/deviceStore';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { InfoRow } from '@/ui/InfoRow';
import { ProgressRing } from '@/ui/ProgressRing';
import { SectionCard } from '@/ui/SectionCard';
import { StatusBanner } from '@/ui/StatusBanner';
import { ToggleRow } from '@/ui/ToggleRow';
import { colors, radii, shadows, spacing } from '@/ui/theme';

const CONNECTION_STATE_LABELS: Record<string, string> = {
  idle: 'Не подключено',
  connecting: 'Подключаюсь…',
  connected: 'Подключены',
  pairing_required: 'Нужно сопряжение',
  disconnected: 'Отключены',
  error: 'Ошибка',
};

/** Android: доступ к уведомлениям выдаётся только в системных настройках. */
function NotificationAccessRow(): React.JSX.Element | null {
  const [granted, setGranted] = useState(() => NotificationListener?.isPermissionGranted() ?? true);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setGranted(NotificationListener?.isPermissionGranted() ?? true);
    });
    return () => sub.remove();
  }, []);

  if (!NotificationListener || granted) return null;
  return (
    <StatusBanner
      message="Разрешить доступ к уведомлениям"
      tone="info"
      onPress={() => NotificationListener?.openPermissionSettings()}
    />
  );
}

export function DeviceScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const mode = useDeviceStore((s) => s.mode);
  const bleConnection = useDeviceStore((s) => s.bleConnection);
  const battery = useDeviceStore((s) => s.battery);
  const emulator = useDeviceStore((s) => s.emulator);
  const setMode = useDeviceStore((s) => s.setMode);
  const scan = useDeviceStore((s) => s.scan);
  const connect = useDeviceStore((s) => s.connect);
  const disconnect = useDeviceStore((s) => s.disconnect);
  const forget = useDeviceStore((s) => s.forget);

  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<ScannedGlasses[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    useDeviceStore.getState().hydrate();
  }, []);

  const info = mode === 'emulator' ? emulator.info : bleConnection.info;
  const isEmulator = mode === 'emulator';
  const connectionLabel = isEmulator
    ? 'Эмулятор · локально'
    : `BLE · ${CONNECTION_STATE_LABELS[bleConnection.state] ?? bleConnection.state}`;
  const statusTitle = isEmulator
    ? 'Подключены'
    : (CONNECTION_STATE_LABELS[bleConnection.state] ?? bleConnection.state);
  const connected = isEmulator || bleConnection.state === 'connected';
  const statusColor = connected
    ? colors.accent
    : bleConnection.state === 'error'
      ? colors.danger
      : colors.soft;
  const batteryPercent = battery?.percent ?? 0;

  const handleScan = () => {
    setFound([]);
    setScanError(null);
    setScanning(true);
    const stop = scan(
      (device) =>
        setFound((prev) => (prev.some((d) => d.id === device.id) ? prev : [...prev, device])),
      (message) => setScanError(message),
    );
    setTimeout(() => {
      stop();
      setScanning(false);
    }, 10_000);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.sm }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Очки</Text>
            <Text style={styles.subtitle}>OCHKO One</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Настройки очков"
            onPress={() => setSettingsOpen(true)}
            style={({ pressed }) => [styles.settingsButton, pressed ? styles.pressed : null]}
          >
            <Icon name="sliders" size={19} color={colors.ink} strokeWidth={2} />
          </Pressable>
        </View>

        <SectionCard>
          <View style={styles.statusRow}>
            <View style={styles.statusText}>
              <View style={styles.statusTitleRow}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={styles.statusTitle} numberOfLines={1}>
                  {statusTitle}
                </Text>
              </View>
              <Text style={styles.statusSubtitle} numberOfLines={1}>
                {connectionLabel}
              </Text>
            </View>
            <ProgressRing
              size={62}
              strokeWidth={6}
              progress={batteryPercent / 100}
              color={colors.accent}
            >
              <Text style={styles.batteryPercent}>{battery ? `${battery.percent}%` : '—'}</Text>
            </ProgressRing>
          </View>
        </SectionCard>

        <SectionCard
          tone="dark"
          title="Экран очков"
          action={
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
          }
        >
          <View style={styles.previewRow}>
            <EmulatorScreen device={emulator} scale={2.4} buttonSize={48} layout="row" />
          </View>
          <Button
            label="Имитировать заряд 80%"
            icon="check"
            variant="accent"
            size="compact"
            fullWidth
            onPress={() => emulator.setBattery(80, 4000, false)}
            style={styles.previewButton}
          />
        </SectionCard>

        <SectionCard title="Устройство">
          <InfoRow
            label="Прошивка"
            value={info ? `${info.fwMajor}.${info.fwMinor}.${info.fwPatch}` : '—'}
          />
          <InfoRow label="Протокол" value={info ? `v${info.protoVer} FRAME` : '—'} />
          <InfoRow
            label="Батарея"
            value={battery ? `${battery.percent}% · ${(battery.mv / 1000).toFixed(1)} В` : '—'}
            last
          />
        </SectionCard>

        <SectionCard>
          <ToggleRow
            label="Режим эмулятора"
            description="Работать без реальных очков"
            value={isEmulator}
            onValueChange={(value) => setMode(value ? 'emulator' : 'ble')}
          />
        </SectionCard>

        <NotificationAccessRow />

        {isEmulator ? (
          <Text style={styles.note}>
            Реальные очки не подключены. Переключите режим, чтобы найти устройство по BLE.
          </Text>
        ) : (
          <>
            <SectionCard title="Подключение">
              {bleConnection.errorMessage ? (
                <StatusBanner message={bleConnection.errorMessage} tone="error" />
              ) : null}
              <Button
                label={scanning ? 'Сканирую…' : 'Сканировать'}
                icon="scan"
                variant="primary"
                fullWidth
                disabled={scanning}
                onPress={handleScan}
                style={styles.scanButton}
              />
              {scanError ? <StatusBanner message={scanError} tone="error" /> : null}
              {found.length > 0 ? (
                <View style={styles.foundList}>
                  {found.map((device, index) => (
                    <Pressable
                      key={device.id}
                      accessibilityRole="button"
                      accessibilityLabel={device.name ?? device.id}
                      onPress={() => connect(device.id, device.name)}
                      style={({ pressed }) => [
                        styles.deviceRow,
                        index === found.length - 1 ? null : styles.deviceDivider,
                        pressed ? styles.pressed : null,
                      ]}
                    >
                      <View style={styles.deviceIcon}>
                        <Icon name="glasses" size={18} color={colors.accent} strokeWidth={2} />
                      </View>
                      <Text style={styles.deviceName} numberOfLines={1}>
                        {device.name ?? device.id}
                      </Text>
                      <Icon name="chevronRight" size={17} color={colors.soft} strokeWidth={2} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={styles.scanHint}>
                  {scanning ? 'Ищу очки рядом…' : 'Нажмите «Сканировать», чтобы найти очки.'}
                </Text>
              )}
              <View style={styles.actions}>
                <Button
                  label="Отключить"
                  variant="outline"
                  size="compact"
                  onPress={() => disconnect()}
                  style={styles.actionButton}
                />
                <Button
                  label="Забыть"
                  variant="danger"
                  size="compact"
                  onPress={() => forget()}
                  style={styles.actionButton}
                />
              </View>
            </SectionCard>
          </>
        )}
      </ScrollView>

      <Modal
        visible={settingsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Закрыть настройки"
            onPress={() => setSettingsOpen(false)}
          />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + spacing.xl }]}>
            <Text style={styles.modalTitle}>Настройки очков</Text>
            <Text style={styles.modalHint}>
              Забыть сохранённое устройство и сбросить автоподключение.
            </Text>
            <Button
              label="Забыть устройство"
              variant="danger"
              fullWidth
              onPress={() => {
                forget();
                setSettingsOpen(false);
              }}
            />
            <Button
              label="Закрыть"
              variant="outline"
              fullWidth
              onPress={() => setSettingsOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.9,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    color: colors.muted,
  },
  settingsButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  pressed: {
    opacity: 0.72,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  statusText: {
    flex: 1,
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusTitle: {
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  statusSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
  },
  batteryPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.displayText,
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.displayText,
  },
  previewRow: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  previewButton: {
    marginTop: spacing.md,
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.muted,
    paddingHorizontal: spacing.xs,
  },
  scanButton: {
    marginBottom: spacing.md,
  },
  scanHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  foundList: {
    marginTop: spacing.xs,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
  },
  deviceDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  deviceIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  deviceName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 23, 26, 0.35)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.ink,
  },
  modalHint: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
});
