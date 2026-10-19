import { NotifyApp } from '../ble/protocol/display';
import { applyDisplayMessage, createInitialScreenState, selectActiveContent } from './screenState';

describe('applyDisplayMessage', () => {
  it('NOTIFY обновляет только слой notify', () => {
    const s0 = createInitialScreenState();
    const s1 = applyDisplayMessage(s0, {
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'код 1234',
    });
    expect(s1.notify).toEqual({
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'код 1234',
    });
    expect(s1.nav).toEqual(s0.nav);
    expect(s1.agent).toEqual(s0.agent);
  });

  it('NAV_MANEUVER и NAV_PROGRESS и NAV_STATE обновляют слой nav независимо', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, {
      type: 'NAV_MANEUVER',
      icon: 3,
      exitNo: 0,
      distM: 100,
      totalM: 500,
      etaMin: 5,
      street: 'ул. Ленина',
    });
    s = applyDisplayMessage(s, { type: 'NAV_PROGRESS', distM: 90, totalM: 490, etaMin: 5 });
    s = applyDisplayMessage(s, { type: 'NAV_STATE', state: 2 });
    expect(s.nav.maneuver?.street).toBe('ул. Ленина');
    expect(s.nav.progress).toEqual({ distM: 90, totalM: 490, etaMin: 5 });
    expect(s.nav.state).toBe(2);
  });

  it('AGENT_STATE, AGENT_TEXT, CONFIRM обновляют слой agent независимо', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'AGENT_STATE', state: 2 });
    s = applyDisplayMessage(s, { type: 'AGENT_TEXT', ttlS: 10, text: 'Думаю' });
    s = applyDisplayMessage(s, { type: 'CONFIRM', id: 1, timeoutS: 5, text: 'Позвонить?' });
    expect(s.agent).toEqual({
      state: 2,
      text: 'Думаю',
      confirm: { id: 1, timeoutS: 5, text: 'Позвонить?' },
    });
  });

  it('CLEAR(ALL) сбрасывает всё, CLEAR(NOTIFY/NAV/AGENT) — только свой слой', () => {
    const build = () => {
      let s = createInitialScreenState();
      s = applyDisplayMessage(s, {
        type: 'NOTIFY',
        app: NotifyApp.SMS,
        prio: 0,
        ttlS: 0,
        title: 't',
        body: 'b',
      });
      s = applyDisplayMessage(s, { type: 'NAV_STATE', state: 2 });
      s = applyDisplayMessage(s, { type: 'AGENT_STATE', state: 1 });
      return s;
    };

    const clearedAll = applyDisplayMessage(build(), { type: 'CLEAR', layer: 0 });
    expect(clearedAll).toEqual(createInitialScreenState());

    const clearedNotify = applyDisplayMessage(build(), { type: 'CLEAR', layer: 1 });
    expect(clearedNotify.notify).toBeNull();
    expect(clearedNotify.nav.state).toBe(2);
    expect(clearedNotify.agent.state).toBe(1);

    const clearedNav = applyDisplayMessage(build(), { type: 'CLEAR', layer: 2 });
    expect(clearedNav.nav.state).toBe(0);
    expect(clearedNav.notify).not.toBeNull();

    const clearedAgent = applyDisplayMessage(build(), { type: 'CLEAR', layer: 3 });
    expect(clearedAgent.agent.state).toBe(0);
    expect(clearedAgent.notify).not.toBeNull();
  });
});

describe('selectActiveContent: приоритеты из docs/PROTOCOL.md §3', () => {
  it('CONFIRM перекрывает абсолютно всё', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'AGENT_TEXT', ttlS: 10, text: 'текст' });
    s = applyDisplayMessage(s, { type: 'CONFIRM', id: 1, timeoutS: 5, text: 'Да?' });
    expect(selectActiveContent(s)).toEqual({ kind: 'confirm', text: 'Да?' });
  });

  it('AGENT_TEXT важнее AGENT_STATE и навигации', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'AGENT_STATE', state: 2 });
    s = applyDisplayMessage(s, { type: 'AGENT_TEXT', ttlS: 10, text: 'Готово' });
    s = applyDisplayMessage(s, {
      type: 'NAV_MANEUVER',
      icon: 1,
      exitNo: 0,
      distM: 10,
      totalM: 100,
      etaMin: 1,
      street: '',
    });
    expect(selectActiveContent(s)).toEqual({ kind: 'agent_text', text: 'Готово' });
  });

  it('близкий манёвр (< 50 м) важнее уведомления с высоким приоритетом', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, {
      type: 'NAV_MANEUVER',
      icon: 3,
      exitNo: 0,
      distM: 30,
      totalM: 100,
      etaMin: 1,
      street: 'ул. А',
    });
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.CALL,
      prio: 1,
      ttlS: 0,
      title: 'Звонок',
      body: 'Мама',
    });
    const result = selectActiveContent(s);
    expect(result.kind).toBe('nav_maneuver');
  });

  it('уведомление с высоким приоритетом важнее дальнего манёвра', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, {
      type: 'NAV_MANEUVER',
      icon: 3,
      exitNo: 0,
      distM: 300,
      totalM: 1000,
      etaMin: 10,
      street: 'ул. А',
    });
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.CALL,
      prio: 1,
      ttlS: 0,
      title: 'Звонок',
      body: 'Мама',
    });
    expect(selectActiveContent(s)).toEqual({
      kind: 'notify',
      notify: { app: NotifyApp.CALL, prio: 1, ttlS: 0, title: 'Звонок', body: 'Мама' },
    });
  });

  it('дальний манёвр важнее прогресса и обычного уведомления', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'NAV_PROGRESS', distM: 300, totalM: 1000, etaMin: 10 });
    s = applyDisplayMessage(s, {
      type: 'NAV_MANEUVER',
      icon: 3,
      exitNo: 0,
      distM: 300,
      totalM: 1000,
      etaMin: 10,
      street: 'ул. А',
    });
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'текст',
    });
    expect(selectActiveContent(s).kind).toBe('nav_maneuver');
  });

  it('без манёвра — прогресс важнее обычного уведомления', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'NAV_PROGRESS', distM: 300, totalM: 1000, etaMin: 10 });
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'текст',
    });
    expect(selectActiveContent(s)).toEqual({
      kind: 'nav_progress',
      progress: { distM: 300, totalM: 1000, etaMin: 10 },
      navState: 0,
    });
  });

  it('без манёвра и прогресса — показываем nav_state, если он не OFF', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, { type: 'NAV_STATE', state: 3 });
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'текст',
    });
    expect(selectActiveContent(s)).toEqual({ kind: 'nav_state', state: 3 });
  });

  it('обычное уведомление показывается, если навигации и агента нет', () => {
    let s = createInitialScreenState();
    s = applyDisplayMessage(s, {
      type: 'NOTIFY',
      app: NotifyApp.SMS,
      prio: 0,
      ttlS: 0,
      title: 'SMS',
      body: 'текст',
    });
    expect(selectActiveContent(s).kind).toBe('notify');
  });

  it('пустой экран -> idle', () => {
    expect(selectActiveContent(createInitialScreenState())).toEqual({ kind: 'idle' });
  });
});
