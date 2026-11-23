import { ManeuverIcon } from '../nav/maneuverMap';
import { trackPosition } from '../nav/tracking';
import type { LatLng, Route } from '../nav/types';
import type { ServerAgentNavStatus } from '../server/api';

const MANEUVER_KIND_BY_ICON: Readonly<Record<number, string>> = {
  [ManeuverIcon.NONE]: 'unknown',
  [ManeuverIcon.STRAIGHT]: 'straight',
  [ManeuverIcon.SLIGHT_RIGHT]: 'slight_right',
  [ManeuverIcon.RIGHT]: 'right',
  [ManeuverIcon.SHARP_RIGHT]: 'sharp_right',
  [ManeuverIcon.UTURN]: 'uturn',
  [ManeuverIcon.SHARP_LEFT]: 'sharp_left',
  [ManeuverIcon.LEFT]: 'left',
  [ManeuverIcon.SLIGHT_LEFT]: 'slight_left',
  [ManeuverIcon.ROUNDABOUT]: 'roundabout',
  [ManeuverIcon.ARRIVE]: 'arrive',
  [ManeuverIcon.START]: 'start',
  [ManeuverIcon.STAIRS_OR_CROSSING]: 'stairs_or_crossing',
  [ManeuverIcon.KEEP_RIGHT]: 'keep_right',
  [ManeuverIcon.KEEP_LEFT]: 'keep_left',
  [ManeuverIcon.FERRY_OR_TRANSIT]: 'ferry_or_transit',
};

export interface AgentNavSnapshot {
  status: string;
  destinationName: string | null;
  route: Route | null;
  currentPosition: LatLng | null;
  gpsOk: boolean;
}

export function buildAgentNavStatus(nav: AgentNavSnapshot): ServerAgentNavStatus {
  const route = nav.route;
  const tracking = route && nav.currentPosition ? trackPosition(route, nav.currentPosition) : null;
  const upcomingIndex = tracking?.upcomingManeuverIndex ?? 0;
  const upcoming = route?.maneuvers[upcomingIndex];
  const remainingDistance = tracking?.remainingDistanceMeters ?? route?.distanceMeters;
  const remainingDuration = route
    ? tracking && route.distanceMeters > 0
      ? route.durationSeconds * (remainingDistance! / route.distanceMeters)
      : route.durationSeconds
    : undefined;

  return {
    status: nav.status,
    gpsOk: nav.gpsOk,
    ...(nav.destinationName ? { destinationName: nav.destinationName } : {}),
    ...(route && remainingDistance !== undefined
      ? {
          routeProfile: route.profile,
          remainingDistanceMeters: Math.max(0, Math.round(remainingDistance)),
          remainingDurationSeconds: Math.max(0, Math.round(remainingDuration ?? 0)),
        }
      : {}),
    ...(upcoming
      ? {
          nextManeuver: {
            kind: MANEUVER_KIND_BY_ICON[upcoming.type] ?? 'unknown',
            streetNames: upcoming.streetNames,
            distanceToManeuverMeters: Math.max(
              0,
              Math.round(tracking?.distanceToUpcomingManeuverMeters ?? 0),
            ),
          },
        }
      : {}),
  };
}
