import { AVATARS, CONDITIONS, CONDITION_EMOJI } from '../../shared/constants.js';
import type { Condition } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView } from '../../shared/types.js';
import { h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { panel } from './common.js';
import type { View } from './lobby.js';

const ENERGY_LABELS: Record<number, string> = {
  1: 'Running on fumes',
  2: 'Low but moving',
  3: 'Steady',
  4: 'Good pressure',
  5: 'Full steam',
};

export function createCheckInView(store: AppStore): View {
  let draft = { avatar: AVATARS[0]!, energy: 3, condition: 'Busy' as Condition };
  let submitted = false;

  const avatarRow = h('div', { class: 'avatar-row', attrs: { role: 'radiogroup', 'aria-label': 'Choose a worker' } });
  const energyRow = h('div', { class: 'energy-row', attrs: { role: 'radiogroup', 'aria-label': 'Energy from 1 to 5' } });
  const conditionRow = h('div', { class: 'condition-row', attrs: { role: 'radiogroup', 'aria-label': 'Factory condition' } });
  const energyHint = h('p', { class: 'note', text: ENERGY_LABELS[3]! });
  const confirmation = h('p', { class: 'note', attrs: { role: 'status', 'aria-live': 'polite' } });
  const teamPanel = h('div', { class: 'team-state' });

  function send(): void {
    store.emit(C2S.submitCheckIn, draft);
  }

  function renderInputs(): void {
    replace(
      avatarRow,
      AVATARS.map((avatar) =>
        h('button', {
          class: draft.avatar === avatar ? 'avatar is-selected' : 'avatar',
          type: 'button',
          text: avatar,
          attrs: { role: 'radio', 'aria-checked': String(draft.avatar === avatar), 'aria-label': `Worker ${avatar}` },
          on: {
            click: () => {
              draft = { ...draft, avatar };
              renderInputs();
              send();
            },
          },
        }),
      ),
    );

    replace(
      energyRow,
      [1, 2, 3, 4, 5].map((level) =>
        h('button', {
          class: draft.energy === level ? 'energy is-selected' : 'energy',
          type: 'button',
          text: String(level),
          attrs: {
            role: 'radio',
            'aria-checked': String(draft.energy === level),
            'aria-label': `${level} - ${ENERGY_LABELS[level]}`,
          },
          on: {
            click: () => {
              draft = { ...draft, energy: level };
              energyHint.textContent = ENERGY_LABELS[level]!;
              renderInputs();
              send();
            },
          },
        }),
      ),
    );

    replace(
      conditionRow,
      CONDITIONS.map((condition) =>
        h('button', {
          class: draft.condition === condition ? 'condition is-selected' : 'condition',
          type: 'button',
          attrs: { role: 'radio', 'aria-checked': String(draft.condition === condition) },
          on: {
            click: () => {
              draft = { ...draft, condition };
              renderInputs();
              send();
            },
          },
        },
        h('span', { class: 'condition-emoji', text: CONDITION_EMOJI[condition] }),
        h('span', { text: condition }),
        ),
      ),
    );
  }

  const el = h(
    'div',
    { class: 'view view-checkin' },
    panel(
      'Shift check-in',
      'Pick a worker, say how much energy you brought, and name the current factory condition.',
      h('h3', { class: 'sub-head', text: 'Your worker' }),
      avatarRow,
      h('h3', { class: 'sub-head', text: 'Energy today' }),
      energyRow,
      energyHint,
      h('h3', { class: 'sub-head', text: 'How does the factory feel right now?' }),
      conditionRow,
      confirmation,
    ),
    panel('Combined team state', 'Nobody is ranked or compared here.', teamPanel),
  );

  function update(state: GameStateView): void {
    if (state.checkin.mine && !submitted) {
      draft = {
        avatar: state.checkin.mine.avatar,
        energy: state.checkin.mine.energy,
        condition: state.checkin.mine.condition,
      };
      energyHint.textContent = ENERGY_LABELS[draft.energy]!;
      submitted = true;
    }
    renderInputs();

    confirmation.textContent = state.checkin.mine
      ? 'Check-in saved. Change it any time before the next phase.'
      : 'Pick an energy level to check in.';

    const { submitted: count, total, averageEnergy, energyCounts, conditionCounts } = state.checkin;
    const bars = [1, 2, 3, 4, 5].map((level) => {
      const value = energyCounts[String(level)] ?? 0;
      const share = count > 0 ? Math.round((value / count) * 100) : 0;
      return h(
        'div',
        { class: 'bar-row' },
        h('span', { class: 'bar-key', text: String(level) }),
        h('div', { class: 'bar' }, h('div', { class: 'bar-fill', attrs: { style: `width:${share}%` } })),
        h('span', { class: 'bar-value', text: String(value) }),
      );
    });

    const conditions = CONDITIONS.filter((condition) => (conditionCounts[condition] ?? 0) > 0).map((condition) =>
      h(
        'li',
        { class: 'condition-tally' },
        h('span', { class: 'condition-emoji', text: CONDITION_EMOJI[condition] }),
        h('span', { text: condition }),
        h('span', { class: 'tag', text: String(conditionCounts[condition]) }),
      ),
    );

    replace(teamPanel, [
      h(
        'div',
        { class: 'stat-row' },
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-value', text: `${count}/${total}` }),
          h('span', { class: 'stat-label', text: 'checked in' }),
        ),
        h(
          'div',
          { class: 'stat' },
          h('span', { class: 'stat-value', text: averageEnergy === null ? '\u2013' : averageEnergy.toFixed(1) }),
          h('span', { class: 'stat-label', text: 'average energy' }),
        ),
      ),
      h('h3', { class: 'sub-head', text: 'Energy spread' }),
      h('div', { class: 'bars' }, ...bars),
      h('h3', { class: 'sub-head', text: 'Factory condition' }),
      conditions.length > 0
        ? h('ul', { class: 'condition-tallies' }, ...conditions)
        : h('p', { class: 'empty', text: 'No check-ins yet.' }),
    ]);
  }

  return { el, update };
}
