import { Platform } from 'react-native';
import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export interface AndroidNotification {
  packageName: string;
  category: string;
  title: string;
  text: string;
  postedAt: number;
}

type NotificationListenerEvents = { onNotification: (n: AndroidNotification) => void };

declare class NotificationListenerNative extends NativeModule<NotificationListenerEvents> {
  isPermissionGranted(): boolean;
  openPermissionSettings(): void;
}

/** null вне Android и в сборке без нативного модуля (Expo Go, веб, iOS). */
export const NotificationListener: NotificationListenerNative | null =
  Platform.OS === 'android'
    ? requireOptionalNativeModule<NotificationListenerNative>('NotificationListener')
    : null;
