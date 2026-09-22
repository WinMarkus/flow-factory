import { SIMULATION_DISCLAIMER } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView, SimSummary } from '../../shared/types.js';
import { button, h, replace } from '../dom.js';
import { createFactoryFloor } from '../factory.js';
import type { AppStore } from '../net.js';
import { disclaimer, emptyState, panel, stationName } from './common.js';
import type { View } from './lobby.js';

export function createRunView(store: AppStore, which: 'first' | 'second'): View {
  const floor = createFactoryFloor();
  const controls = h('div', { class: 'actions' });
  const summaryPanel = h('div', { class: 'summary' });
  const comparePanel = h('div', { class: 'compare' });
  let latest: GameStateView | null = null;

  const el = h(
    'div',
    { class: 'view view-run' },
    panel(
      which === 'first' ? 'First factory run' : 'Improved factory run',
      which === 'first'
        ? 'Boosters, Bottlenecks and Wildcards are applied to the belts.'
        : 'Same inputs, same rules - now with the purchased upgrades fitted.',
      controls,
      floor.el,
      h('p', { class: 'stamp', text: SIMULATION_DISCLAIMER }),
    ),
    which === 'second' ? panel('Before and after', 'The same factory, run twice.', comparePanel) : null,
    panel('Run summary', 'What the belts showed.', summaryPanel),
  );

  store.onTick(() => {
    if (latest) draw(latest);
  });

  function draw(state: GameStateView): void {
    const run = which === 'first' ? state.runs.first : state.runs.second;
    const tick = Math.min(store.playbackTick, run ? run.frames.length : 0);
    const frame = run ? (run.frames[Math.max(0, tick - 1)] ?? null) : null;
    floor.render(state, frame, run);
  }

  function summaryView(state: GameStateView, summary: SimSummary): HTMLElement[] {
    return [
      h(
        'div',
        { class: 'stat-row' },
        stat(String(summary.throughput), 'items shipped'),
        stat(`${summary.largestQueue.value}`, `largest queue (${stationName(state, summary.largestQueue.station)})`),
        stat(summary.averageWaitIndex.toFixed(1), 'average waiting indicator'),
        stat(String(summary.warningLights), 'warning lights lit'),
      ),
      h(
        'div',
        { class: 'two-col' },
        h(
          'div',
          {},
          h('h3', { class: 'sub-head', text: 'Strongest Boosters' }),
          summary.topBoosters.length > 0
            ? h(
                'ul',
                { class: 'ranked' },
                ...summary.topBoosters.map((item) =>
                  h(
                    'li',
                    {},
                    h('span', { text: item.title }),
                    h('span', { class: 'tag tag-good', text: `+${item.effectPercent}% at ${stationName(state, item.station)}` }),
                  ),
                ),
              )
            : emptyState('No Boosters were logged.'),
        ),
        h(
          'div',
          {},
          h('h3', { class: 'sub-head', text: 'Most influential Bottlenecks' }),
          summary.topBottlenecks.length > 0
            ? h(
                'ul',
                { class: 'ranked' },
                ...summary.topBottlenecks.map((item) =>
                  h(
                    'li',
                    {},
                    h('span', { text: item.title }),
                    h('span', { class: 'tag tag-bad', text: `-${item.effectPercent}% at ${stationName(state, item.station)}` }),
                  ),
                ),
              )
            : emptyState('No Bottlenecks were logged.'),
        ),
      ),
      disclaimer(),
    ];
  }

  function stat(value: string, label: string): HTMLElement {
    return h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat-value', text: value }),
      h('span', { class: 'stat-label', text: label }),
    );
  }

  function update(state: GameStateView): void {
    latest = state;
    draw(state);

    const run = which === 'first' ? state.runs.first : state.runs.second;
    const finished = state.playback.finished;

    replace(
      controls,
      state.you.isFacilitator
        ? [
            state.playback.playing
              ? button('Pause', () => store.emit(C2S.playback, { action: 'pause' }), { class: 'btn' })
              : button(finished ? 'Replay' : 'Resume', () => store.emit(C2S.playback, { action: finished ? 'restart' : 'play' }), {
                  class: 'btn',
                }),
            button('Skip to end', () => store.emit(C2S.playback, { action: 'skip' }), { class: 'btn' }),
            h('span', { class: 'note', text: 'Space pauses and resumes the run.' }),
          ]
        : [
            h('span', {
              class: 'note',
              text: state.playback.playing ? 'The run is playing.' : finished ? 'The run has finished.' : 'The run is paused.',
            }),
          ],
    );

    if (run && finished) {
      replace(summaryPanel, summaryView(state, run.summary));
    } else if (run) {
      replace(summaryPanel, [emptyState('The summary appears when the run finishes.')]);
    } else {
      replace(summaryPanel, [emptyState('No run has been computed yet.')]);
    }

    if (which === 'second') {
      const before = state.runs.first?.summary;
      const after = state.runs.second?.summary;
      if (before && after) {
        const purchased = state.shop.upgrades.filter((upgrade) => state.shop.purchased.includes(upgrade.id));
        replace(comparePanel, [
          comparisonTable(state, before, after),
          h('h3', { class: 'sub-head', text: 'Purchased upgrades' }),
          purchased.length > 0
            ? h(
                'ul',
                { class: 'ranked' },
                ...purchased.map((upgrade) =>
                  h(
                    'li',
                    {},
                    h('span', { text: upgrade.name }),
                    h('span', { class: 'tag', text: `${upgrade.cost} coins \u00B7 ${stationName(state, upgrade.station)}` }),
                  ),
                ),
              )
            : emptyState('No upgrades were purchased, so both runs are identical.'),
          h('p', { class: 'stamp', text: SIMULATION_DISCLAIMER }),
          h('p', {
            class: 'note',
            text: 'The point is to make the chosen experiments tangible. The numbers do not promise an improvement in real delivery.',
          }),
        ]);
      } else {
        replace(comparePanel, [emptyState('Run the first factory to unlock the comparison.')]);
      }
    }
  }

  return { el, update };
}

export function comparisonTable(state: GameStateView, before: SimSummary, after: SimSummary): HTMLElement {
  const rows: Array<[string, string, string, number]> = [
    ['Symbolic throughput', String(before.throughput), String(after.throughput), after.throughput - before.throughput],
    [
      'Largest queue',
      `${before.largestQueue.value} (${stationName(state, before.largestQueue.station)})`,
      `${after.largestQueue.value} (${stationName(state, after.largestQueue.station)})`,
      before.largestQueue.value - after.largestQueue.value,
    ],
    [
      'Average waiting indicator',
      before.averageWaitIndex.toFixed(1),
      after.averageWaitIndex.toFixed(1),
      before.averageWaitIndex - after.averageWaitIndex,
    ],
    ['Warning lights', String(before.warningLights), String(after.warningLights), before.warningLights - after.warningLights],
    [
      'Affected stations',
      before.affectedStations.map((id) => stationName(state, id)).join(', ') || '\u2013',
      after.affectedStations.map((id) => stationName(state, id)).join(', ') || '\u2013',
      0,
    ],
  ];

  return h(
    'table',
    { class: 'table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { text: 'Measure' }),
        h('th', { text: 'Before' }),
        h('th', { text: 'After' }),
        h('th', { text: 'Change' }),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map(([label, beforeValue, afterValue, delta]) =>
        h(
          'tr',
          {},
          h('th', { attrs: { scope: 'row' }, text: label }),
          h('td', { text: beforeValue }),
          h('td', { text: afterValue }),
          h('td', {
            class: delta > 0 ? 'delta is-better' : delta < 0 ? 'delta is-worse' : 'delta',
            text: delta === 0 ? '\u2013' : delta > 0 ? `\u2191 ${Math.round(delta * 10) / 10}` : `\u2193 ${Math.abs(Math.round(delta * 10) / 10)}`,
          }),
        ),
      ),
    ),
  );
}
