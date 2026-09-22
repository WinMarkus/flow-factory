import assert from 'node:assert/strict';
import test from 'node:test';
import { LIMITS } from '../shared/constants.js';
import * as game from '../server/game.js';
import { clampInt, normalizeName, sanitizeLine, sanitizeText } from '../server/sanitize.js';
import { RoomStore } from '../server/state.js';
import { buildStateView } from '../server/view.js';

test('script tags and their contents are removed', () => {
  const dirty = '<script>alert("xss")</script>Reviews are slow';
  const clean = sanitizeText(dirty, 200);
  assert.equal(clean, 'Reviews are slow');
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('script'), false);
});

test('inline markup and event handlers are stripped', () => {
  const clean = sanitizeText('<img src=x onerror="steal()">Deploy takes ages', 200);
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('onerror'), false);
  assert.ok(clean.includes('Deploy takes ages'));
});

test('dangerous URL schemes are neutralised', () => {
  assert.equal(sanitizeText('javascript:alert(1)', 100).includes('javascript:'), false);
  assert.equal(sanitizeText('DATA:text/html;base64,AAA', 100).includes('DATA:'), false);
  assert.equal(sanitizeText('vbscript:msgbox', 100).includes('vbscript:'), false);
});

test('control characters and stray angle brackets are dropped', () => {
  const clean = sanitizeText('a\u0000b\u0007c <> d', 100);
  assert.equal(/[\u0000-\u001F]/.test(clean), false);
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('>'), false);
});

test('text is trimmed and truncated to the limit', () => {
  assert.equal(sanitizeText('   padded   ', 100), 'padded');
  assert.equal(sanitizeText('x'.repeat(500), 80).length, 80);
  assert.equal(sanitizeLine('first\nsecond', 100), 'first second');
});

test('non-strings become empty strings rather than crashing', () => {
  for (const value of [null, undefined, 42, {}, [], true]) {
    assert.equal(sanitizeText(value, 50), '');
  }
});

test('clampInt keeps numbers inside range and falls back safely', () => {
  assert.equal(clampInt('3', 1, 5, 2), 3);
  assert.equal(clampInt(99, 1, 5, 2), 5);
  assert.equal(clampInt(-4, 1, 5, 2), 1);
  assert.equal(clampInt('abc', 1, 5, 2), 2);
  assert.equal(clampInt(2.6, 1, 5, 2), 3);
});

test('normalizeName ignores case and repeated whitespace', () => {
  assert.equal(normalizeName('  Da na '), 'da na');
  assert.equal(normalizeName('DANA'), normalizeName('dana'));
});

test('injected markup never survives into room state or the state view', () => {
  const store = new RoomStore();
  const created = game.createRoom(store, {
    playerName: '<b>Dana</b>',
    factoryName: '<script>evil()</script>Widget Works',
  });
  assert.ok(created.ok);
  const { room, player } = created.value;
  game.attachSocket(room, player, 'socket-1');

  assert.equal(player.name, 'Dana');
  assert.equal(room.factoryName, 'Widget Works');

  room.phase = 'build';
  assert.equal(
    game.saveSubmissions(room, player, {
      items: [
        {
          kind: 'bottleneck',
          title: '<img src=x onerror=alert(1)>Slow review',
          description: '<script>fetch("/steal")</script>It waits for days',
          station: '<script>',
          impact: 9,
        },
      ],
    }).ok,
    true,
  );

  const stored = room.submissions[0]!;
  assert.equal(stored.title.includes('<'), false);
  assert.equal(stored.description.includes('script'), false);
  assert.equal(stored.impact, 3);
  assert.equal(stored.station, 'all', 'an unknown station falls back to Across the factory');

  const view = buildStateView(room, player, { githubConfigured: false });
  const serialised = JSON.stringify(view);
  assert.equal(serialised.includes('<script'), false);
  assert.equal(serialised.includes('onerror'), false);
});

test('names and notes respect their length limits', () => {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName: 'N'.repeat(200) });
  assert.ok(created.ok);
  assert.equal(created.value.player.name.length, LIMITS.playerName);

  const { room, player } = created.value;
  game.attachSocket(room, player, 'socket-1');
  room.phase = 'build';
  assert.equal(
    game.saveSubmissions(room, player, {
      items: [{ kind: 'booster', title: 'T'.repeat(500), description: 'D'.repeat(2000), station: 'test', impact: 2 }],
    }).ok,
    true,
  );
  assert.equal(room.submissions[0]!.title.length, LIMITS.title);
  assert.equal(room.submissions[0]!.description.length, LIMITS.description);
});

test('the state view hides other players\u2019 private submissions before the reveal', () => {
  const store = new RoomStore();
  const created = game.createRoom(store, { playerName: 'Dana' });
  assert.ok(created.ok);
  const joined = game.joinRoom(store, { roomCode: created.value.room.code, playerName: 'Sam' });
  assert.ok(joined.ok);
  const room = created.value.room;
  game.attachSocket(room, created.value.player, 's1');
  game.attachSocket(room, joined.value.player, 's2');

  room.phase = 'build';
  assert.equal(
    game.saveSubmissions(room, joined.value.player, {
      items: [{ kind: 'bottleneck', title: 'Sam private entry', station: 'test', impact: 2 }],
    }).ok,
    true,
  );

  const danaView = buildStateView(room, created.value.player, { githubConfigured: false });
  assert.equal(danaView.build.items.length, 0);
  assert.equal(danaView.build.mine.length, 0);
  assert.equal(JSON.stringify(danaView).includes('Sam private entry'), false);
  assert.equal(danaView.players.find((p) => p.name === 'Sam')?.readyBuild, false);

  assert.equal(game.advancePhase(room, created.value.player).ok, true);
  const revealed = buildStateView(room, created.value.player, { githubConfigured: false });
  assert.equal(revealed.build.revealed, true);
  assert.equal(revealed.build.items.length, 1);
  assert.equal(JSON.stringify(revealed.build.items).includes('authorId'), false);
});
