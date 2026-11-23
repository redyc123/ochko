import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/ui/Icon';
import { colors, spacing } from '@/ui/theme';

import { AgentScreen } from './AgentScreen';
import { DeviceScreen } from './DeviceScreen';
import { NavigationScreen } from './NavigationScreen';
import { RootTabContext, type RootTab } from './tabContext';

const TABS: { key: RootTab; label: string; icon: IconName }[] = [
  { key: 'map', label: 'Карта', icon: 'map' },
  { key: 'assistant', label: 'Ассистент', icon: 'assistant' },
  { key: 'glasses', label: 'Очки', icon: 'glasses' },
];

function TabBar({ activeTab, onSelect }: { activeTab: RootTab; onSelect: (tab: RootTab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}
          >
            <View style={[styles.tabIcon, active ? styles.tabIconActive : null]}>
              <Icon
                name={tab.icon}
                size={20}
                color={active ? colors.accent : colors.soft}
                strokeWidth={active ? 2.1 : 1.8}
              />
            </View>
            <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RootShell() {
  const [activeTab, setActiveTab] = useState<RootTab>('map');
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <RootTabContext.Provider value={{ activeTab, setActiveTab }}>
      <View style={styles.container}>
        <View style={styles.content}>
          <View
            style={[styles.screen, activeTab !== 'map' ? styles.hidden : null]}
            pointerEvents={activeTab === 'map' ? 'auto' : 'none'}
            accessibilityElementsHidden={activeTab !== 'map'}
            importantForAccessibility={activeTab === 'map' ? 'auto' : 'no-hide-descendants'}
          >
            <NavigationScreen />
          </View>
          <View
            style={[styles.screen, activeTab !== 'assistant' ? styles.hidden : null]}
            pointerEvents={activeTab === 'assistant' ? 'auto' : 'none'}
            accessibilityElementsHidden={activeTab !== 'assistant'}
            importantForAccessibility={activeTab === 'assistant' ? 'auto' : 'no-hide-descendants'}
          >
            <AgentScreen />
          </View>
          <View
            style={[styles.screen, activeTab !== 'glasses' ? styles.hidden : null]}
            pointerEvents={activeTab === 'glasses' ? 'auto' : 'none'}
            accessibilityElementsHidden={activeTab !== 'glasses'}
            importantForAccessibility={activeTab === 'glasses' ? 'auto' : 'no-hide-descendants'}
          >
            <DeviceScreen />
          </View>
        </View>
        {keyboardVisible ? null : <TabBar activeTab={activeTab} onSelect={setActiveTab} />}
      </View>
    </RootTabContext.Provider>
  );
}

export function RootNavigator(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <RootShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
  },
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hidden: {
    opacity: 0,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
  },
  pressed: {
    opacity: 0.65,
  },
  tabIcon: {
    width: 44,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActive: {
    backgroundColor: colors.accentSoft,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
    color: colors.soft,
  },
  tabLabelActive: {
    color: colors.accent,
  },
});
