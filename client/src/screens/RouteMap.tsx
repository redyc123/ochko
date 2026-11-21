import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';

import type { LatLng } from '../nav/types';
import { colors } from '../ui/theme';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_REGION = {
  latitude: 55.7558,
  longitude: 37.6173,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export interface RouteMapProps {
  shape?: LatLng[];
  currentPosition?: LatLng | null;
  destination?: LatLng | null;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
}

function regionFor(shape: LatLng[], currentPosition: LatLng | null, destination: LatLng | null) {
  if (currentPosition) {
    return {
      latitude: currentPosition.lat,
      longitude: currentPosition.lon,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  const points = shape.length > 0 ? shape : destination ? [destination] : [];
  if (points.length === 0) return DEFAULT_REGION;

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.008),
    longitudeDelta: Math.max((maxLon - minLon) * 1.6, 0.008),
  };
}

/**
 * Нативная реализация (iOS/Android) — react-native-maps с тайлами OSM.
 * У react-native-maps нет рабочей веб-реализации непосредственных компонентов
 * (Marker/Polyline/UrlTile падают при загрузке модуля в браузере), поэтому
 * есть RouteMap.web.tsx — Metro подставит его автоматически при сборке под web.
 */
export function RouteMap({
  shape = [],
  currentPosition = null,
  destination = null,
  style,
  interactive = true,
}: RouteMapProps): React.JSX.Element {
  return (
    <MapView
      style={[style ? null : styles.map, style]}
      region={regionFor(shape, currentPosition, destination)}
      mapType="none"
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      toolbarEnabled={false}
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
    </MapView>
  );
}

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
});
