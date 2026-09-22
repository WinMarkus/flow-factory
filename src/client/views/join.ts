import { LIMITS } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import { button, field, h } from '../dom.js';
import type { AppStore } from '../net.js';

export function createJoinView(store: AppStore, prefilledCode: string): HTMLElement {
  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: String(LIMITS.playerName),
    placeholder: 'e.g. Markus',
    autocomplete: 'off',
    attrs: { required: 'required' },
  }) as HTMLInputElement;

  const factoryInput = h('input', {
    class: 'input',
    type: 'text',
    maxlength: String(LIMITS.factoryName),
    placeholder: 'Widget Works',
    autocomplete: 'off',
  }) as HTMLInputElement;

  const codeInput = h('input', {
    class: 'input input-code',
    type: 'text',
    maxlength: '6',
    placeholder: 'ABCD',
    autocomplete: 'off',
    value: prefilledCode,
    attrs: { 'aria-label': 'Room code' },
  }) as HTMLInputElement;

  const status = h('p', { class: 'join-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  function requireName(): string | null {
    const name = nameInput.value.trim();
    if (name.length < 2) {
      status.textContent = 'Enter your name first - it is how the crew will know you.';
      nameInput.focus();
      return null;
    }
    return name;
  }

  function create(): void {
    const name = requireName();
    if (!name) return;
    status.textContent = 'Opening a factory...';
    store.emit(C2S.createRoom, { playerName: name, factoryName: factoryInput.value.trim() });
  }

  function join(): void {
    const name = requireName();
    if (!name) return;
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 4) {
      status.textContent = 'A room code has four characters.';
      codeInput.focus();
      return;
    }
    status.textContent = `Walking into factory ${code}...`;
    store.emit(C2S.joinRoom, { playerName: name, roomCode: code });
  }

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  for (const input of [nameInput, factoryInput, codeInput]) {
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (input === codeInput) join();
      else if (codeInput.value.trim().length >= 4) join();
      else create();
    });
  }

  store.onError(({ message }) => {
    status.textContent = message;
    status.classList.add('is-error');
    window.setTimeout(() => status.classList.remove('is-error'), 4_000);
  });

  const view = h(
    'div',
    { class: 'join' },
    h(
      'header',
      { class: 'join-hero' },
      h('p', { class: 'join-eyebrow', text: '\u{1F3ED} Flow Factory' }),
      h('h1', { class: 'join-title', text: 'Run your delivery as a factory for an hour.' }),
      h('p', {
        class: 'join-lede',
        text: 'A cooperative retrospective for six to eight people. Log what helped and what jammed, watch the factory run, then spend ten Gear Coins on the experiments you actually want to try.',
      }),
    ),
    h(
      'div',
      { class: 'join-card' },
      field('Your name', nameInput, 'Everyone in the room sees this. Entries stay anonymous.'),
      h(
        'div',
        { class: 'join-columns' },
        h(
          'div',
          { class: 'join-column' },
          h('h2', { text: 'Start a new factory' }),
          field('Factory name', factoryInput, 'Optional. Defaults to your name.'),
          button('Create factory', create, { class: 'btn btn-primary btn-block' }),
          h('p', { class: 'join-note', text: 'You become the facilitator and get the phase controls.' }),
        ),
        h(
          'div',
          { class: 'join-column' },
          h('h2', { text: 'Join an existing one' }),
          field('Room code', codeInput, 'Four characters from your invitation.'),
          button('Join factory', join, { class: 'btn btn-block' }),
          h('p', { class: 'join-note', text: 'An invitation link fills the code in for you.' }),
        ),
      ),
      status,
    ),
    h(
      'ol',
      { class: 'join-steps' },
      h('li', { text: 'Check in with your energy and how the factory feels.' }),
      h('li', { text: 'Privately log Boosters, Bottlenecks and one Wildcard.' }),
      h('li', { text: 'Watch the first run, then inspect what deserves discussion.' }),
      h('li', { text: 'Buy one or two upgrades and run the improved factory.' }),
    ),
  );

  window.setTimeout(() => nameInput.focus(), 50);
  return view;
}
