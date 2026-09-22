import { GEAR_COINS, LIMITS, MAX_PURCHASES, MAX_UPGRADE_COST } from '../../shared/constants.js';
import { C2S } from '../../shared/events.js';
import type { GameStateView, Upgrade } from '../../shared/types.js';
import { button, h, replace } from '../dom.js';
import type { AppStore } from '../net.js';
import { emptyState, panel, stationName, stationSelect } from './common.js';
import type { View } from './lobby.js';

export function createShopView(store: AppStore): View {
  let latest: GameStateView | null = null;
  let basket = new Set<string>();
  let hydrated = false;
  const purchaseSelection = new Set<string>();

  const nameInput = input('text', 'Review rota', LIMITS.upgradeName, 'Upgrade name');
  const problemInput = textarea('Which problem does it address?', 'Problem addressed');
  const experimentInput = textarea('What will the team try?', 'Proposed experiment');
  const signalInput = textarea('How will we notice it worked? Be concrete.', 'Observable sign of improvement');
  const ownerInput = input('text', 'Optional owner', LIMITS.owner, 'Owner');
  const reviewInput = input('text', 'e.g. next retro, or 2026-10-15', LIMITS.reviewDate, 'Review date or period');
  const costInput = h('input', {
    class: 'slider',
    type: 'range',
    min: '1',
    max: String(MAX_UPGRADE_COST),
    step: '1',
    value: '2',
    attrs: { 'aria-label': 'Cost in Gear Coins' },
  }) as HTMLInputElement;
  const costLabel = h('span', { class: 'impact-label', text: '2 Gear Coins' });
  const stationBox = h('div', { class: 'inline-field' });
  const formStatus = h('p', { class: 'note', attrs: { role: 'status', 'aria-live': 'polite' } });

  costInput.addEventListener('input', () => {
    costLabel.textContent = `${costInput.value} Gear Coin${costInput.value === '1' ? '' : 's'}`;
  });

  function input(type: string, placeholder: string, maxlength: number, label: string): HTMLInputElement {
    return h('input', {
      class: 'input',
      type,
      placeholder,
      maxlength: String(maxlength),
      attrs: { 'aria-label': label },
    }) as HTMLInputElement;
  }

  function textarea(placeholder: string, label: string): HTMLTextAreaElement {
    return h('textarea', {
      class: 'input textarea',
      rows: '2',
      maxlength: String(LIMITS.upgradeText),
      placeholder,
      attrs: { 'aria-label': label },
    }) as HTMLTextAreaElement;
  }

  const proposeButton = button(
    'Put it on the shelf',
    () => {
      const state = latest;
      if (!state) return;
      const select = stationBox.querySelector('select');
      store.emit(C2S.proposeUpgrade, {
        name: nameInput.value,
        problem: problemInput.value,
        experiment: experimentInput.value,
        signal: signalInput.value,
        cost: Number(costInput.value),
        owner: ownerInput.value,
        reviewDate: reviewInput.value,
        station: select ? (select as HTMLSelectElement).value : 'all',
      });
      formStatus.textContent = 'Sent to the shelf.';
      nameInput.value = '';
      problemInput.value = '';
      experimentInput.value = '';
      signalInput.value = '';
    },
    { class: 'btn btn-primary' },
  );

  const shelf = h('div', { class: 'shelf' });
  const basketBar = h('div', { class: 'basket-bar' });
  const supportPanel = h('div', { class: 'support' });
  const purchasePanel = h('div', { class: 'purchase' });

  const proposeForm = h(
    'div',
    { class: 'upgrade-form' },
    h('div', { class: 'form-grid' },
      labelled('Name', nameInput),
      labelled('Cost (effort, not importance)', h('div', { class: 'inline-field' }, costInput, costLabel)),
      labelled('Problem addressed', problemInput),
      labelled('Proposed experiment', experimentInput),
      labelled('Observable sign of improvement', signalInput),
      labelled('Station', stationBox),
      labelled('Owner (optional)', ownerInput),
      labelled('Review date or period', reviewInput),
    ),
    h('div', { class: 'actions' }, proposeButton, formStatus),
  );

  function labelled(label: string, control: HTMLElement): HTMLElement {
    return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control);
  }

  const el = h(
    'div',
    { class: 'view view-shop' },
    panel(
      'Upgrade shop',
      `The team shares ${GEAR_COINS} Gear Coins. Cost is effort, not importance. Every upgrade needs an observable sign of improvement.`,
      proposeForm,
    ),
    panel('On the shelf', 'Build a private basket of what you would buy.', basketBar, shelf),
    panel('Collective support', 'All baskets revealed together.', supportPanel),
    panel('Final purchase', `One or two upgrades, at most ${GEAR_COINS} coins.`, purchasePanel),
  );

  function basketCost(state: GameStateView): number {
    return state.shop.upgrades
      .filter((upgrade) => basket.has(upgrade.id))
      .reduce((sum, upgrade) => sum + upgrade.cost, 0);
  }

  function toggleBasket(state: GameStateView, upgrade: Upgrade): void {
    if (basket.has(upgrade.id)) basket.delete(upgrade.id);
    else basket.add(upgrade.id);
    if (basketCost(state) > GEAR_COINS) {
      basket.delete(upgrade.id);
      return;
    }
    store.emit(C2S.setBasket, { upgradeIds: [...basket] });
    update(state);
  }

  function upgradeCard(state: GameStateView, upgrade: Upgrade): HTMLElement {
    const inBasket = basket.has(upgrade.id);
    const purchased = state.shop.purchased.includes(upgrade.id);
    const support = state.shop.support.find((entry) => entry.upgradeId === upgrade.id);

    return h(
      'article',
      { class: purchased ? 'upgrade is-purchased' : 'upgrade' },
      h(
        'header',
        { class: 'upgrade-head' },
        h('h3', { class: 'item-title', text: upgrade.name }),
        h('span', { class: 'coin', text: `${upgrade.cost} \u{1FA99}` }),
      ),
      h('dl', { class: 'upgrade-body' },
        h('dt', { text: 'Problem' }), h('dd', { text: upgrade.problem }),
        h('dt', { text: 'Experiment' }), h('dd', { text: upgrade.experiment }),
        h('dt', { text: 'We will notice' }), h('dd', { text: upgrade.signal }),
        h('dt', { text: 'Station' }), h('dd', { text: stationName(state, upgrade.station) }),
        upgrade.owner ? h('dt', { text: 'Owner' }) : null,
        upgrade.owner ? h('dd', { text: upgrade.owner }) : null,
        upgrade.reviewDate ? h('dt', { text: 'Review' }) : null,
        upgrade.reviewDate ? h('dd', { text: upgrade.reviewDate }) : null,
      ),
      support ? h('p', { class: 'note', text: `${support.supporters} basket${support.supporters === 1 ? '' : 's'} included this.` }) : null,
      h(
        'div',
        { class: 'actions' },
        state.shop.revealed
          ? null
          : button(inBasket ? 'In my basket' : 'Add to my basket', () => toggleBasket(state, upgrade), {
              class: inBasket ? 'btn btn-primary btn-small' : 'btn btn-small',
            }),
        state.you.isFacilitator && !state.shop.revealed
          ? button('Remove', () => store.emit(C2S.removeUpgrade, { id: upgrade.id }), { class: 'btn btn-small btn-quiet' })
          : null,
        state.you.isFacilitator && state.shop.revealed
          ? editControls(state, upgrade)
          : null,
      ),
    );
  }

  function editControls(state: GameStateView, upgrade: Upgrade): HTMLElement {
    const owner = h('input', { class: 'input input-small', type: 'text', value: upgrade.owner, maxlength: String(LIMITS.owner), placeholder: 'Owner', attrs: { 'aria-label': `Owner for ${upgrade.name}` } }) as HTMLInputElement;
    const review = h('input', { class: 'input input-small', type: 'text', value: upgrade.reviewDate, maxlength: String(LIMITS.reviewDate), placeholder: 'Review date', attrs: { 'aria-label': `Review date for ${upgrade.name}` } }) as HTMLInputElement;
    const name = h('input', { class: 'input input-small', type: 'text', value: upgrade.name, maxlength: String(LIMITS.upgradeName), attrs: { 'aria-label': `Wording for ${upgrade.name}` } }) as HTMLInputElement;
    return h(
      'div',
      { class: 'edit-row' },
      name,
      owner,
      review,
      button('Save wording', () => {
        store.emit(C2S.editUpgrade, { id: upgrade.id, name: name.value, owner: owner.value, reviewDate: review.value });
      }, { class: 'btn btn-small' }),
    );
  }

  function update(state: GameStateView): void {
    latest = state;
    if (!hydrated) {
      basket = new Set(state.shop.myBasket);
      hydrated = true;
    }

    if (stationBox.childElementCount === 0) {
      stationBox.appendChild(stationSelect(state, 'all'));
    }

    replace(shelf, state.shop.upgrades.length === 0
      ? [emptyState('The shelf is empty. Propose the first upgrade above.')]
      : state.shop.upgrades.map((upgrade) => upgradeCard(state, upgrade)));

    const cost = basketCost(state);
    const me = state.players.find((player) => player.id === state.you.id);
    replace(basketBar, [
      h('span', { class: 'coin-total', text: `${cost} / ${GEAR_COINS} Gear Coins in my basket` }),
      state.shop.revealed
        ? h('span', { class: 'note', text: 'Baskets are revealed.' })
        : button(me?.readyShop ? 'Change my basket' : 'My basket is final', () => {
            store.emit(C2S.setBasket, { upgradeIds: [...basket] });
            store.emit(C2S.readyShop, { ready: !me?.readyShop });
          }, { class: 'btn btn-primary btn-small' }),
      h('span', { class: 'note', text: `${state.players.filter((player) => player.readyShop).length} of ${state.players.length} finished.` }),
      state.you.isFacilitator && !state.shop.revealed
        ? button('Reveal all baskets', () => store.emit(C2S.revealBaskets), { class: 'btn btn-small' })
        : null,
    ]);

    if (!state.shop.revealed) {
      replace(supportPanel, [emptyState('Baskets stay private until the facilitator reveals them.')]);
    } else {
      const rows = state.shop.support.filter((entry) => entry.supporters > 0);
      replace(supportPanel, [
        h('p', { class: 'note', text: `${state.shop.basketsSubmitted} basket${state.shop.basketsSubmitted === 1 ? '' : 's'} submitted.` }),
        rows.length === 0
          ? emptyState('Nobody put anything in a basket.')
          : h('ul', { class: 'ranked' }, ...rows.map((entry) => {
              const upgrade = state.shop.upgrades.find((item) => item.id === entry.upgradeId);
              return h('li', {},
                h('span', { text: upgrade?.name ?? 'Removed upgrade' }),
                h('span', { class: 'tag', text: `${entry.supporters} supporter${entry.supporters === 1 ? '' : 's'} \u00B7 ${upgrade?.cost ?? 0} coins` }),
              );
            })),
      ]);
    }

    if (!state.you.isFacilitator) {
      const purchased = state.shop.upgrades.filter((upgrade) => state.shop.purchased.includes(upgrade.id));
      replace(purchasePanel, purchased.length === 0
        ? [emptyState('The facilitator confirms the purchase once the team agrees.')]
        : [h('ul', { class: 'ranked' }, ...purchased.map((upgrade) =>
            h('li', {}, h('span', { text: upgrade.name }), h('span', { class: 'tag tag-good', text: `${upgrade.cost} coins` }))))]);
      return;
    }

    const selectedCost = state.shop.upgrades
      .filter((upgrade) => purchaseSelection.has(upgrade.id))
      .reduce((sum, upgrade) => sum + upgrade.cost, 0);

    replace(purchasePanel, [
      h('p', { class: 'note', text: 'Agree together, then tick what the factory buys.' }),
      state.shop.upgrades.length === 0
        ? emptyState('Nothing on the shelf yet.')
        : h('div', { class: 'purchase-list' }, ...state.shop.upgrades.map((upgrade) =>
            h('label', { class: 'purchase-pick' },
              h('input', {
                type: 'checkbox',
                checked: purchaseSelection.has(upgrade.id) || state.shop.purchased.includes(upgrade.id),
                attrs: { 'aria-label': `Buy ${upgrade.name}` },
                on: {
                  change: (event: Event) => {
                    const checked = (event.target as HTMLInputElement).checked;
                    if (checked) purchaseSelection.add(upgrade.id);
                    else purchaseSelection.delete(upgrade.id);
                    update(state);
                  },
                },
              }),
              h('span', { text: `${upgrade.name} \u00B7 ${upgrade.cost} coins` }),
            ))),
      h('div', { class: 'actions' },
        h('span', { class: selectedCost > GEAR_COINS ? 'coin-total is-over' : 'coin-total', text: `${selectedCost} / ${GEAR_COINS} coins selected` }),
        button('Buy these upgrades', () => {
          store.emit(C2S.purchase, { upgradeIds: [...purchaseSelection] });
        }, {
          class: 'btn btn-primary',
          disabled: purchaseSelection.size === 0 || purchaseSelection.size > MAX_PURCHASES || selectedCost > GEAR_COINS,
        }),
      ),
      state.shop.purchased.length > 0
        ? h('p', { class: 'note', text: 'Purchased. Move to the improved run when the team is ready.' })
        : null,
    ]);
  }

  return { el, update };
}
