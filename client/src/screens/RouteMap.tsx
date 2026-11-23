import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';

import type { LatLng } from '../nav/types';
import { colors } from '../ui/theme';
import { centerRegion, DEFAULT_CENTER, fitRegion, type MapApi, type MapRegion } from './mapRegions';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_REGION = centerRegion(DEFAULT_CENTER);

export interface RouteMapProps {
  shape?: LatLng[];
  currentPosition?: LatLng | null;
  destination?: LatLng | null;
  selectedPosition?: LatLng | null;
  onMapPress?: (position: LatLng) => void;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}

export type RouteMapHandle = MapApi;

function regionFor(shape: LatLng[], currentPosition: LatLng | null, destination: LatLng | null) {
  if (currentPosition) {
    return centerRegion(currentPosition);
  }
  const points = shape.length > 0 ? shape : destination ? [destination] : [];
  if (points.length === 0) return DEFAULT_REGION;
  return fitRegion(points);
}

/**
 * Нативная реализация (iOS/Android) — react-native-maps с тайлами OSM.
 * Камера управляется императивно через ref (animateToRegion): начальный регион
 * задаётся один раз через initialRegion, дальше экран сам двигает карту
 * (сворачивание шторки, следование, кнопка «на место»).
 * У react-native-maps нет рабочей веб-реализации непосредственных компонентов
 * (Marker/Polyline/UrlTile падают при загрузке модуля в браузере), поэтому
 * есть RouteMap.web.tsx — Metro подставит его автоматически при сборке под web.
 */
export const RouteMap = forwardRef<RouteMapHandle, RouteMapProps>(function RouteMap(
  {
    shape = [],
    currentPosition = null,
    destination = null,
    selectedPosition = null,
    onMapPress,
    style,
    interactive = true,
  },
  ref,
) {
  type MapViewRef = React.ElementRef<typeof MapView>;
  const mapRef = useRef<MapViewRef>(null);

  useImperativeHandle(ref, () => ({
    animateToRegion(region: MapRegion, durationMs = 600) {
      mapRef.current?.animateToRegion(
        {
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        },
        durationMs,
      );
    },
  }));

  return (
    <MapView
      ref={mapRef}
      style={[style ? null : styles.map, style]}
      initialRegion={regionFor(shape, currentPosition, destination)}
      mapType="none"
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      toolbarEnabled={false}
      onPress={
        onMapPress
          ? (event) =>
              onMapPress({
                lat: event.nativeEvent.coordinate.latitude,
                lon: event.nativeEvent.coordinate.longitude,
              })
          : undefined
      }
    >
      <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} />
      {shape.length > 1 ? (
        <Polyline
          coordinates={shape.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
          strokeWidth={5}
          strokeColor={colors.accent}
          lineCap="round"
          lineJoin="round"
        />
      ) : null}
      {currentPosition ? (
        <Marker
          coordinate={{ latitude: currentPosition.lat, longitude: currentPosition.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Я"
        >
          <View style={styles.currentDot}>
            <View style={styles.currentDotInner} />
          </View>
        </Marker>
      ) : null}
      {destination ? (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Цель"
        >
          <View style={styles.destinationPin}>
            <View style={styles.destinationPinInner} />
          </View>
        </Marker>
      ) : null}
      {selectedPosition ? (
        <Marker
          coordinate={{ latitude: selectedPosition.lat, longitude: selectedPosition.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          title="Выбранная точка"
        >
          <View style={styles.selectedPin}>
            <View style={styles.selectedPinInner} />
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
});

const styles = StyleSheet.create({
  map: { height: 220, borderRadius: 8 },
  currentDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent2,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
  },
  destinationPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationPinInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  selectedPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.accent,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedPinInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
});
