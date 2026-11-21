import { create } from 'zustand';
import { NavState } from '../ble/protocol/display';
import { ButtonKind } from '../ble/protocol/events';
import type { GeocodeResult } from '../nav/geocode';
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
import {
  buildRoute as serverBuildRoute,
  geocode as serverGeocode,
  DEFAULT_PROXY_URL,
  ServerError,
  type ServerGeocodeResult,
} from '../server/api';
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

/** ~5.5 км вокруг пользователя — оценка, не измерено. */
const VIEWBOX_DELTA_DEG = 0.05;
const AUTO_SELECT_SINGLE_RESULT = true;

export interface NavSettings {
  proxyUrl: string;
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
  /**
   * Только поиск: при нескольких вариантах — status 'choosing', маршрут не
   * строится (выбор за вызывающим — UI или агентом). null — ошибка сети.
   */
  searchDestination: (query: string) => Promise<ServerGeocodeResult[] | null>;
  chooseDestination: (candidate: GeocodeResult) => Promise<void>;
  /**
   * Применить построенный на сервере маршрут (из /agent action start_route).
   * Ставит destination/route и переводит в 'ready', не запуская навигацию.
   */
  applyServerRoute: (destination: LatLng, route: Route) => void;
  startNavigation: (nowMs: number) => void;
  stopNavigation: () => void;
  updatePosition: (position: LatLng, atMs: number) => void;
  checkGpsTimeout: (nowMs: number) => void;
  enableSimulation: (enabled: boolean, speedMultiplier?: number) => void;
  tickSimulation: (nowMs: number) => void;
}

export const useNavStore = create<NavStoreState>((set, get) => {
  const rerouteDetector = new RerouteDetector();
  let lastManeuverIndex: number | null = null;
  let lastProgressSample: ProgressSample | null = null;

  function glassesApi() {
    return useDeviceStore.getState().glassesApi;
  }

  function proxyUrl() {
    return get().settings.proxyUrl;
  }

  function isServerError(err: unknown): err is ServerError {
    return err instanceof ServerError;
  }

  async function buildRouteViaServer(from: LatLng, to: LatLng): Promise<Route | null> {
    try {
      return await serverBuildRoute(proxyUrl(), { from, to, profile: get().profile });
    } catch (err) {
      const message = isServerError(err)
        ? err.message
        : 'Не удалось построить маршрут.';
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
    const route = await buildRouteViaServer(from, destination);
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
      proxyUrl: DEFAULT_PROXY_URL,
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
      set({ settings });
    },

    navigateTo: async (query) => {
      const results = await get().searchDestination(query);
      if (results === null) return;
      if (results.length === 1 && AUTO_SELECT_SINGLE_RESULT) {
        await routeAndMaybeStart({ lat: results[0]!.lat, lon: results[0]!.lon }, false);
      }
    },

    searchDestination: async (query) => {
      set({ query, status: 'searching', errorMessage: null, candidates: [] });
      const position = get().currentPosition;

      let results: ServerGeocodeResult[];
      try {
        results = await serverGeocode(proxyUrl(), { query, position, limit: 5 });
      } catch (err) {
        const message = isServerError(err) ? err.message : 'Нет сети: не удалось найти адрес.';
        set({ status: 'error', errorMessage: message });
        return null;
      }

      if (results.length === 0) {
        set({ status: 'error', errorMessage: 'Ничего не найдено.', candidates: [] });
      } else if (results.length > 1) {
        set({ status: 'choosing', candidates: results });
      }
      return results;
    },

    chooseDestination: async (candidate) => {
      await routeAndMaybeStart({ lat: candidate.lat, lon: candidate.lon }, false);
    },

    applyServerRoute: (destination, route) => {
      set({ destination, route, status: 'ready', errorMessage: null });
      void glassesApi().showNavState(NavState.READY);
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