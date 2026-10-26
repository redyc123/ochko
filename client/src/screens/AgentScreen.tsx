import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isSpeechAvailable } from '../agent/speech';
import { shortPlaceName } from '../agent/tools';
import { EmulatorScreen } from '../emulator/EmulatorScreen';
import { useAgentStore } from '../store/agentStore';
import { useDeviceStore } from '../store/deviceStore';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Спросите что-нибудь или попросите проложить маршрут',
  listening: 'Слушаю… (нажмите ещё раз, чтобы закончить)',
  thinking: 'Думаю…',
  awaiting_choice: 'Уточните адрес: скажите номер или нажмите на вариант',
  error: 'Ошибка',
};

export function AgentScreen(): React.JSX.Element {
  const emulator = useDeviceStore((s) => s.emulator);
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

  const [text, setText] = useState('');
  const [proxyDraft, setProxyDraft] = useState(proxyUrl);
  const [speechAvailable] = useState(isSpeechAvailable);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, partial]);

  const send = () => {
    void ask(text);
    setText('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.proxyInput]}
          value={proxyDraft}
          onChangeText={setProxyDraft}
          onEndEditing={() => setProxyUrl(proxyDraft.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.0.10:8787"
        />
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={resetDialog}>
          <Text style={styles.buttonText}>Новый диалог</Text>
        </Pressable>
      </View>

      <Text style={styles.status}>{STATUS_LABELS[status] ?? status}</Text>
      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <FlatList
        ref={listRef}
        style={styles.chat}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => (
          <View
            style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.botBubble]}
          >
            <Text>{item.text}</Text>
          </View>
        )}
        ListFooterComponent={
          partial ? (
            <View style={[styles.bubble, styles.userBubble, styles.partialBubble]}>
              <Text>{partial}</Text>
            </View>
          ) : undefined
        }
      />

      {candidates.length > 0 && (
        <View>
          {candidates.map((c, i) => (
            <Pressable
              key={`${c.lat},${c.lon},${i}`}
              style={styles.candidateRow}
              onPress={() => chooseCandidate(i)}
            >
              <Text numberOfLines={2}>
                {i + 1}. {shortPlaceName(c.displayName)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Вопрос текстом"
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
        />
        <Pressable style={styles.button} onPress={send}>
          <Text style={styles.buttonText}>➤</Text>
        </Pressable>
        <Pressable
          style={[
            styles.button,
            styles.micButton,
            status === 'listening' && styles.micActive,
            !speechAvailable && styles.disabled,
          ]}
          disabled={!speechAvailable || status === 'thinking'}
          onPress={() => void toggleListening()}
        >
          <Text style={styles.buttonText}>{status === 'listening' ? '■' : '🎤'}</Text>
        </Pressable>
      </View>
      {!speechAvailable && (
        <Text style={styles.hint}>Распознавание речи недоступно на этом устройстве/браузере.</Text>
      )}

      <Text style={styles.previewLabel}>Превью экрана очков</Text>
      <EmulatorScreen device={emulator} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  proxyInput: { fontSize: 12 },
  status: { fontWeight: '600' },
  error: { color: '#c0392b' },
  hint: { fontSize: 12, color: '#888' },
  chat: { flex: 1 },
  bubble: { padding: 10, borderRadius: 10, marginVertical: 4, maxWidth: '85%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#dcedc8' },
  botBubble: { alignSelf: 'flex-start', backgroundColor: '#eceff1' },
  partialBubble: { opacity: 0.6 },
  candidateRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  button: {
    backgroundColor: '#2e7d32',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  secondaryButton: { backgroundColor: '#555' },
  micButton: { backgroundColor: '#1565c0' },
  micActive: { backgroundColor: '#c0392b' },
  disabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  previewLabel: { marginTop: 8, fontWeight: '600' },
});
