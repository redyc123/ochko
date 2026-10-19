import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { DeviceScreen } from './DeviceScreen';
import { NavigationScreen } from './NavigationScreen';

export type RootStackParamList = {
  Navigation: undefined;
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
              <Pressable onPress={() => navigation.navigate('Device')}>
                <Text>Устройство</Text>
              </Pressable>
            ),
          })}
        />
        <Stack.Screen name="Device" component={DeviceScreen} options={{ title: 'Устройство' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
