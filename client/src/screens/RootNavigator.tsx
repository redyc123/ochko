import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AgentScreen } from './AgentScreen';
import { DeviceScreen } from './DeviceScreen';
import { NavigationScreen } from './NavigationScreen';

export type RootStackParamList = {
  Navigation: undefined;
  Agent: undefined;
  Device: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Navigation">
        <Stack.Screen
          name="Navigation"
          component={NavigationScreen}
          options={({ navigation }) => ({
            title: 'О.Ч.К.О. — Навигация',
            headerRight: () => (
              <View style={styles.headerLinks}>
                <Pressable onPress={() => navigation.navigate('Agent')}>
                  <Text>Агент</Text>
                </Pressable>
                <Pressable onPress={() => navigation.navigate('Device')}>
                  <Text>Устройство</Text>
                </Pressable>
              </View>
            ),
          })}
        />
        <Stack.Screen name="Agent" component={AgentScreen} options={{ title: 'Ассистент' }} />
        <Stack.Screen name="Device" component={DeviceScreen} options={{ title: 'Устройство' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  headerLinks: { flexDirection: 'row', gap: 16 },
});
