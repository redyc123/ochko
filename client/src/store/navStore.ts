import { create } from 'zustand';
import { NavState } from '../ble/protocol/display';
import { ButtonKind } from '../ble/protocol/events';
import { NominatimClient, type GeocodeResult } from '../nav/geocode';
import { OsrmRouter, RouteError, type Router } from '../nav/router';
import { RouteSimulator, type SimulatedFix } from '../nav/simulate';
import {
  hasGpsTimedOut,
  isArrived,
  roundDistanceMeters,
  shouldSendProgress,
  trackPosition,
  RerouteDetector,
  type ProgressSample,
} from '../nav/tracking';
import type { LatLng, Route, RouteProfile } from '../nav/types';
import { useDeviceStore } from './deviceStore';

export type NavStatus =
  | 'idle'
  | 'searching'
  | 'choosing'
  | 'routing'
  | 'ready'
  | 'navigating'
  | 'rerouting'
  | 'arrived'
  | 'error';

const DEFAULT_NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_OSRM_BASE_URL = 'https://routing.openstreetmap.de';
/**
 * Контакт обязателен правилами публичных Nominatim/OSRM (FOSSGIS) — замените
 * на свой при продакшн-использовании. Строго ASCII: значение HTTP-заголовка
 * не может содержать кириллицу — браузер (fetch) бросает исключение ещё до
 * отправки запроса, если в нём встречаются не-ISO-8859-1 символы.
 */
const APP_USER_AGENT = 'ochko-app/0.1 (OCHKO smart glasses diploma project; https://github.com/)';
/** ~5.5 км вокруг пользователя — оценка, не измерено. */
const VIEWBOX_DELTA_DEG = 0.05;
const AUTO_SELECT_SINGLE_RESULT = true;

export interface NavSettings {
  nominatimBaseUrl: string;
  osrmBaseUrl: string;
}

export interface NavStoreState {
  settings: NavSettings;
  profile: RouteProfile;
  status: NavStatus;
  query: string;
  candidates: GeocodeResult[];
  destination: LatLng | null;
  route: Route | null;
  errorMessage: string | null;
  currentPosition: LatLng | null;
  lastFixAtMs: number | null;
  gpsOk: boolean;
  simulationEnabled: boolean;
  simulator: RouteSimulator | null;

  setProfile: (profile: RouteProfile) => void;
  setSettings: (settings: Partial<NavSettings>) => void;
  navigateTo: (query: string) => Promise<void>;
  chooseDestination: (candidate: GeocodeResult) => Promise<void>;
  startNavigation: (nowMs: number) => void;
  stopNavigation: () => void;
  updatePosition: (position: LatLng, atMs: number) => void;
  checkGpsTimeout: (nowMs: number) => void;
  enableSimulation: (enabled: boolean, speedMultiplier?: number) => void;
  tickSimulation: (nowMs: number) => void;
}

function buildClients(settings: NavSettings): { geocoder: NominatimClient; router: Router } {
  return {
    geocoder: new NominatimClient({
      baseUrl: settings.nominatimBaseUrl,
      userAgent: APP_USER_AGENT,
    }),
    router: new OsrmRouter({ baseUrl: settings.osrmBaseUrl, userAgent: APP_USER_AGENT }),
  };
}

export const useNavStore = create<NavStoreState>((set, get) => {
  let { geocoder, router } = buildClients({
    nominatimBaseUrl: DEFAULT_NOMINATIM_BASE_URL,
    osrmBaseUrl: DEFAULT_OSRM_BASE_URL,
  });
  const rerouteDetector = new RerouteDetector();
  let lastManeuverIndex: number | null = null;
  let lastProgressSample: ProgressSample | null = null;

  function glassesApi() {
    return useDeviceStore.getState().glassesApi;
  }

  async function buildRoute(from: LatLng, to: LatLng): Promise<Route | null> {
    try {
      const route = await router.route(from, to, get().profile);
      return route;
    } catch (err) {
      const message = err instanceof RouteError ? err.message : 'Не удалось построить маршрут.';
      set({ status: 'error', errorMessage: message });
      void glassesApi().showNavState(NavState.ROUTE_ERROR);
      return null;
    }
  }

  async function routeAndMaybeStart(
    destination: LatLng,
    autoStart: boolean,
    nowMs?: number,
  ): Promise<void> {
    const from = get().currentPosition;
    if (!from) {
      set({ status: 'error', errorMessage: 'Нет текущей позиции — включите GPS.' });
      return;
    }
    // При перестроении статус уже 'rerouting' (очки уже показывают REROUTING)
    // — не затираем его на 'routing'/BUILDING на долю секунды пересчёта.
    const isRerouting = get().status === 'rerouting';
    if (!isRerouting) {
      set({ status: 'routing' });
      void glassesApi().showNavState(NavState.BUILDING);
    }
    set({ destination, errorMessage: null });
    const route = await buildRoute(from, destination);
    if (!route) return;
    // Маршрут сбросили кнопкой, пока он строился
    if (get().status === 'idle') return;
    set({ route, status: 'ready' });
    if (autoStart) {
      get().startNavigation(nowMs ?? Date.now());
    } else {
      void glassesApi().showNavState(NavState.READY);
    }
  }

  // Кнопка очков: короткое нажатие запускает построенный маршрут,
  // удержание во время маршрута сбрасывает экран к часам.
  glassesApi().onButton((kind) => {
    const { status } = get();
    if (kind === ButtonKind.SHORT && status === 'ready') {
      get().startNavigation(Date.now());
    } else if (
      kind === ButtonKind.HOLD_START &&
      (status === 'ready' ||
        status === 'navigating' ||
        status === 'rerouting' ||
        status === 'arrived')
    ) {
      get().stopNavigation();
    }
  });

  return {
    settings: {
      nominatimBaseUrl: DEFAULT_NOMINATIM_BASE_URL,
      osrmBaseUrl: DEFAULT_OSRM_BASE_URL,
    },
    profile: 'pedestrian',
    status: 'idle',
    query: '',
    candidates: [],
    destination: null,
    route: null,
    errorMessage: null,
    currentPosition: null,
    lastFixAtMs: null,
    gpsOk: true,
    simulationEnabled: false,
    simulator: null,

    setProfile: (profile) => set({ profile }),

    setSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      const clients = buildClients(settings);
      geocoder = clients.geocoder;
      router = clients.router;
      set({ settings });
    },

    navigateTo: async (query) => {
      set({ query, status: 'searching', errorMessage: null, candidates: [] });
      const viewbox = get().currentPosition
        ? {
            minLon: get().currentPosition!.lon - VIEWBOX_DELTA_DEG,
            minLat: get().currentPosition!.lat - VIEWBOX_DELTA_DEG,
            maxLon: get().currentPosition!.lon + VIEWBOX_DELTA_DEG,
            maxLat: get().currentPosition!.lat + VIEWBOX_DELTA_DEG,
          }
        : undefined;

      let results: GeocodeResult[];
      try {
        results = await geocoder.search(query, { viewbox, limit: 5 });
      } catch {
        set({ status: 'error', errorMessage: 'Нет сети: не удалось найти адрес.' });
        return;
      }

      if (results.length === 0) {
        set({ status: 'error', errorMessage: 'Ничего не найдено.', candidates: [] });
        return;
      }
      if (results.length === 1 && AUTO_SELECT_SINGLE_RESULT) {
        await routeAndMaybeStart({ lat: results[0]!.lat, lon: results[0]!.lon }, false);
        return;
      }
      set({ status: 'choosing', candidates: results });
    },

    chooseDestination: async (candidate) => {
      await routeAndMaybeStart({ lat: candidate.lat, lon: candidate.lon }, false);
    },

    startNavigation: (nowMs) => {
      if (!get().route) return;
      lastManeuverIndex = null;
      lastProgressSample = null;
      rerouteDetector.reset();
      // lastFixAtMs сбрасывается на момент старта, а не оставляется от более
      // раннего фикса: на реальном GPS время до первого точного фикса (TTFF)
      // может занимать десятки секунд (особенно в помещении), и без сброса
      // checkGpsTimeout сразу же находит «устаревший» фикс и показывает
      // «Нет GPS», даже не дав GPS шанса обновиться после старта навигации.
      set({ status: 'navigating', gpsOk: true, lastFixAtMs: nowMs });
      void glassesApi().showNavState(NavState.GUIDING);
    },

    stopNavigation: () => {
      set({
        status: 'idle',
        route: null,
        destination: null,
        simulator: null,
        simulationEnabled: false,
      });
      void glassesApi().showNavState(NavState.OFF);
      void glassesApi().clear(2);
    },

    updatePosition: (position, atMs) => {
      set({ currentPosition: position, lastFixAtMs: atMs, gpsOk: true });
      const { route, status } = get();
      if (status !== 'navigating' && status !== 'rerouting') return;
      if (!route) return;

      const result = trackPosition(route, position);

      if (rerouteDetector.update(result.offRouteMeters, atMs)) {
        const destination = get().destination;
        set({ status: 'rerouting' });
        void glassesApi().showNavState(NavState.REROUTING);
        if (destination) {
          void routeAndMaybeStart(destination, true, atMs).then(() => {
            if (get().status === 'rerouting') set({ status: 'navigating' });
          });
        }
        return;
      }

      if (isArrived(result.remainingDistanceMeters)) {
        set({ status: 'arrived' });
        void glassesApi().showNavState(NavState.ARRIVED);
        return;
      }

      if (status !== 'navigating') return;

      if (result.upcomingManeuverIndex !== lastManeuverIndex) {
        lastManeuverIndex = result.upcomingManeuverIndex;
        const maneuver = route.maneuvers[result.upcomingManeuverIndex];
        if (maneuver) {
          void glassesApi().showManeuver({
            icon: maneuver.type,
            exitNo: maneuver.roundaboutExitCount ?? 0,
            distM: roundDistanceMeters(result.distanceToUpcomingManeuverMeters),
            totalM: Math.round(result.remainingDistanceMeters),
            etaMin: Math.round(maneuver.durationSeconds / 60),
            street: maneuver.streetNames[0] ?? '',
          });
        }
      }

      const currentSample: ProgressSample = {
        distanceM: roundDistanceMeters(result.distanceToUpcomingManeuverMeters),
        atMs,
      };
      if (shouldSendProgress(lastProgressSample, currentSample)) {
        lastProgressSample = currentSample;
        void glassesApi().showProgress(
          currentSample.distanceM,
          Math.round(result.remainingDistanceMeters),
          0,
        );
      }
    },

    checkGpsTimeout: (nowMs) => {
      const { lastFixAtMs, status } = get();
      if (lastFixAtMs === null || status !== 'navigating') return;
      const timedOut = hasGpsTimedOut(lastFixAtMs, nowMs);
      if (timedOut !== !get().gpsOk) {
        set({ gpsOk: !timedOut });
        if (timedOut) void glassesApi().showNavState(NavState.NO_GPS);
      }
    },

    enableSimulation: (enabled, speedMultiplier = 1) => {
      const route = get().route;
      if (enabled && route) {
        set({ simulationEnabled: true, simulator: new RouteSimulator(route, { speedMultiplier }) });
      } else {
        set({ simulationEnabled: false, simulator: null });
      }
    },

    tickSimulation: (nowMs) => {
      const simulator = get().simulator;
      if (!simulator) return;
      const fix: SimulatedFix = simulator.tick(nowMs);
      get().updatePosition(fix.position, nowMs);
    },
  };
});
