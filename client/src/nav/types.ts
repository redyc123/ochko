export interface LatLng {
  lat: number;
  lon: number;
}

export type RouteProfile = 'pedestrian' | 'bicycle' | 'auto';

export interface RouteManeuver {
  /** Уже переведённый код иконки протокола О.Ч.К.О. (ManeuverIcon), см. maneuverMap.ts */
  type: number;
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
