import { LIMITS, MAX_BOOSTERS, MAX_BOTTLENECKS, MAX_WILDCARDS } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView, SubmissionKind } from '../../shared/types.js';
import { button, h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { KIND_EMOJI, KIND_LABEL, panel, stationSelect } from './common.js';
import type { View } from './lobby.js';

interface Slot {
  kind: SubmissionKind;
  id: string;
  title: HTMLInputElement;
  description: HTMLTextAreaElement;
  station: HTMLSelectElement;
  impact: HTMLInputElement;
  impactLabel: HTMLElement;
  root: HTMLElement;
}

const SLOT_HINTS: Record<SubmissionKind, string> = {
  booster: 'A practice or condition that helped work flow this period.',
  bottleneck: 'Something that delayed or obstructed the flow of work.',
  wildcard: 'An interruption, surprise or unusual event that changed the shift.',
};

export function createBuildView(store: AppStore): View {
  const slots: Slot[] = [];
  let currentState: GameStateView | null = null;
  let hydrated = false;
  let saveTimer = 0;
  const savedNote = h('span', { class: 'save-note', attrs: { role: 'status', 'aria-live': 'polite' } });

  function collect(): Array<Record<string, unknown>> {
    return slots
      .filter((slot) => slot.title.value.trim().length > 0)
      .map((slot) => ({
        id: slot.id,
        kind: slot.kind,
        title: slot.title.value,
        description: slot.description.value,
        station: slot.station.value,
        impact: Number(slot.impact.value),
      }));
  }

  function queueSave(): void {
    savedNote.textContent = 'Saving\u2026';
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.emit(C2S.saveSubmissions, { items: collect() });
      savedNote.textContent = 'Saved privately.';
    }, 500);
  }

  function makeSlot(kind: SubmissionKind, index: number): Slot {
    const title = h('input', {
      class: 'input',
      type: 'text',
      maxlength: String(LIMITS.title),
      placeholder:
        kind === 'booster'
          ? 'Pairing on the tricky tickets'
          : kind === 'bottleneck'
            ? 'Reviews waited two days'
            : 'Production incident on Wednesday',
      attrs: { 'aria-label': `${KIND_LABEL[kind]} ${index + 1} title` },
    }) as HTMLInputElement;

    const description = h('textarea', {
      class: 'input textarea',
      rows: '2',
      maxlength: String(LIMITS.description),
      placeholder: 'Optional detail',
      attrs: { 'aria-label': `${KIND_LABEL[kind]} ${index + 1} description` },
    }) as HTMLTextAreaElement;

    const station = h('select', { class: 'input' }) as HTMLSelectElement;

    const impact = h('input', {
      class: 'slider',
      type: 'range',
      min: '1',
      max: '3',
      step: '1',
      value: '2',
      attrs: { 'aria-label': `${KIND_LABEL[kind]} ${index + 1} perceived impact` },
    }) as HTMLInputElement;

    const impactLabel = h('span', { class: 'impact-label', text: 'Impact 2 of 3' });

    for (const control of [title, description, station]) {
      control.addEventListener('input', queueSave);
      control.addEventListener('change', queueSave);
    }
    impact.addEventListener('input', () => {
      impactLabel.textContent = `Impact ${impact.value} of 3`;
      queueSave();
    });

    const root = h(
      'article',
      { class: `slot slot-${kind}` },
      h(
        'header',
        { class: 'slot-head' },
        h('span', { class: 'slot-kind', text: `${KIND_EMOJI[kind]} ${KIND_LABEL[kind]} ${index + 1}` }),
      ),
      h('p', { class: 'slot-hint', text: SLOT_HINTS[kind] }),
      title,
      description,
      h(
        'div',
        { class: 'slot-meta' },
        h('label', { class: 'inline-field' }, h('span', { text: 'Station' }), station),
        h('label', { class: 'inline-field' }, h('span', { text: 'Impact' }), impact, impactLabel),
      ),
    );

    return { kind, id: '', title, description, station, impact, impactLabel, root };
  }

  const slotGrid = h('div', { class: 'slot-grid' });
  for (let i = 0; i < MAX_BOOSTERS; i += 1) slots.push(makeSlot('booster', i));
  for (let i = 0; i < MAX_BOTTLENECKS; i += 1) slots.push(makeSlot('bottleneck', i));
  for (let i = 0; i < MAX_WILDCARDS; i += 1) slots.push(makeSlot('wildcard', i));
  replace(slotGrid, slots.map((slot) => slot.root));

  const readyButton = button('I\u2019m ready', () => {
    const state = currentState;
    if (!state) return;
    const iAmReady = state.players.find((player) => player.id === state.you.id)?.readyBuild ?? false;
    if (iAmReady) {
      store.emit(C2S.unreadyBuild);
    } else {
      window.clearTimeout(saveTimer);
      store.emit(C2S.saveSubmissions, { items: collect() });
      store.emit(C2S.readyBuild);
    }
  }, { class: 'btn btn-primary' });

  const readinessList = h('ul', { class: 'readiness' });

  const el = h(
    'div',
    { class: 'view view-build' },
    panel(
      'Build the current factory',
      'Up to two Boosters, two Bottlenecks and one Wildcard. Only you can see these until the reveal.',
      slotGrid,
      h('div', { class: 'actions' }, readyButton, savedNote),
    ),
    panel('Readiness', 'Who has finished writing. The content stays hidden.', readinessList),
  );

  function hydrate(state: GameStateView): void {
    const byKind: Record<SubmissionKind, typeof state.build.mine> = {
      booster: state.build.mine.filter((item) => item.kind === 'booster'),
      bottleneck: state.build.mine.filter((item) => item.kind === 'bottleneck'),
      wildcard: state.build.mine.filter((item) => item.kind === 'wildcard'),
    };
    const used: Record<SubmissionKind, number> = { booster: 0, bottleneck: 0, wildcard: 0 };

    for (const slot of slots) {
      const item = byKind[slot.kind][used[slot.kind]];
      used[slot.kind] += 1;
      if (!item) continue;
      slot.id = item.id;
      slot.title.value = item.title;
      slot.description.value = item.description;
      slot.station.value = item.station;
      slot.impact.value = String(item.impact);
      slot.impactLabel.textContent = `Impact ${item.impact} of 3`;
    }
  }

  function update(state: GameStateView): void {
    currentState = state;

    for (const slot of slots) {
      const selected = slot.station.value;
      replace(slot.station, []);
      const fresh = stationSelect(state, selected || 'all');
      while (fresh.firstChild) slot.station.appendChild(fresh.firstChild);
      slot.station.value = selected || 'all';
    }

    if (!hydrated) {
      hydrate(state);
      hydrated = true;
    }

    const me = state.players.find((player) => player.id === state.you.id);
    const locked = me?.readyBuild ?? false;
    for (const slot of slots) {
      slot.title.disabled = locked;
      slot.description.disabled = locked;
      slot.station.disabled = locked;
      slot.impact.disabled = locked;
      slot.root.classList.toggle('is-locked', locked);
    }
    readyButton.textContent = locked ? 'Unlock my entries' : 'I\u2019m ready';
    if (locked) savedNote.textContent = 'Locked in. Unlock to keep editing.';

    replace(
      readinessList,
      state.players.map((player) =>
        h(
          'li',
          { class: player.readyBuild ? 'ready is-ready' : 'ready' },
          h('span', { class: 'crew-avatar', text: player.avatar || '\u{1F464}' }),
          h('span', { text: player.name }),
          h('span', { class: 'tag', text: player.readyBuild ? 'Ready' : 'Writing' }),
        ),
      ),
    );
  }

  return { el, update };
}
