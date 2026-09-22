import { PHASES, PHASE_HINTS, PHASE_LABELS } from '../shared/constants.js';
import type { Phase } from '../shared/constants.js';
import { C2S } from '../shared/events.js';
import type { GameStateView } from '../shared/types.js';
import { button, clear, h, replace } from './dom.js';
import { AppStore, clearSession, loadSession } from './net.js';
import { createBuildView } from './views/build.js';
import { createCheckInView } from './views/checkin.js';
import { createInspectView } from './views/inspect.js';
import { createJoinView } from './views/join.js';
import { createLobbyView } from './views/lobby.js';
import type { View } from './views/lobby.js';
import { createReportView } from './views/report.js';
import { createRunView } from './views/run.js';
import { createShopView } from './views/shop.js';

/** Reads the room code from ?room=CODE, #CODE or the last path segment. */
function inviteCodeFromUrl(): string {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('room') ?? '';
  const fromHash = url.hash.replace('#', '');
  const segments = url.pathname.split('/').filter(Boolean);
  const fromPath = segments.length > 0 ? segments[segments.length - 1] : '';
  const candidate = fromQuery || fromHash || fromPath;
  return candidate.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function start(): void {
  const rootEl = document.getElementById('app');
  if (!rootEl) throw new Error('Missing #app container.');
  const root = rootEl as HTMLElement;

  const store = new AppStore();
  const toasts = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
  document.body.appendChild(toasts);

  let mode: 'join' | 'room' = 'join';
  let currentPhase: Phase | null = null;
  let currentView: View | null = null;
  let lastState: GameStateView | null = null;

  /* ------------------------------------------------------------- toasts */

  function toast(message: string, tone: 'info' | 'success' | 'warning' | 'error'): void {
    const node = h('div', { class: `toast toast-${tone}`, text: message });
    toasts.appendChild(node);
    window.setTimeout(() => node.classList.add('is-leaving'), 4_200);
    window.setTimeout(() => node.remove(), 5_000);
    while (toasts.childElementCount > 4) toasts.removeChild(toasts.children[0]);
  }

  store.onNotice(({ message, tone }) => toast(message, tone));
  store.onError(({ message }) => toast(message, 'error'));

  /* -------------------------------------------------------- room chrome */

  const factoryNameEl = h('span', { class: 'brand-name', text: 'Flow Factory' });
  const roomCodeEl = h('span', { class: 'brand-code', text: '----' });
  const connectionEl = h('span', { class: 'connection', text: 'Connecting\u2026' });
  const stepper = h('ol', { class: 'stepper', attrs: { 'aria-label': 'Retrospective phases' } });
  const phaseTitle = h('h1', { class: 'phase-title', text: '' });
  const phaseHint = h('p', { class: 'phase-hint', text: '' });
  const crewRail = h('ul', { class: 'crew-rail', attrs: { 'aria-label': 'Crew' } });
  const stage = h('main', { class: 'stage', id: 'stage' });
  const facilitatorBar = h('div', { class: 'facilitator-bar' });

  const header = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'brand' },
      h('span', { class: 'brand-mark', text: '\u{1F3ED}', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'brand-text' }, factoryNameEl, h('span', { class: 'brand-sub' }, h('span', { text: 'Room ' }), roomCodeEl)),
    ),
    stepper,
    connectionEl,
  );

  const roomShell = h(
    'div',
    { class: 'shell' },
    header,
    h(
      'div',
      { class: 'layout' },
      h(
        'div',
        { class: 'column-main' },
        h('div', { class: 'phase-head' }, phaseTitle, phaseHint),
        stage,
        facilitatorBar,
      ),
      h(
        'aside',
        { class: 'column-side' },
        h('h2', { class: 'side-head', text: 'Crew' }),
        crewRail,
        h('p', { class: 'side-note', text: 'Everything you submit stays anonymous in the shared views and in the saved report.' }),
      ),
    ),
  );

  function buildStepper(phase: Phase): void {
    const activeIndex = PHASES.indexOf(phase);
    replace(
      stepper,
      PHASES.map((candidate, index) => {
        const state = index < activeIndex ? 'is-done' : index === activeIndex ? 'is-current' : 'is-upcoming';
        return h(
          'li',
          { class: `step ${state}`, title: PHASE_LABELS[candidate] },
          h('span', { class: 'step-dot', text: String(index + 1), attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'step-label', text: PHASE_LABELS[candidate] }),
        );
      }),
    );
  }

  function createViewFor(phase: Phase): View {
    switch (phase) {
      case 'lobby':
        return createLobbyView(store);
      case 'checkin':
        return createCheckInView(store);
      case 'build':
        return createBuildView(store);
      case 'run1':
        return createRunView(store, 'first');
      case 'inspect':
        return createInspectView(store);
      case 'shop':
        return createShopView(store);
      case 'run2':
        return createRunView(store, 'second');
      case 'report':
        return createReportView(store);
      default:
        return createLobbyView(store);
    }
  }

  function renderFacilitatorBar(state: GameStateView): void {
    if (!state.you.isFacilitator) {
      replace(facilitatorBar, [
        h('span', {
          class: 'note',
          text: `${facilitatorName(state)} is facilitating and moves the shift forward.`,
        }),
      ]);
      return;
    }

    const index = PHASES.indexOf(state.phase);
    const isLast = index === PHASES.length - 1;
    const nextPhase = isLast ? null : PHASES[index + 1];

    replace(facilitatorBar, [
      h('span', { class: 'facilitator-tag', text: '\u{1F9ED} Facilitator controls' }),
      button(
        'Back a phase',
        () => store.emit(C2S.phaseBack),
        { class: 'btn btn-quiet', disabled: index <= 0, title: 'Return to the previous phase' },
      ),
      nextPhase
        ? button(
            state.phase === 'lobby' ? 'Start factory' : `Next: ${PHASE_LABELS[nextPhase]}`,
            () => {
              if (state.phase === 'lobby' || window.confirm(`Move the whole crew on to "${PHASE_LABELS[nextPhase]}"?`)) {
                store.emit(C2S.phaseNext);
              }
            },
            { class: 'btn btn-primary' },
          )
        : h('span', { class: 'note', text: 'This is the final phase.' }),
      button(
        'Reset factory',
        () => {
          if (window.confirm('Reset the factory? Every submission, vote, note and upgrade in this room is erased. This cannot be undone.')) {
            store.emit(C2S.resetRoom);
          }
        },
        { class: 'btn btn-danger' },
      ),
      button(
        'Leave room',
        () => {
          if (window.confirm('Leave this factory? Your session on this device is cleared.')) {
            store.emit(C2S.leaveRoom);
            clearSession();
            window.setTimeout(() => window.location.replace(window.location.pathname), 200);
          }
        },
        { class: 'btn btn-quiet' },
      ),
    ]);
  }

  function facilitatorName(state: GameStateView): string {
    const facilitator = state.players.find((player) => player.isFacilitator);
    return facilitator ? facilitator.name : 'The facilitator';
  }

  function renderCrew(state: GameStateView): void {
    replace(
      crewRail,
      state.players.map((player) => {
        const readyNow =
          state.phase === 'checkin'
            ? player.checkedIn
            : state.phase === 'build'
              ? player.readyBuild
              : state.phase === 'inspect'
                ? player.readyInspect
                : state.phase === 'shop'
                  ? player.readyShop
                  : false;

        return h(
          'li',
          { class: `crew-chip ${player.connected ? 'is-online' : 'is-offline'}` },
          h('span', { class: 'crew-avatar', text: player.avatar || '\u{1F464}', attrs: { 'aria-hidden': 'true' } }),
          h(
            'span',
            { class: 'crew-meta' },
            h('span', { class: 'crew-name', text: player.name + (player.id === state.you.id ? ' (you)' : '') }),
            h('span', {
              class: 'crew-status',
              text: !player.connected
                ? 'Reconnecting\u2026'
                : player.isFacilitator
                  ? 'Facilitator'
                  : readyNow
                    ? 'Ready'
                    : 'On shift',
            }),
          ),
          readyNow ? h('span', { class: 'crew-ready', text: '\u2713', attrs: { 'aria-label': 'Ready' } }) : null,
        );
      }),
    );
  }

  function showRoom(state: GameStateView): void {
    if (mode !== 'room') {
      mode = 'room';
      replace(root, [roomShell]);
    }

    factoryNameEl.textContent = state.factoryName;
    roomCodeEl.textContent = state.code;
    document.title = `${state.factoryName} \u00B7 Flow Factory`;

    phaseTitle.textContent = PHASE_LABELS[state.phase];
    phaseHint.textContent = PHASE_HINTS[state.phase];
    buildStepper(state.phase);
    renderCrew(state);
    renderFacilitatorBar(state);

    if (state.phase !== currentPhase || !currentView) {
      currentPhase = state.phase;
      currentView = createViewFor(state.phase);
      replace(stage, [currentView.el]);
      stage.scrollTop = 0;
    }
    currentView.update(state);
  }

  function showJoin(): void {
    mode = 'join';
    currentPhase = null;
    currentView = null;
    document.title = 'Flow Factory';
    clear(root);
    root.appendChild(createJoinView(store, inviteCodeFromUrl()));
  }

  /* ----------------------------------------------------------- wiring */

  store.onConnection((connection) => {
    connectionEl.textContent =
      connection === 'online' ? '\u{1F7E2} Connected' : connection === 'offline' ? '\u{1F534} Reconnecting\u2026' : '\u{1F7E1} Connecting\u2026';
    connectionEl.className = `connection is-${connection}`;
    if (connection === 'offline') toast('Connection lost. Trying to reconnect\u2026', 'warning');
    if (connection === 'online' && lastState) toast('Back on the factory floor.', 'success');
  });

  store.onJoined((payload) => {
    const url = new URL(window.location.href);
    url.search = `?room=${payload.roomCode}`;
    url.hash = '';
    window.history.replaceState({}, '', url.toString());
  });

  store.onState((state) => {
    lastState = state;
    showRoom(state);
  });

  store.onError(({ code }) => {
    if (code === 'room-not-found' || code === 'session-expired') {
      clearSession();
      if (mode === 'room') showJoin();
    }
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    const state = lastState;
    if (!state || !state.you.isFacilitator) return;
    if (state.phase !== 'run1' && state.phase !== 'run2') return;
    event.preventDefault();
    const action = state.playback.playing ? 'pause' : state.playback.finished ? 'restart' : 'play';
    store.emit(C2S.playback, { action });
  });

  showJoin();

  const session = loadSession();
  if (session) {
    // The store re-sends the reconnect on connect; this only softens the wait.
    const waiting = h('p', { class: 'join-status', text: `Reconnecting to factory ${session.roomCode}\u2026` });
    root.appendChild(waiting);
    window.setTimeout(() => waiting.remove(), 4_000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
