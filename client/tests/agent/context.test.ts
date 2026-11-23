import { buildAgentNavStatus } from '@/agent/context';
import { ManeuverIcon } from '@/nav/maneuverMap';
import type { Route } from '@/nav/types';

const ROUTE: Route = {
  shape: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.001 },
    { lat: 0, lon: 0.002 },
  ],
  maneuvers: [
    {
      type: ManeuverIcon.START,
      streetNames: ['Начальная улица'],
      distanceMeters: 100,
      durationSeconds: 300,
      beginShapeIndex: 0,
      endShapeIndex: 1,
    },
    {
      type: ManeuverIcon.RIGHT,
      streetNames: ['Тверская улица'],
      distanceMeters: 100,
      durationSeconds: 300,
      beginShapeIndex: 1,
      endShapeIndex: 2,
    },
    {
      type: ManeuverIcon.ARRIVE,
      streetNames: [],
      distanceMeters: 0,
      durationSeconds: 0,
      beginShapeIndex: 2,
      endShapeIndex: 2,
    },
  ],
  distanceMeters: 200,
  durationSeconds: 600,
  profile: 'pedestrian',
};

describe('buildAgentNavStatus', () => {
  it('передаёт цель, остаток пути и следующий манёвр', () => {
    const status = buildAgentNavStatus({
      status: 'navigating',
      destinationName: 'Театр, Москва',
      route: ROUTE,
      currentPosition: { lat: 0, lon: 0.001 },
      gpsOk: true,
    });

    expect(status).toEqual({
      status: 'navigating',
      destinationName: 'Театр, Москва',
      remainingDistanceMeters: 89,
      remainingDurationSeconds: 266,
      nextManeuver: {
        kind: 'right',
        streetNames: ['Тверская улица'],
        distanceToManeuverMeters: 0,
      },
      routeProfile: 'pedestrian',
      gpsOk: true,
    });
  });

  it('не добавляет данные маршрута, когда маршрута нет', () => {
    expect(
      buildAgentNavStatus({
        status: 'idle',
        destinationName: null,
        route: null,
        currentPosition: null,
        gpsOk: false,
      }),
    ).toEqual({ status: 'idle', gpsOk: false });
  });
});
