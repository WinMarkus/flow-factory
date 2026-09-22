export type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  id?: string;
  text?: string | number;
  title?: string;
  type?: string;
  value?: string;
  name?: string;
  placeholder?: string;
  href?: string;
  target?: string;
  rel?: string;
  min?: string;
  max?: string;
  step?: string;
  rows?: string;
  maxlength?: string;
  disabled?: boolean;
  checked?: boolean;
  hidden?: boolean;
  autocomplete?: string;
  attrs?: Record<string, string | number | boolean | null>;
  data?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: never) => void>>;
}

/**
 * Creates an element. Text always goes through textContent, so user-provided
 * strings can never be interpreted as markup.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.title) el.title = props.title;
  if (props.text !== undefined) el.textContent = String(props.text);
  if (props.hidden) el.hidden = true;

  const simple: Array<keyof ElementProps> = [
    'type',
    'value',
    'name',
    'placeholder',
    'href',
    'target',
    'rel',
    'min',
    'max',
    'step',
    'rows',
    'maxlength',
    'autocomplete',
  ];
  for (const key of simple) {
    const value = props[key];
    if (value !== undefined && value !== null) el.setAttribute(key, String(value));
  }

  if (props.disabled !== undefined && 'disabled' in el) {
    (el as unknown as { disabled: boolean }).disabled = props.disabled;
  }
  if (props.checked !== undefined && 'checked' in el) {
    (el as unknown as { checked: boolean }).checked = props.checked;
  }

  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === null || value === false) continue;
      el.setAttribute(key, String(value));
    }
  }
  if (props.data) {
    for (const [key, value] of Object.entries(props.data)) el.dataset[key] = value;
  }
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(event, handler as EventListener);
    }
  }

  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Node, children: Child[]): void {
  clear(node);
  append(node, children);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(
  tag: string,
  attrs: Record<string, string | number> = {},
  ...children: Array<SVGElement | string>
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function button(
  label: string,
  onClick: () => void,
  options: { class?: string; disabled?: boolean; title?: string } = {},
): HTMLButtonElement {
  return h('button', {
    class: options.class ?? 'btn',
    type: 'button',
    text: label,
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
    ...(options.title ? { title: options.title } : {}),
    on: { click: () => onClick() },
  });
}

export function field(labelText: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || `field-${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label', text: labelText, attrs: { for: id } }),
    control,
    hint ? h('span', { class: 'field-hint', text: hint }) : null,
  );
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
