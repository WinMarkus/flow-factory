import { CONDITION_EMOJI, SAVE_PLAYER_NAME, SIMULATION_DISCLAIMER } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView } from '../../shared/types.js';
import { button, h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { emptyState, itemCard, panel, stationName } from './common.js';
import type { View } from './lobby.js';
import { comparisonTable } from './run.js';

export function createReportView(store: AppStore): View {
  const body = h('div', { class: 'report-body' });
  const savePanel = h('div', { class: 'save-panel' });
  const confetti = h('div', { class: 'confetti', attrs: { 'aria-hidden': 'true' } });
  let celebrated = false;
  let saveRequested = false;

  store.onSnapshot(({ filename, json }) => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, attrs: { download: filename || 'flow-factory-retro.json' } });
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });

  const el = h(
    'div',
    { class: 'view view-report' },
    confetti,
    panel('End-of-shift report', 'Everything the shift produced, in one place.', body),
    panel('Save the retro', 'A clean, anonymous JSON snapshot.', savePanel),
  );

  function celebrate(): void {
    if (celebrated) return;
    celebrated = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pieces: HTMLElement[] = [];
    for (let i = 0; i < 24; i += 1) {
      pieces.push(
        h('span', {
          class: 'confetti-piece',
          attrs: { style: `left:${(i * 4.1) % 100}%; animation-delay:${(i % 8) * 0.12}s` },
        }),
      );
    }
    replace(confetti, pieces);
    window.setTimeout(() => replace(confetti, []), 6_000);
  }

  function update(state: GameStateView): void {
    celebrate();

    const items = state.build.items;
    const boosters = items.filter((item) => item.kind === 'booster');
    const bottlenecks = items.filter((item) => item.kind === 'bottleneck');
    const wildcards = items.filter((item) => item.kind === 'wildcard');
    const purchased = state.shop.upgrades.filter((upgrade) => state.shop.purchased.includes(upgrade.id));
    const conditions = Object.entries(state.checkin.conditionCounts);

    const priorities = state.inspect.results
      .slice(0, 5)
      .map((result) => ({ result, item: items.find((candidate) => candidate.id === result.itemId) }))
      .filter((entry) => entry.item);

    replace(body, [
      h('h3', { class: 'sub-head', text: 'Participants' }),
      h('ul', { class: 'crew-list' }, ...state.players.map((player) =>
        h('li', { class: 'crew' },
          h('span', { class: 'crew-avatar', text: player.avatar || '\u{1F464}' }),
          h('span', { class: 'crew-name', text: player.name }),
          player.isFacilitator ? h('span', { class: 'tag', text: 'Facilitator' }) : null,
        ))),

      h('h3', { class: 'sub-head', text: 'Shift check-in' }),
      h('div', { class: 'stat-row' },
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value', text: state.checkin.averageEnergy === null ? '\u2013' : state.checkin.averageEnergy.toFixed(1) }),
          h('span', { class: 'stat-label', text: 'average energy' })),
        h('div', { class: 'stat' },
          h('span', { class: 'stat-value', text: `${state.checkin.submitted}/${state.checkin.total}` }),
          h('span', { class: 'stat-label', text: 'checked in' })),
      ),
      conditions.length > 0
        ? h('ul', { class: 'condition-tallies' }, ...conditions.map(([condition, count]) =>
            h('li', { class: 'condition-tally' },
              h('span', { class: 'condition-emoji', text: CONDITION_EMOJI[condition as keyof typeof CONDITION_EMOJI] ?? '\u2699\uFE0F' }),
              h('span', { text: condition }),
              h('span', { class: 'tag', text: String(count) }))))
        : emptyState('No check-ins were recorded.'),

      h('h3', { class: 'sub-head', text: 'Boosters' }),
      boosters.length > 0 ? h('div', { class: 'item-grid' }, ...boosters.map((item) => itemCard(state, item))) : emptyState('None logged.'),

      h('h3', { class: 'sub-head', text: 'Bottlenecks' }),
      bottlenecks.length > 0 ? h('div', { class: 'item-grid' }, ...bottlenecks.map((item) => itemCard(state, item))) : emptyState('None logged.'),

      h('h3', { class: 'sub-head', text: 'Wildcards' }),
      wildcards.length > 0 ? h('div', { class: 'item-grid' }, ...wildcards.map((item) => itemCard(state, item))) : emptyState('None logged.'),

      h('h3', { class: 'sub-head', text: 'Discussion priorities' }),
      priorities.length > 0
        ? h('ul', { class: 'ranked' }, ...priorities.map(({ result, item }) =>
            h('li', {},
              h('span', { text: item!.title }),
              h('span', { class: 'tag tag-tokens', text: `${result.tokens} tokens \u00B7 ${stationName(state, item!.station)}` }))))
        : emptyState('No inspection tokens were spent.'),

      h('h3', { class: 'sub-head', text: 'Collaborative notes' }),
      state.inspect.notes.length > 0
        ? h('ul', { class: 'notes' }, ...state.inspect.notes.map((note) => {
            const item = items.find((candidate) => candidate.id === note.itemId);
            return h('li', {}, h('strong', { text: item ? `${item.title}: ` : '' }), h('span', { text: note.text }));
          }))
        : emptyState('No notes were written.'),

      h('h3', { class: 'sub-head', text: 'Purchased upgrades' }),
      purchased.length > 0
        ? h('div', { class: 'item-grid' }, ...purchased.map((upgrade) =>
            h('article', { class: 'upgrade is-purchased' },
              h('header', { class: 'upgrade-head' },
                h('h3', { class: 'item-title', text: upgrade.name }),
                h('span', { class: 'coin', text: `${upgrade.cost} \u{1FA99}` })),
              h('dl', { class: 'upgrade-body' },
                h('dt', { text: 'Problem' }), h('dd', { text: upgrade.problem }),
                h('dt', { text: 'Experiment' }), h('dd', { text: upgrade.experiment }),
                h('dt', { text: 'We will notice' }), h('dd', { text: upgrade.signal }),
                h('dt', { text: 'Owner' }), h('dd', { text: upgrade.owner || 'Unassigned' }),
                h('dt', { text: 'Review' }), h('dd', { text: upgrade.reviewDate || 'No date set' }),
                h('dt', { text: 'Station' }), h('dd', { text: stationName(state, upgrade.station) }),
              ))))
        : emptyState('No upgrades were purchased.'),

      h('h3', { class: 'sub-head', text: 'Before and after' }),
      state.runs.first && state.runs.second
        ? comparisonTable(state, state.runs.first.summary, state.runs.second.summary)
        : emptyState('Both runs are needed for the comparison.'),
      h('p', { class: 'stamp', text: SIMULATION_DISCLAIMER }),
    ]);

    renderSave(state);
  }

  function renderSave(state: GameStateView): void {
    if (!state.save.visible) {
      replace(savePanel, [
        h('p', { class: 'note', text: `Saving to GitHub is handled by the team member named ${SAVE_PLAYER_NAME}.` }),
      ]);
      return;
    }

    const { status, message, url } = state.save.state;
    const working = status === 'working';
    if (status !== 'working') saveRequested = false;

    replace(savePanel, [
      state.save.githubConfigured
        ? h('p', { class: 'note', text: 'Commits an anonymous JSON snapshot to the configured repository.' })
        : h('p', { class: 'warning-note', text: 'GitHub saving is not configured on this server. Ask whoever deployed it to set GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO, or download the JSON instead.' }),
      h('div', { class: 'actions' },
        button(working ? 'Saving\u2026' : 'Save retro to GitHub', () => {
          if (saveRequested) return;
          saveRequested = true;
          store.emit(C2S.saveToGitHub);
        }, { class: 'btn btn-primary', disabled: working || saveRequested }),
        button('Download JSON', () => store.emit(C2S.downloadSnapshot), { class: 'btn' }),
      ),
      status === 'working' ? h('p', { class: 'note', text: message }) : null,
      status === 'success'
        ? h('p', { class: 'success-note' },
            h('span', { text: 'Committed to GitHub. ' }),
            url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Open the file' }) : null)
        : null,
      status === 'error' ? h('p', { class: 'warning-note', text: message }) : null,
      h('p', { class: 'note', text: 'This is a convenience permission for a team that already trusts each other, not identity authentication. Anyone who types that name in this room gets the button.' }),
    ]);
  }

  return { el, update };
}
