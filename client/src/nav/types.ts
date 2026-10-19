export interface LatLng {
  lat: number;
  lon: number;
}

export type RouteProfile = 'pedestrian' | 'bicycle' | 'auto';

export interface RouteManeuver {
  /** Код типа манёвра Valhalla, см. maneuverMap.ts */
  type: number;
  instruction: string;
  streetNames: string[];
  distanceMeters: number;
  durationSeconds: number;
  beginShapeIndex: number;
  endShapeIndex: number;
  roundaboutExitCount?: number;
}

export interface Route {
  shape: LatLng[];
  maneuvers: RouteManeuver[];
  distanceMeters: number;
  durationSeconds: number;
  profile: RouteProfile;
}
