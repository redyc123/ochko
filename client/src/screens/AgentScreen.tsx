import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isSpeechAvailable } from '@/agent/speech';
import { shortPlaceName } from '@/agent/tools';
import { formatDistanceRu, formatDurationRu } from '@/nav/tracking';
import { useAgentStore } from '@/store/agentStore';
import { useNavStore } from '@/store/navStore';
import { CandidateList } from '@/ui/CandidateList';
import { Chip } from '@/ui/Chip';
import { GlassesMini } from '@/ui/GlassesPreview';
import { Icon } from '@/ui/Icon';
import { RouteMiniCard } from '@/ui/RouteMiniCard';
import { StatusBanner } from '@/ui/StatusBanner';
import { colors, profileLabels, radii, shadows, spacing } from '@/ui/theme';

import { useRootTab } from './tabContext';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Спросите что-нибудь или попросите проложить маршрут',
  listening: 'Слушаю… (нажмите ещё раз, чтобы закончить)',
  thinking: 'Думаю…',
  awaiting_choice: 'Уточните адрес: скажите номер или нажмите на вариант',
  error: 'Ошибка',
};

export function AgentScreen(): React.JSX.Element {
  const { setActiveTab } = useRootTab();
  const insets = useSafeAreaInsets();

  const status = useAgentStore((s) => s.status);
  const messages = useAgentStore((s) => s.messages);
  const partial = useAgentStore((s) => s.partial);
  const candidates = useAgentStore((s) => s.candidates);
  const errorMessage = useAgentStore((s) => s.errorMessage);
  const proxyUrl = useAgentStore((s) => s.proxyUrl);
  const ask = useAgentStore((s) => s.ask);
  const toggleListening = useAgentStore((s) => s.toggleListening);
  const chooseCandidate = useAgentStore((s) => s.chooseCandidate);
  const resetDialog = useAgentStore((s) => s.resetDialog);
  const setProxyUrl = useAgentStore((s) => s.setProxyUrl);

  const route = useNavStore((s) => s.route);
  const navStatus = useNavStore((s) => s.status);
  const navQuery = useNavStore((s) => s.query);
  const startNavigation = useNavStore((s) => s.startNavigation);

  const [text, setText] = useState('');
  const [proxyDraft, setProxyDraft] = useState(proxyUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speechAvailable] = useState(isSpeechAvailable);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, partial]);

  const send = () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    void ask(trimmed);
    setText('');
  };

  const openSettings = () => {
    setProxyDraft(proxyUrl);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    setProxyUrl(proxyDraft.trim() || proxyUrl);
    setSettingsOpen(false);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const statusLabel = STATUS_LABELS[status] ?? status;
  const listening = status === 'listening';
  const busy = status === 'thinking';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Ассистент</Text>
          <Text style={styles.subtitle}>Чем помочь?</Text>
        </View>
        <View style={styles.headerActions}>
          <GlassesMini onPress={() => setActiveTab('glasses')} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Настройки ассистента"
            onPress={openSettings}
            style={({ pressed }) => [styles.settingsButton, pressed ? styles.pressed : null]}
          >
            <Icon name="sliders" size={19} color={colors.ink} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <View style={styles.chatMeta}>
        <Text style={styles.dayLabel}>СЕГОДНЯ</Text>
        {status !== 'idle' ? (
          <Text style={styles.statusLine} numberOfLines={1}>
            {statusLabel}
          </Text>
        ) : null}
      </View>

      {errorMessage ? (
        <View style={styles.bannerWrap}>
          <StatusBanner message={errorMessage} tone="error" />
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={[styles.bubble, styles.botBubble]}>
            <Text style={styles.bubbleText}>
              Привет! Спросите, куда идти, или нажмите на микрофон.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isUser = item.role === 'user';
          const showRoute = !isUser && item.id === lastAssistantId && route !== null;
          return (
            <View style={[styles.bubble, isUser ? styles.userBubble : styles.botBubble]}>
              <Text style={styles.bubbleText}>{item.text}</Text>
              {showRoute ? (
                <View style={styles.routeCard}>
                  <RouteMiniCard
                    title={navQuery ? shortPlaceName(navQuery) : 'Маршрут'}
                    subtitle={`${formatDistanceRu(route.distanceMeters)} · ${formatDurationRu(route.durationSeconds)} · ${profileLabels[route.profile]}`}
                    onPress={() => {
                      setActiveTab('map');
                      if (navStatus === 'ready') startNavigation(Date.now());
                    }}
                  />
                </View>
              ) : null}
            </View>
          );
        }}
        ListFooterComponent={
          partial ? (
            <View style={[styles.bubble, styles.userBubble, styles.partialBubble]}>
              <Text style={styles.bubbleText}>{partial}</Text>
            </View>
          ) : undefined
        }
      />

      {candidates.length > 0 ? (
        <View style={styles.candidates}>
          <Text style={styles.candidatesTitle}>Уточните адрес</Text>
          <CandidateList
            candidates={candidates}
            onSelect={(_candidate, index) => chooseCandidate(index)}
          />
        </View>
      ) : null}

      <View style={styles.suggestions}>
        <Chip label="Домой" onPress={() => void ask('Домой')} />
        <Chip label="Кафе рядом" onPress={() => void ask('Кафе рядом')} />
        <Chip label="Где я?" onPress={() => void ask('Где я?')} />
      </View>

      {speechAvailable ? (
        <View style={styles.micArea}>
          <View style={styles.micWrap}>
            <View style={styles.micHaloOuter} />
            <View style={styles.micHaloInner} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={listening ? 'Остановить запись' : 'Спросить голосом'}
              disabled={busy}
              onPress={() => void toggleListening()}
              style={({ pressed }) => [
                styles.micOrb,
                listening ? styles.micOrbListening : null,
                busy ? styles.disabled : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Icon
                name={listening ? 'stop' : 'mic'}
                size={26}
                color={colors.surface}
                strokeWidth={2}
              />
            </Pressable>
          </View>
          <Text style={styles.micHint}>{listening ? 'Слушаю…' : 'Нажмите и говорите'}</Text>
        </View>
      ) : null}

      <View style={styles.composerRow}>
        <View style={styles.composerPill}>
          <TextInput
            style={styles.composerInput}
            placeholder="Спросите что-нибудь"
            placeholderTextColor={colors.soft}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            returnKeyType="send"
            selectionColor={colors.accent}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отправить"
            onPress={send}
            disabled={text.trim().length === 0 || busy}
            style={({ pressed }) => [
              styles.sendButton,
              text.trim().length === 0 || busy ? styles.disabled : null,
              pressed ? styles.pressed : null,
            ]}
          >
            <Icon name="send" size={17} color={colors.surface} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {!speechAvailable ? (
        <Text style={styles.hint}>Распознавание речи недоступно на этом устройстве/браузере.</Text>
      ) : null}

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
            <Text style={styles.modalTitle}>Настройки</Text>
            <Text style={styles.modalLabel}>АДРЕС СЕРВЕРА</Text>
            <TextInput
              style={styles.modalInput}
              value={proxyDraft}
              onChangeText={setProxyDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.0.10:8787"
              placeholderTextColor={colors.soft}
            />
            <Text style={styles.modalHint}>
              На телефоне укажите LAN-адрес компьютера, а не localhost.
            </Text>
            <View style={styles.modalRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Новый диалог"
                onPress={() => {
                  resetDialog();
                  setSettingsOpen(false);
                }}
                style={({ pressed }) => [styles.modalSecondary, pressed ? styles.pressed : null]}
              >
                <Text style={styles.modalSecondaryText}>Новый диалог</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Сохранить настройки"
                onPress={saveSettings}
                style={({ pressed }) => [styles.modalPrimary, pressed ? styles.pressed : null]}
              >
                <Text style={styles.modalPrimaryText}>Сохранить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  chatMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.soft,
  },
  statusLine: {
    flexShrink: 1,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'right',
  },
  bannerWrap: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  chat: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.lg,
    marginVertical: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.sand,
    borderBottomRightRadius: 6,
  },
  botBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderBottomLeftRadius: 6,
    ...shadows.card,
  },
  partialBubble: {
    opacity: 0.6,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  routeCard: {
    marginTop: spacing.sm,
  },
  candidates: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  candidatesTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.soft,
    marginBottom: spacing.xs,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  micArea: {
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  micWrap: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micHaloOuter: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.accentSoft,
    opacity: 0.45,
  },
  micHaloInner: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.accentSoft,
    opacity: 0.8,
  },
  micOrb: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...shadows.floating,
  },
  micOrbListening: {
    backgroundColor: colors.danger,
  },
  disabled: {
    opacity: 0.4,
  },
  micHint: {
    marginTop: 1,
    fontSize: 10,
    color: colors.muted,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  composerPill: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadows.card,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 0,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  hint: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.muted,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
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
    marginBottom: spacing.sm,
  },
  modalLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.soft,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 13,
    color: colors.ink,
  },
  modalHint: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  modalRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalSecondary: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  modalSecondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  modalPrimary: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.ink,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.surface,
  },
});
