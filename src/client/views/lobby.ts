import { LIMITS } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView } from '../../shared/types.js';
import { button, h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { panel } from './common.js';

export interface View {
  el: HTMLElement;
  update(state: GameStateView): void;
}

export function createLobbyView(store: AppStore): View {
  const codeEl = h('span', { class: 'room-code-value', text: '----' });
  const inviteInput = h('input', {
    class: 'input input-invite',
    type: 'text',
    attrs: { readonly: 'readonly', 'aria-label': 'Invitation link' },
  }) as HTMLInputElement;

  const copyStatus = h('span', { class: 'copy-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  const copyButton = button(
    'Copy link',
    async () => {
      try {
        await navigator.clipboard.writeText(inviteInput.value);
        copyStatus.textContent = 'Link copied.';
      } catch {
        inviteInput.select();
        copyStatus.textContent = 'Press Ctrl+C to copy the selected link.';
      }
      window.setTimeout(() => (copyStatus.textContent = ''), 3_000);
    },
    { class: 'btn' },
  );

  const crewList = h('ul', { class: 'crew-list' });
  const stationList = h('div', { class: 'station-editor' });
  const startRow = h('div', { class: 'lobby-actions' });

  const el = h(
    'div',
    { class: 'view view-lobby' },
    panel(
      'Factory gate',
      'Share the code, wait for the crew, then start the shift.',
      h(
        'div',
        { class: 'lobby-grid' },
        h(
          'div',
          { class: 'room-code' },
          h('span', { class: 'room-code-label', text: 'Room code' }),
          codeEl,
        ),
        h(
          'div',
          { class: 'invite' },
          h('span', { class: 'field-label', text: 'Invitation link' }),
          h('div', { class: 'invite-row' }, inviteInput, copyButton),
          copyStatus,
        ),
      ),
      startRow,
    ),
    panel('On shift', 'Everyone who has clocked in.', crewList),
    panel(
      'How a shift runs',
      'Seven phases, roughly an hour.',
      h(
        'ol',
        { class: 'phase-guide' },
        h('li', { text: 'Shift check-in: energy and how the factory feels.' }),
        h('li', { text: 'Build the factory: private Boosters, Bottlenecks and one Wildcard each.' }),
        h('li', { text: 'First run: watch the belts with today\u2019s conditions applied.' }),
        h('li', { text: 'Inspect: four tokens each for the items worth discussing.' }),
        h('li', { text: 'Upgrade shop: ten shared Gear Coins, one or two experiments.' }),
        h('li', { text: 'Improved run: same factory, upgrades fitted.' }),
        h('li', { text: 'Report: owners, review dates and a saveable summary.' }),
      ),
      h('p', {
        class: 'note',
        text: 'Entries stay anonymous in the shared view and in anything the team saves. Names are only used to show who is present.',
      }),
    ),
    panel(
      'Station names',
      'The facilitator can rename stations to match how your team actually works.',
      stationList,
    ),
  );

  function update(state: GameStateView): void {
    codeEl.textContent = state.code;
    const url = new URL(window.location.href);
    url.search = `?room=${state.code}`;
    url.hash = '';
    inviteInput.value = url.toString();

    replace(
      crewList,
      state.players.map((player) =>
        h(
          'li',
          { class: player.connected ? 'crew is-online' : 'crew is-offline' },
          h('span', { class: 'crew-avatar', text: player.avatar || '\u{1F464}' }),
          h('span', { class: 'crew-name', text: player.name }),
          player.isFacilitator ? h('span', { class: 'tag', text: 'Facilitator' }) : null,
          h('span', {
            class: 'crew-status',
            text: player.connected ? 'connected' : 'reconnecting',
          }),
        ),
      ),
    );

    replace(
      startRow,
      state.you.isFacilitator
        ? [
            button('Start factory', () => store.emit(C2S.phaseNext), { class: 'btn btn-primary' }),
            h('span', {
              class: 'note',
              text: `${state.players.length} on shift. Six to eight works best.`,
            }),
          ]
        : [h('p', { class: 'note', text: 'Waiting for the facilitator to start the shift.' })],
    );

    replace(
      stationList,
      state.stations.map((station) => {
        if (!state.you.isFacilitator) {
          return h(
            'div',
            { class: 'station-row' },
            h('span', { class: 'station-emoji', text: station.emoji }),
            h('span', { text: station.name }),
          );
        }
        const input = h('input', {
          class: 'input',
          type: 'text',
          value: station.name,
          maxlength: String(LIMITS.stationName),
          attrs: { 'aria-label': `Rename ${station.name}` },
        }) as HTMLInputElement;
        const commit = (): void => {
          const name = input.value.trim();
          if (!name || name === station.name) return;
          store.emit(C2S.renameStation, { id: station.id, name });
        };
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
        return h(
          'div',
          { class: 'station-row' },
          h('span', { class: 'station-emoji', text: station.emoji }),
          input,
        );
      }),
    );
  }

  return { el, update };
}
