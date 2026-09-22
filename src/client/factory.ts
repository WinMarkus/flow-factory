import { ACROSS_FACTORY_LABEL, MACHINE_FLAVOUR, SIM } from '../shared/constants.js';
import type { GameStateView, SimFrame, SimulationResult, Station } from '../shared/types.js';
import { h, replace, svg } from './dom.js';

interface StationRefs {
  root: HTMLElement;
  name: HTMLElement;
  flavour: HTMLElement;
  queueCount: HTMLElement;
  boxes: HTMLElement;
  worker: HTMLElement;
  light: HTMLElement;
  speedFill: HTMLElement;
  speedText: HTMLElement;
  belt: HTMLElement | null;
}

const MAX_VISIBLE_BOXES = 8;

function gearIcon(): SVGElement {
  const teeth: SVGElement[] = [];
  for (let i = 0; i < 8; i += 1) {
    teeth.push(
      svg('rect', {
        x: 21,
        y: 1,
        width: 6,
        height: 9,
        rx: 2,
        transform: `rotate(${i * 45} 24 24)`,
        fill: 'currentColor',
      }),
    );
  }
  return svg(
    'svg',
    { viewBox: '0 0 48 48', class: 'gear', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: 24, cy: 24, r: 15, fill: 'none', stroke: 'currentColor', 'stroke-width': 6 }),
    svg('circle', { cx: 24, cy: 24, r: 5, fill: 'currentColor' }),
    ...teeth,
  );
}

function gaugeTile(label: string, id: string): { root: HTMLElement; value: HTMLElement } {
  const value = h('span', { class: 'gauge-value', text: '0', id });
  const root = h('div', { class: 'gauge' }, value, h('span', { class: 'gauge-label', text: label }));
  return { root, value };
}

/**
 * The factory floor: conveyor belts, queues, warning lights and gauges.
 * It is driven entirely by frames the server computed, so every client shows
 * exactly the same run.
 */
export function createFactoryFloor(): {
  el: HTMLElement;
  render(state: GameStateView, frame: SimFrame | null, run: SimulationResult | null): void;
} {
  const stationRefs = new Map<string, StationRefs>();
  let builtFor = '';

  const line = h('div', { class: 'factory-line', attrs: { role: 'group', 'aria-label': 'Factory stations' } });
  const eventBanner = h('div', { class: 'factory-event', attrs: { role: 'status', 'aria-live': 'polite' } });

  const throughput = gaugeTile('Items shipped', 'gauge-throughput');
  const wip = gaugeTile('Work in progress', 'gauge-wip');
  const wait = gaugeTile('Waiting indicator', 'gauge-wait');
  const warnings = gaugeTile('Warning lights', 'gauge-warnings');
  const tickLabel = h('span', { class: 'tick-label', text: 'Tick 0' });

  const progressFill = h('div', { class: 'progress-fill' });
  const progress = h(
    'div',
    {
      class: 'progress',
      attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(SIM.TICKS), 'aria-valuenow': '0' },
    },
    progressFill,
  );

  const header = h(
    'div',
    { class: 'factory-head' },
    h('div', { class: 'factory-title' }, gearIcon(), h('span', { text: 'Factory floor' }), tickLabel),
    h('div', { class: 'gauges' }, throughput.root, wip.root, wait.root, warnings.root),
  );

  const el = h('section', { class: 'factory' }, header, progress, eventBanner, line);

  function build(stations: Station[]): void {
    stationRefs.clear();
    const nodes: HTMLElement[] = [];

    stations.forEach((station, index) => {
      const name = h('span', { class: 'station-name', text: station.name });
      const flavour = h('span', {
        class: 'station-flavour',
        text: MACHINE_FLAVOUR[station.id] ?? 'Factory machine',
      });
      const light = h('span', {
        class: 'warning-light',
        attrs: { 'aria-hidden': 'true' },
      });
      const queueCount = h('span', { class: 'queue-count', text: '0' });
      const boxes = h('div', { class: 'boxes', attrs: { 'aria-hidden': 'true' } });
      const worker = h('span', { class: 'worker', text: '\u{1F9D1}\u200D\u{1F527}', attrs: { 'aria-hidden': 'true' } });
      const speedFill = h('div', { class: 'speed-fill' });
      const speedText = h('span', { class: 'speed-text', text: '100%' });

      const root = h(
        'article',
        { class: 'station', data: { station: station.id } },
        h(
          'header',
          { class: 'station-head' },
          h('span', { class: 'station-emoji', text: station.emoji, attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'station-names' }, name, flavour),
          light,
        ),
        h('div', { class: 'station-body' }, worker, boxes),
        h(
          'footer',
          { class: 'station-foot' },
          h('span', { class: 'queue-label' }, h('span', { text: 'Queue ' }), queueCount),
          h('div', { class: 'speed-bar' }, speedFill),
          speedText,
        ),
      );

      nodes.push(root);

      let belt: HTMLElement | null = null;
      if (index < stations.length - 1) {
        belt = h(
          'div',
          { class: 'belt', attrs: { 'aria-hidden': 'true' } },
          h('div', { class: 'belt-track' }),
          h('div', { class: 'belt-item' }),
        );
        nodes.push(belt);
      }

      stationRefs.set(station.id, {
        root,
        name,
        flavour,
        queueCount,
        boxes,
        worker,
        light,
        speedFill,
        speedText,
        belt,
      });
    });

    replace(line, nodes);
  }

  function render(state: GameStateView, frame: SimFrame | null, run: SimulationResult | null): void {
    const signature = state.stations.map((station) => `${station.id}:${station.name}`).join('|');
    if (signature !== builtFor) {
      build(state.stations);
      builtFor = signature;
    }

    const totalTicks = run?.frames.length ?? SIM.TICKS;
    const tick = frame?.tick ?? 0;
    tickLabel.textContent = `Tick ${tick} of ${totalTicks}`;
    progressFill.style.width = `${Math.round((tick / totalTicks) * 100)}%`;
    progress.setAttribute('aria-valuenow', String(tick));

    throughput.value.textContent = String(frame?.throughput ?? 0);
    wip.value.textContent = String(frame?.wip ?? 0);
    wait.value.textContent = frame ? frame.waitIndex.toFixed(1) : '0.0';
    warnings.value.textContent = String(frame?.stations.filter((s) => s.warning).length ?? 0);

    const events = frame?.activeEvents ?? [];
    if (events.length > 0) {
      const names = events
        .map((event) => {
          const station = state.stations.find((candidate) => candidate.id === event.station);
          return `${event.title} (${station ? station.name : ACROSS_FACTORY_LABEL})`;
        })
        .join(' \u00B7 ');
      eventBanner.textContent = `\u26A1 Wildcard: ${names}`;
      eventBanner.classList.add('is-active');
    } else {
      eventBanner.textContent = '';
      eventBanner.classList.remove('is-active');
    }

    for (const station of state.stations) {
      const refs = stationRefs.get(station.id);
      if (!refs) continue;
      refs.name.textContent = station.name;

      const stationFrame = frame?.stations.find((candidate) => candidate.id === station.id);
      const queue = stationFrame?.queue ?? 0;
      const speed = stationFrame?.speed ?? run?.summary.stationSpeeds[station.id] ?? 1;
      const processed = stationFrame?.processed ?? 0;

      refs.queueCount.textContent = String(queue);
      refs.speedFill.style.width = `${Math.min(100, Math.round((speed / 1.6) * 100))}%`;
      refs.speedFill.classList.toggle('is-slow', speed < 0.95);
      refs.speedFill.classList.toggle('is-fast', speed > 1.05);
      refs.speedText.textContent = `${Math.round(speed * 100)}%`;
      refs.root.classList.toggle('is-warning', Boolean(stationFrame?.warning));
      refs.light.classList.toggle('is-on', Boolean(stationFrame?.warning));
      refs.light.title = stationFrame?.warning ? 'Queue is backing up' : 'Flowing';
      refs.worker.classList.toggle('is-busy', processed > 0);

      const visible = Math.min(queue, MAX_VISIBLE_BOXES);
      const boxNodes: HTMLElement[] = [];
      for (let i = 0; i < visible; i += 1) {
        boxNodes.push(h('span', { class: 'box' }));
      }
      if (queue > MAX_VISIBLE_BOXES) {
        boxNodes.push(h('span', { class: 'box-more', text: `+${queue - MAX_VISIBLE_BOXES}` }));
      }
      replace(refs.boxes, boxNodes);

      if (refs.belt) {
        const duration = Math.max(0.6, 2.4 / Math.max(0.2, speed));
        refs.belt.style.setProperty('--belt-duration', `${duration.toFixed(2)}s`);
        refs.belt.classList.toggle('is-moving', processed > 0);
      }
    }
  }

  return { el, render };
}
