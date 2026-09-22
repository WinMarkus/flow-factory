import assert from 'node:assert/strict';
import test from 'node:test';
import { GEAR_COINS, INSPECTION_TOKENS, LIMITS } from '../shared/constants.js';
import * as game from '../server/game.js';
import { RoomStore, type InternalPlayer, type Room } from '../server/state.js';

interface Fixture {
  store: RoomStore;
  room: Room;
  facilitator: InternalPlayer;
  member: InternalPlayer;
}

function fixture(): Fixture {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName: 'Dana', factoryName: 'Widget Works' });
  assert.ok(created.ok);
  const joined = game.joinRoom(store, {
    roomCode: created.value.room.code,
    playerName: 'Sam',
  });
  assert.ok(joined.ok);
  const room = created.value.room;
  game.attachSocket(room, created.value.player, 'socket-dana');
  game.attachSocket(room, joined.value.player, 'socket-sam');
  return {
    store,
    room,
    facilitator: created.value.player,
    member: joined.value.player,
  };
}

function seedSubmissions(room: Room, facilitator: InternalPlayer, member: InternalPlayer): void {
  room.phase = 'build';
  const first = game.saveSubmissions(room, facilitator, {
    items: [
      { kind: 'bottleneck', title: 'Review waits two days', station: 'review', impact: 3 },
      { kind: 'booster', title: 'Pairing on tricky tickets', station: 'development', impact: 2 },
      { kind: 'wildcard', title: 'Surprise fire drill', station: 'all', impact: 2 },
    ],
  });
  assert.equal(first.ok, true);

  const second = game.saveSubmissions(room, member, {
    items: [
      { kind: 'bottleneck', title: 'Flaky tests rerun forever', station: 'test', impact: 2 },
      { kind: 'booster', title: 'Smaller tickets', station: 'ready', impact: 1 },
    ],
  });
  assert.equal(second.ok, true);
}

test('only the facilitator can move the shift forward', () => {
  const { room, facilitator, member } = fixture();
  assert.equal(game.advancePhase(room, member).ok, false);
  assert.equal(game.advancePhase(room, facilitator).ok, true);
  assert.equal(room.phase, 'checkin');
});

test('phases advance and regress one legal step at a time', () => {
  const { room, facilitator, member } = fixture();
  assert.equal(game.advancePhase(room, facilitator).ok, true); // checkin
  assert.equal(game.advancePhase(room, facilitator).ok, true); // build
  assert.equal(room.phase, 'build');

  // run1 is refused while the factory has no inputs at all.
  const blocked = game.advancePhase(room, facilitator);
  assert.equal(blocked.ok, false);
  assert.equal(room.phase, 'build');

  seedSubmissions(room, facilitator, member);
  assert.equal(game.advancePhase(room, facilitator).ok, true);
  assert.equal(room.phase, 'run1');
  assert.ok(room.runs.first, 'entering run1 computes the first simulation');

  assert.equal(game.regressPhase(room, facilitator).ok, true);
  assert.equal(room.phase, 'build');
  assert.equal(game.regressPhase(room, facilitator).ok, true);
  assert.equal(room.phase, 'checkin');
  assert.equal(game.regressPhase(room, facilitator).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(game.regressPhase(room, facilitator).ok, false);
});

test('actions belonging to another phase are rejected', () => {
  const { room, member } = fixture();
  assert.equal(game.submitCheckIn(room, member, { energy: 4, condition: 'Busy' }).ok, false);
  assert.equal(game.saveSubmissions(room, member, { items: [] }).ok, false);
  assert.equal(game.allocateTokens(room, member, { allocations: {} }).ok, false);
  assert.equal(game.setBasket(room, member, { upgradeIds: [] }).ok, false);
});

test('check-in stores energy and condition and clamps out-of-range values', () => {
  const { room, member } = fixture();
  room.phase = 'checkin';
  assert.equal(game.submitCheckIn(room, member, { energy: 99, condition: 'Nope', avatar: 'x' }).ok, true);
  const stored = room.checkIns.get(member.id);
  assert.equal(stored?.energy, 5);
  assert.equal(stored?.condition, 'Busy');
});

test('submission caps per kind are enforced', () => {
  const { room, member } = fixture();
  room.phase = 'build';
  const tooMany = game.saveSubmissions(room, member, {
    items: [
      { kind: 'booster', title: 'One', station: 'all', impact: 1 },
      { kind: 'booster', title: 'Two', station: 'all', impact: 1 },
      { kind: 'booster', title: 'Three', station: 'all', impact: 1 },
    ],
  });
  assert.equal(tooMany.ok, false);
});

test('submissions can be edited until the player marks ready', () => {
  const { room, member } = fixture();
  room.phase = 'build';
  assert.equal(
    game.saveSubmissions(room, member, {
      items: [{ kind: 'booster', title: 'Draft', station: 'all', impact: 1 }],
    }).ok,
    true,
  );
  assert.equal(game.setBuildReady(room, member, true).ok, true);
  const locked = game.saveSubmissions(room, member, {
    items: [{ kind: 'booster', title: 'Changed', station: 'all', impact: 1 }],
  });
  assert.equal(locked.ok, false);
  assert.equal(game.setBuildReady(room, member, false).ok, true);
  assert.equal(
    game.saveSubmissions(room, member, {
      items: [{ kind: 'booster', title: 'Changed', station: 'all', impact: 1 }],
    }).ok,
    true,
  );
  assert.equal(room.submissions.find((item) => item.authorId === member.id)?.title, 'Changed');
});

test('inspection tokens cannot exceed the per-player budget', () => {
  const { room, facilitator, member } = fixture();
  seedSubmissions(room, facilitator, member);
  const target = room.submissions[0]!;
  const other = room.submissions[1]!;
  room.phase = 'inspect';

  const tooMany = game.allocateTokens(room, member, {
    allocations: { [target.id]: 4, [other.id]: 1 },
  });
  assert.equal(tooMany.ok, false);

  const fine = game.allocateTokens(room, member, {
    allocations: { [target.id]: 3, [other.id]: 1 },
  });
  assert.equal(fine.ok, true);
  const totals = game.tokenTotals(room);
  assert.equal(totals.get(target.id), 3);
  assert.equal(INSPECTION_TOKENS, 4);
});

test('merging duplicates preserves both original texts and moves their tokens', () => {
  const { room, facilitator, member } = fixture();
  seedSubmissions(room, facilitator, member);
  room.phase = 'inspect';
  const target = room.submissions.find((item) => item.title === 'Review waits two days')!;
  const source = room.submissions.find((item) => item.title === 'Flaky tests rerun forever')!;

  assert.equal(game.allocateTokens(room, member, { allocations: { [source.id]: 2 } }).ok, true);
  assert.equal(game.mergeItems(room, facilitator, { targetId: target.id, sourceIds: [source.id] }).ok, true);

  assert.equal(room.submissions.some((item) => item.id === source.id), false);
  assert.deepEqual(target.mergedFrom.map((entry) => entry.title), ['Flaky tests rerun forever']);
  assert.equal(game.tokenTotals(room).get(target.id), 2);
});

test('non-facilitators cannot merge, close voting or purchase', () => {
  const { room, facilitator, member } = fixture();
  seedSubmissions(room, facilitator, member);
  room.phase = 'inspect';
  assert.equal(game.closeVoting(room, member).ok, false);
  assert.equal(game.mergeItems(room, member, { targetId: 'x', sourceIds: ['y'] }).ok, false);
  room.phase = 'shop';
  assert.equal(game.purchase(room, member, { upgradeIds: [] }).ok, false);
});

test('an upgrade without an observable signal is rejected', () => {
  const { room, member } = fixture();
  room.phase = 'shop';
  const vague = game.proposeUpgrade(room, member, {
    name: 'Do better',
    problem: 'Reviews are slow',
    experiment: 'Try harder',
    signal: 'ok',
    cost: 2,
  });
  assert.equal(vague.ok, false);
  assert.match(vague.error ?? '', /observable sign/i);
  assert.equal(room.upgrades.length, 0);
});

test('upgrade proposals keep required fields and clamp the cost', () => {
  const { room, member } = fixture();
  room.phase = 'shop';
  assert.equal(
    game.proposeUpgrade(room, member, {
      name: 'Review rota',
      problem: 'Reviews sit unclaimed for two days',
      experiment: 'Two named reviewers per day',
      signal: 'No pull request waits longer than one working day',
      cost: 99,
      station: 'review',
    }).ok,
    true,
  );
  const upgrade = room.upgrades[0]!;
  assert.equal(upgrade.cost, 5);
  assert.equal(upgrade.station, 'review');
  assert.ok(upgrade.signal.length >= LIMITS.minSignalLength);
});

function stockShop(room: Room, member: InternalPlayer): string[] {
  room.phase = 'shop';
  const specs = [
    { name: 'Review rota', cost: 3, station: 'review' },
    { name: 'Test quarantine', cost: 4, station: 'test' },
    { name: 'Deploy checklist', cost: 5, station: 'deploy' },
  ];
  for (const spec of specs) {
    const result = game.proposeUpgrade(room, member, {
      name: spec.name,
      problem: 'Work waits here longer than anywhere else',
      experiment: 'Run a two week experiment and review it together',
      signal: 'The queue at this station stays under three items all week',
      cost: spec.cost,
      station: spec.station,
    });
    assert.equal(result.ok, true);
  }
  return room.upgrades.map((upgrade) => upgrade.id);
}

test('a private basket cannot exceed ten Gear Coins', () => {
  const { room, member } = fixture();
  const ids = stockShop(room, member);
  const tooExpensive = game.setBasket(room, member, { upgradeIds: ids });
  assert.equal(tooExpensive.ok, false);
  assert.match(tooExpensive.error ?? '', /10 Gear Coins/);

  const affordable = game.setBasket(room, member, { upgradeIds: [ids[0]!, ids[1]!] });
  assert.equal(affordable.ok, true);
  assert.deepEqual(room.baskets.get(member.id), [ids[0], ids[1]]);
});

test('the final purchase buys one or two upgrades and nothing else', () => {
  const { room, facilitator, member } = fixture();
  const ids = stockShop(room, member);

  assert.equal(game.purchase(room, facilitator, { upgradeIds: [] }).ok, false);
  const tooMany = game.purchase(room, facilitator, { upgradeIds: ids });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error ?? '', /at most 2/);
  assert.equal(game.purchase(room, facilitator, { upgradeIds: ['ghost-id'] }).ok, false);
  assert.deepEqual(room.purchased, []);

  const good = game.purchase(room, facilitator, { upgradeIds: [ids[0]!, ids[1]!] });
  assert.equal(good.ok, true);
  assert.deepEqual(room.purchased, [ids[0], ids[1]]);

  const cost = room.upgrades
    .filter((upgrade) => room.purchased.includes(upgrade.id))
    .reduce((sum, upgrade) => sum + upgrade.cost, 0);
  assert.ok(cost <= GEAR_COINS);
});

test('the purchase budget guard holds even if a basket would overspend', () => {
  const { room, facilitator, member } = fixture();
  const ids = stockShop(room, member);
  // Force an expensive shelf to exercise the coin guard itself.
  room.upgrades[0]!.cost = 7;
  room.upgrades[1]!.cost = 6;

  const overBudget = game.purchase(room, facilitator, { upgradeIds: [ids[0]!, ids[1]!] });
  assert.equal(overBudget.ok, false);
  assert.match(overBudget.error ?? '', /budget is 10/);
  assert.deepEqual(room.purchased, []);

  const affordable = game.purchase(room, facilitator, { upgradeIds: [ids[0]!] });
  assert.equal(affordable.ok, true);
  assert.deepEqual(room.purchased, [ids[0]]);
});

test('collective support counts baskets rather than coins alone', () => {
  const { room, facilitator, member } = fixture();
  const ids = stockShop(room, member);
  assert.equal(game.setBasket(room, member, { upgradeIds: [ids[0]!] }).ok, true);
  assert.equal(game.setBasket(room, facilitator, { upgradeIds: [ids[0]!, ids[1]!] }).ok, true);

  const support = game.basketSupport(room);
  assert.equal(support[0]?.upgradeId, ids[0]);
  assert.equal(support[0]?.supporters, 2);
  assert.equal(support.find((entry) => entry.upgradeId === ids[2])?.supporters, 0);
});

test('the improved run applies purchased upgrades and keeps the inputs unchanged', () => {
  const { room, facilitator, member } = fixture();
  seedSubmissions(room, facilitator, member);
  room.phase = 'build';
  assert.equal(game.advancePhase(room, facilitator).ok, true); // run1
  const submissionsBefore = JSON.stringify(game.toPublic(room.submissions));

  const ids = stockShop(room, member);
  assert.equal(game.purchase(room, facilitator, { upgradeIds: [ids[0]!] }).ok, true);
  room.phase = 'shop';
  assert.equal(game.advancePhase(room, facilitator).ok, true); // run2

  assert.ok(room.runs.second);
  assert.deepEqual(room.runs.second?.upgradesApplied, [ids[0]]);
  assert.equal(JSON.stringify(game.toPublic(room.submissions)), submissionsBefore);
});

test('resetting returns the room to the lobby but keeps the players', () => {
  const { room, facilitator, member } = fixture();
  seedSubmissions(room, facilitator, member);
  room.phase = 'build';
  assert.equal(game.advancePhase(room, facilitator).ok, true);
  assert.equal(game.resetRoom(room, facilitator).ok, true);
  assert.equal(room.phase, 'lobby');
  assert.equal(room.submissions.length, 0);
  assert.equal(room.runs.first, null);
  assert.equal(room.players.length, 2);
});
