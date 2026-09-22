import { DEFAULT_DISCUSSION_SECONDS, INSPECTION_TOKENS, LIMITS, TIMER_EXTENSION_SECONDS } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView, PublicSubmission } from '../../shared/types.js';
import { button, formatClock, h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { emptyState, impactDots, itemCard, panel, stationName } from './common.js';
import type { View } from './lobby.js';

export function createInspectView(store: AppStore): View {
  let allocations: Record<string, number> = {};
  let hydrated = false;
  let latest: GameStateView | null = null;
  const mergeSelection = new Set<string>();

  const tokensLeft = h('span', { class: 'tokens-left' });
  const votingGrid = h('div', { class: 'vote-grid' });
  const votingActions = h('div', { class: 'actions' });
  const resultsList = h('div', { class: 'results' });
  const discussion = h('div', { class: 'discussion' });
  const mergeBox = h('div', { class: 'merge-box' });

  const noteInput = h('textarea', {
    class: 'input textarea',
    rows: '2',
    maxlength: String(LIMITS.note),
    placeholder: 'What did the team notice, decide or want to remember?',
    attrs: { 'aria-label': 'Collaborative note' },
  }) as HTMLTextAreaElement;

  const addNoteButton = button(
    'Add note',
    () => {
      const text = noteInput.value.trim();
      if (!text || !latest?.inspect.focusItemId) return;
      store.emit(C2S.addNote, { itemId: latest.inspect.focusItemId, text });
      noteInput.value = '';
    },
    { class: 'btn' },
  );

  const el = h(
    'div',
    { class: 'view view-inspect' },
    panel(
      'Inspect the machinery',
      `Spend your ${INSPECTION_TOKENS} inspection tokens on the items that deserve discussion. Allocations stay private until the reveal.`,
      tokensLeft,
      votingGrid,
      votingActions,
    ),
    panel('Discussion order', 'Highest inspection totals first.', resultsList),
    panel('On the workbench', 'One item at a time, with a timer and shared notes.', discussion, mergeBox),
  );

  function usedTokens(): number {
    return Object.values(allocations).reduce((sum, value) => sum + value, 0);
  }

  function setAllocation(itemId: string, value: number): void {
    const next = Math.max(0, value);
    const others = usedTokens() - (allocations[itemId] ?? 0);
    if (others + next > INSPECTION_TOKENS) return;
    if (next === 0) delete allocations[itemId];
    else allocations[itemId] = next;
    store.emit(C2S.allocate, { allocations });
    if (latest) update(latest);
  }

  function renderVoting(state: GameStateView): void {
    const items = state.build.items.filter((item) => item.kind !== 'wildcard');
    tokensLeft.textContent = `${INSPECTION_TOKENS - usedTokens()} of ${INSPECTION_TOKENS} tokens left`;

    if (state.inspect.closed) {
      replace(votingGrid, [emptyState('Voting is closed. The totals are below.')]);
      replace(votingActions, []);
      return;
    }

    replace(
      votingGrid,
      items.length === 0
        ? [emptyState('Nothing to inspect - no Boosters or Bottlenecks were logged.')]
        : items.map((item) => {
            const value = allocations[item.id] ?? 0;
            return h(
              'article',
              { class: `vote-card item-${item.kind}` },
              h(
                'header',
                { class: 'item-head' },
                h('span', { class: 'item-kind', text: item.kind === 'booster' ? '\u2699\uFE0F Booster' : '\u{1F6A7} Bottleneck' }),
                impactDots(item.impact),
              ),
              h('h3', { class: 'item-title', text: item.title }),
              item.description ? h('p', { class: 'item-desc', text: item.description }) : null,
              h('p', { class: 'item-station', text: stationName(state, item.station) }),
              h(
                'div',
                { class: 'token-controls' },
                button('\u2212', () => setAllocation(item.id, value - 1), {
                  class: 'btn btn-round',
                  disabled: value === 0,
                  title: `Remove a token from ${item.title}`,
                }),
                h('span', { class: 'token-value', text: String(value), attrs: { 'aria-live': 'polite' } }),
                button('+', () => setAllocation(item.id, value + 1), {
                  class: 'btn btn-round',
                  disabled: usedTokens() >= INSPECTION_TOKENS,
                  title: `Add a token to ${item.title}`,
                }),
              ),
            );
          }),
    );

    const me = state.players.find((player) => player.id === state.you.id);
    replace(votingActions, [
      button(me?.readyInspect ? 'Change my allocation' : 'I\u2019m done allocating', () => {
        store.emit(C2S.readyInspect, { ready: !me?.readyInspect });
      }, { class: 'btn btn-primary' }),
      h('span', {
        class: 'note',
        text: `${state.players.filter((player) => player.readyInspect).length} of ${state.players.length} done.`,
      }),
      state.you.isFacilitator
        ? button('Close voting now', () => store.emit(C2S.closeVoting), { class: 'btn' })
        : null,
    ]);
  }

  function renderResults(state: GameStateView): void {
    if (!state.inspect.closed) {
      replace(resultsList, [emptyState('Totals appear once everyone is done or the facilitator closes voting.')]);
      return;
    }

    const byId = new Map(state.build.items.map((item) => [item.id, item]));
    const ranked = state.inspect.results
      .map((result) => ({ result, item: byId.get(result.itemId) }))
      .filter((entry): entry is { result: typeof entry.result; item: PublicSubmission } => Boolean(entry.item));

    replace(
      resultsList,
      ranked.length === 0
        ? [emptyState('No items were logged.')]
        : ranked.map(({ result, item }, index) =>
            h(
              'div',
              { class: state.inspect.focusItemId === item.id ? 'result is-focus' : 'result' },
              h('span', { class: 'result-rank', text: String(index + 1) }),
              h(
                'div',
                { class: 'result-body' },
                h('h3', { class: 'item-title', text: item.title }),
                h('p', { class: 'item-station', text: `${stationName(state, item.station)} \u00B7 impact ${item.impact} of 3` }),
              ),
              h('span', { class: 'tag tag-tokens', text: `${result.tokens} \u{1F50E}` }),
              state.you.isFacilitator
                ? button('Discuss', () => store.emit(C2S.focusItem, { itemId: item.id, durationSeconds: DEFAULT_DISCUSSION_SECONDS }), {
                    class: 'btn btn-small',
                  })
                : null,
              state.you.isFacilitator
                ? h('label', { class: 'merge-pick' },
                    h('input', {
                      type: 'checkbox',
                      checked: mergeSelection.has(item.id),
                      attrs: { 'aria-label': `Select ${item.title} for merging` },
                      on: {
                        change: (event: Event) => {
                          const checked = (event.target as HTMLInputElement).checked;
                          if (checked) mergeSelection.add(item.id);
                          else mergeSelection.delete(item.id);
                          if (latest) renderMerge(latest);
                        },
                      },
                    }),
                    h('span', { text: 'merge' }),
                  )
                : null,
            ),
          ),
    );
  }

  function renderMerge(state: GameStateView): void {
    if (!state.you.isFacilitator || !state.inspect.closed) {
      replace(mergeBox, []);
      return;
    }
    const picked = state.build.items.filter((item) => mergeSelection.has(item.id));
    replace(mergeBox, [
      h('h3', { class: 'sub-head', text: 'Merge duplicates' }),
      h('p', {
        class: 'note',
        text: 'Tick two or more similar items above. The first one keeps its title; every original text is preserved inside it.',
      }),
      picked.length >= 2
        ? h(
            'div',
            { class: 'actions' },
            h('span', { class: 'note', text: picked.map((item) => item.title).join('  +  ') }),
            button('Merge into the first', () => {
              const [target, ...sources] = picked;
              if (!target) return;
              store.emit(C2S.mergeItems, { targetId: target.id, sourceIds: sources.map((item) => item.id) });
              mergeSelection.clear();
            }, { class: 'btn' }),
          )
        : h('p', { class: 'note', text: 'Select at least two items to merge.' }),
    ]);
  }

  function renderDiscussion(state: GameStateView): void {
    const focus = state.build.items.find((item) => item.id === state.inspect.focusItemId);
    if (!focus) {
      replace(discussion, [
        emptyState(
          state.you.isFacilitator
            ? 'Pick an item above to put it on the workbench.'
            : 'The facilitator will put an item on the workbench.',
        ),
      ]);
      return;
    }

    const tokens = state.inspect.results.find((result) => result.itemId === focus.id)?.tokens ?? 0;
    const notes = state.inspect.notes.filter((note) => note.itemId === focus.id);
    const timer = state.inspect.timer;
    const remaining = timer.running && timer.endsAt
      ? Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000))
      : timer.remainingSeconds;

    replace(discussion, [
      itemCard(state, focus, [h('span', { class: 'tag tag-tokens', text: `${tokens} inspection tokens` })]),
      h(
        'div',
        { class: 'timer-box' },
        h('span', { class: remaining <= 15 && timer.running ? 'timer is-low' : 'timer', text: formatClock(remaining), attrs: { role: 'timer', 'aria-live': 'off' } }),
        state.you.isFacilitator
          ? h(
              'div',
              { class: 'actions' },
              timer.running
                ? button('Pause', () => store.emit(C2S.timerControl, { action: 'pause' }), { class: 'btn btn-small' })
                : button(timer.remainingSeconds > 0 && timer.remainingSeconds < timer.durationSeconds ? 'Resume' : 'Start', () =>
                    store.emit(C2S.timerControl, {
                      action: timer.remainingSeconds > 0 && timer.remainingSeconds < timer.durationSeconds ? 'resume' : 'start',
                      durationSeconds: timer.durationSeconds,
                    }), { class: 'btn btn-small' }),
              button(`+${TIMER_EXTENSION_SECONDS / 60} min`, () => store.emit(C2S.timerControl, { action: 'extend', seconds: TIMER_EXTENSION_SECONDS }), {
                class: 'btn btn-small',
              }),
              button('Reset', () => store.emit(C2S.timerControl, { action: 'reset' }), { class: 'btn btn-small' }),
              durationPicker(state),
            )
          : h('span', { class: 'note', text: timer.running ? 'Discussion running.' : 'Timer paused.' }),
      ),
      h('h3', { class: 'sub-head', text: 'Collaborative notes' }),
      notes.length > 0
        ? h('ul', { class: 'notes' }, ...notes.map((note) => h('li', { text: note.text })))
        : emptyState('No notes yet. Anything written here lands in the report.'),
      h('div', { class: 'note-form' }, noteInput, addNoteButton),
    ]);
  }

  function durationPicker(state: GameStateView): HTMLElement {
    const select = h('select', { class: 'input input-small', attrs: { 'aria-label': 'Discussion length' } }) as HTMLSelectElement;
    for (const minutes of [2, 3, 5, 8]) {
      select.appendChild(h('option', { value: String(minutes * 60), text: `${minutes} min` }));
    }
    select.value = String(state.inspect.timer.durationSeconds);
    select.addEventListener('change', () => {
      store.emit(C2S.timerControl, { action: 'start', durationSeconds: Number(select.value) });
    });
    return select;
  }

  let ticker = 0;
  function update(state: GameStateView): void {
    latest = state;
    if (!hydrated) {
      allocations = { ...state.inspect.myAllocations };
      hydrated = true;
    }
    renderVoting(state);
    renderResults(state);
    renderDiscussion(state);
    renderMerge(state);

    window.clearInterval(ticker);
    if (state.inspect.timer.running) {
      ticker = window.setInterval(() => {
        if (latest) renderDiscussion(latest);
      }, 1_000);
    }
  }

  return { el, update };
}
