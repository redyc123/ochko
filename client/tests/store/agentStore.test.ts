import { ManeuverIcon } from '@/nav/maneuverMap';
import type { Route } from '@/nav/types';
import { agentTurn, ServerError, type ServerAgentResult } from '@/server/api';
import { useAgentStore } from '@/store/agentStore';
import { useDeviceStore } from '@/store/deviceStore';
import { useNavStore } from '@/store/navStore';

jest.mock('@/server/api', () => ({
  ...jest.requireActual('@/server/api'),
  agentTurn: jest.fn(),
}));

const mockedAgentTurn = agentTurn as jest.MockedFunction<typeof agentTurn>;

const ROUTE: Route = {
  shape: [
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.002 },
  ],
  maneuvers: [
    {
      type: ManeuverIcon.START,
      streetNames: ['Тверская улица'],
      distanceMeters: 200,
      durationSeconds: 180,
      beginShapeIndex: 0,
      endShapeIndex: 1,
    },
  ],
  distanceMeters: 200,
  durationSeconds: 180,
  profile: 'pedestrian',
};

function reply(actions: ServerAgentResult['reply']['actions'] = []): ServerAgentResult {
  return {
    session_id: 'session-1',
    reply: { display: 'Готово', full: 'Готово', candidates: [], actions },
  };
}

const START_ROUTE: ServerAgentResult['reply']['actions'][number] = {
  type: 'start_route',
  destination: {
    displayName: 'Театр, Москва',
    lat: 0,
    lon: 0.002,
    type: 'theatre',
    importance: 0.8,
  },
  route: ROUTE,
};

beforeEach(() => {
  mockedAgentTurn.mockReset();
  useDeviceStore.setState({ mode: 'emulator' });
  useNavStore.setState({
    status: 'idle',
    query: '',
    candidates: [],
    destination: null,
    destinationName: null,
    route: null,
    errorMessage: null,
    currentPosition: { lat: 0, lon: 0 },
    lastFixAtMs: null,
    gpsOk: true,
    simulationEnabled: false,
    simulator: null,
  });
  useAgentStore.getState().resetDialog();
});

describe('agentStore: контекст и результаты действий', () => {
  it('передаёт подробный маршрут и результат start_route со следующим запросом', async () => {
    mockedAgentTurn.mockResolvedValueOnce(reply([START_ROUTE])).mockResolvedValueOnce(reply());

    await useAgentStore.getState().ask('отведи в театр');
    await useAgentStore.getState().ask('сколько осталось');

    const secondContext = mockedAgentTurn.mock.calls[1]![1].context;
    expect(secondContext.action_results).toEqual([{ type: 'start_route', status: 'applied' }]);
    expect(secondContext.nav_status).toMatchObject({
      status: 'ready',
      destinationName: 'Театр, Москва',
      remainingDistanceMeters: 200,
      remainingDurationSeconds: 180,
      routeProfile: 'pedestrian',
      gpsOk: true,
    });
    expect(mockedAgentTurn).toHaveBeenCalledTimes(2);
  });

  it('не теряет результат действия после сетевой ошибки', async () => {
    mockedAgentTurn
      .mockResolvedValueOnce(reply([START_ROUTE]))
      .mockRejectedValueOnce(new ServerError('Нет сети', 0))
      .mockResolvedValueOnce(reply());

    await useAgentStore.getState().ask('отведи в театр');
    await useAgentStore.getState().ask('повтори');
    await useAgentStore.getState().ask('ещё раз');

    expect(mockedAgentTurn.mock.calls[2]![1].context.action_results).toEqual([
      { type: 'start_route', status: 'applied' },
    ]);
  });
});
