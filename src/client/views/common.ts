import { ACROSS_FACTORY, ACROSS_FACTORY_LABEL } from '../../shared/constants.js';
import type { GameStateView, PublicSubmission, SubmissionKind } from '../../shared/types.js';
import { h } from '../dom.js';

export const KIND_LABEL: Record<SubmissionKind, string> = {
  booster: 'Booster',
  bottleneck: 'Bottleneck',
  wildcard: 'Wildcard',
};

export const KIND_EMOJI: Record<SubmissionKind, string> = {
  booster: '\u2699\uFE0F',
  bottleneck: '\u{1F6A7}',
  wildcard: '\u26A1',
};

export function stationName(state: GameStateView, id: string): string {
  if (id === ACROSS_FACTORY) return ACROSS_FACTORY_LABEL;
  return state.stations.find((station) => station.id === id)?.name ?? ACROSS_FACTORY_LABEL;
}

export function panel(title: string, subtitle?: string, ...children: Array<Node | null>): HTMLElement {
  return h(
    'section',
    { class: 'panel' },
    h(
      'header',
      { class: 'panel-head' },
      h('h2', { class: 'panel-title', text: title }),
      subtitle ? h('p', { class: 'panel-sub', text: subtitle }) : null,
    ),
    ...children,
  );
}

export function impactDots(impact: number): HTMLElement {
  const dots = h('span', { class: 'impact', title: `Impact ${impact} of 3` });
  for (let i = 1; i <= 3; i += 1) {
    dots.appendChild(h('span', { class: i <= impact ? 'dot is-on' : 'dot' }));
  }
  dots.appendChild(h('span', { class: 'sr-only', text: `Impact ${impact} of 3` }));
  return dots;
}

export function stationSelect(
  state: GameStateView,
  selected: string,
  onChange?: (value: string) => void,
): HTMLSelectElement {
  const select = h('select', { class: 'input' }) as HTMLSelectElement;
  for (const station of state.stations) {
    select.appendChild(h('option', { value: station.id, text: `${station.emoji} ${station.name}` }));
  }
  select.appendChild(h('option', { value: ACROSS_FACTORY, text: `\u{1F3ED} ${ACROSS_FACTORY_LABEL}` }));
  select.value = selected || ACROSS_FACTORY;
  if (onChange) select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function itemCard(
  state: GameStateView,
  item: PublicSubmission,
  extras: Array<Node | null> = [],
): HTMLElement {
  return h(
    'article',
    { class: `item item-${item.kind}` },
    h(
      'header',
      { class: 'item-head' },
      h('span', { class: 'item-kind', text: `${KIND_EMOJI[item.kind]} ${KIND_LABEL[item.kind]}` }),
      impactDots(item.impact),
    ),
    h('h3', { class: 'item-title', text: item.title }),
    item.description ? h('p', { class: 'item-desc', text: item.description }) : null,
    h('p', { class: 'item-station', text: stationName(state, item.station) }),
    item.mergedFrom.length > 0
      ? h(
          'details',
          { class: 'merged' },
          h('summary', { text: `Merged with ${item.mergedFrom.length} similar entr${item.mergedFrom.length === 1 ? 'y' : 'ies'}` }),
          ...item.mergedFrom.map((source) =>
            h(
              'div',
              { class: 'merged-entry' },
              h('strong', { text: source.title }),
              source.description ? h('p', { text: source.description }) : null,
            ),
          ),
        )
      : null,
    ...extras,
  );
}

export function emptyState(message: string): HTMLElement {
  return h('p', { class: 'empty', text: message });
}

export function disclaimer(): HTMLElement {
  return h('p', {
    class: 'disclaimer',
    text: 'This run is a discussion aid, not an operational forecast. The numbers describe the game, not your delivery.',
  });
}
