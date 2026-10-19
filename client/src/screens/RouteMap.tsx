import React from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import type { LatLng } from '../nav/types';

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface RouteMapProps {
  shape: LatLng[];
  currentPosition: LatLng | null;
  destination: LatLng | null;
}

/**
 * Нативная реализация (iOS/Android) — react-native-maps с тайлами OSM.
 * У react-native-maps нет рабочей веб-реализации непосредственных компонентов
 * (Marker/Polyline/UrlTile падают при загрузке модуля в браузере), поэтому
 * есть RouteMap.web.tsx — Metro подставит его автоматически при сборке под web.
 */
export function RouteMap({
  shape,
  currentPosition,
  destination,
}: RouteMapProps): React.JSX.Element {
  const region = currentPosition
    ? {
        latitude: currentPosition.lat,
        longitude: currentPosition.lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }
    : undefined;

  return (
    <MapView style={styles.map} region={region} mapType="none">
      <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} />
      <Polyline
        coordinates={shape.map((p) => ({ latitude: p.lat, longitude: p.lon }))}
        strokeWidth={4}
        strokeColor="#2e7d32"
      />
      {currentPosition && (
        <Marker
          coordinate={{ latitude: currentPosition.lat, longitude: currentPosition.lon }}
          title="Я"
        />
      )}
      {destination && (
        <Marker
          coordinate={{ latitude: destination.lat, longitude: destination.lon }}
          title="Цель"
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { height: 220, borderRadius: 8 },
});
