/**
 * Values shared by the server and the browser client.
 * Everything here is deterministic configuration - no randomness.
 */

export const APP_NAME = 'Flow Factory';
export const SCHEMA_VERSION = 1;

export const PHASES = [
  'lobby',
  'checkin',
  'build',
  'run1',
  'inspect',
  'shop',
  'run2',
  'report',
] as const;

export type Phase = (typeof PHASES)[number];

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: 'Factory gate',
  checkin: 'Shift check-in',
  build: 'Build the current factory',
  run1: 'First factory run',
  inspect: 'Inspect the machinery',
  shop: 'Upgrade shop',
  run2: 'Improved factory run',
  report: 'End-of-shift report',
};

export const PHASE_HINTS: Record<Phase, string> = {
  lobby: 'Everyone joins, picks a name and waits for the facilitator to start the shift.',
  checkin: 'Say how much energy you brought and what the factory feels like right now.',
  build: 'Privately log what helped flow, what blocked it, and one surprise.',
  run1: 'Watch the factory run with today\u2019s real conditions applied.',
  inspect: 'Spend inspection tokens on the items worth talking about, then discuss them.',
  shop: 'Propose upgrades, build a private basket, then buy together within ten coins.',
  run2: 'Run the same factory again with the purchased upgrades fitted.',
  report: 'Read the shift report and save it for the team.',
};

export interface StationSeed {
  id: string;
  name: string;
  emoji: string;
}

export const DEFAULT_STATIONS: StationSeed[] = [
  { id: 'intake', name: 'Ticket Intake', emoji: '\u{1F4E5}' },
  { id: 'ready', name: 'Ready Queue', emoji: '\u{1F4CB}' },
  { id: 'development', name: 'Development', emoji: '\u{1F528}' },
  { id: 'review', name: 'Review', emoji: '\u{1F50D}' },
  { id: 'test', name: 'Test', emoji: '\u{1F9EA}' },
  { id: 'deploy', name: 'Deploy', emoji: '\u{1F680}' },
  { id: 'done', name: 'Done', emoji: '\u{1F389}' },
];

/** Purely decorative machine names used in the dashboard and in example copy. */
export const MACHINE_FLAVOUR: Record<string, string> = {
  intake: 'Dependency Customs',
  ready: 'Scope Expansion Chamber',
  development: 'Context-Switching Crane',
  review: 'Opinion Compressor',
  test: 'Flaky-Test Detector',
  deploy: 'Release Airlock',
  done: 'Applause Dispenser',
};

export const ACROSS_FACTORY = 'all';
export const ACROSS_FACTORY_LABEL = 'Across the factory';

export const AVATARS = [
  '\u{1F469}\u200D\u{1F527}',
  '\u{1F468}\u200D\u{1F527}',
  '\u{1F9D1}\u200D\u{1F527}',
  '\u{1F469}\u200D\u{1F4BB}',
  '\u{1F468}\u200D\u{1F4BB}',
  '\u{1F9D1}\u200D\u{1F4BB}',
  '\u{1F469}\u200D\u{1F52C}',
  '\u{1F468}\u200D\u{1F52C}',
  '\u{1F977}',
  '\u{1F916}',
  '\u{1F9B8}',
  '\u{1F43F}\uFE0F',
];

export const CONDITIONS = [
  'Smooth',
  'Busy',
  'Jammed',
  'On Fire',
  'Mysteriously Quiet',
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_EMOJI: Record<Condition, string> = {
  Smooth: '\u{1F7E2}',
  Busy: '\u{1F7E1}',
  Jammed: '\u{1F7E0}',
  'On Fire': '\u{1F525}',
  'Mysteriously Quiet': '\u{1F92B}',
};

export const LIMITS = {
  playerName: 24,
  factoryName: 40,
  roomCode: 4,
  title: 80,
  description: 400,
  note: 300,
  upgradeName: 60,
  upgradeText: 300,
  owner: 40,
  reviewDate: 40,
  stationName: 28,
  maxPlayers: 16,
  maxUpgrades: 30,
  maxNotesPerItem: 60,
  minSignalLength: 12,
} as const;

export const MAX_BOOSTERS = 2;
export const MAX_BOTTLENECKS = 2;
export const MAX_WILDCARDS = 1;

export const INSPECTION_TOKENS = 4;
export const GEAR_COINS = 10;
export const MAX_PURCHASES = 2;
export const MAX_UPGRADE_COST = 5;
export const MIN_UPGRADE_COST = 1;

export const DEFAULT_DISCUSSION_SECONDS = 180;
export const TIMER_EXTENSION_SECONDS = 60;

/** Deterministic simulation tuning. Documented in the README. */
export const SIM = {
  TICKS: 60,
  TICK_MS: 800,
  ARRIVALS_PER_TICK: 2,
  BASE_RATE: 2,
  WARN_QUEUE: 6,
  BOTTLENECK_STEP: 0.15,
  BOOSTER_STEP: 0.12,
  GLOBAL_SCALE: 0.5,
  WILDCARD_FIRST_TICK: 10,
  WILDCARD_SPACING: 10,
  WILDCARD_DURATION: 5,
  WILDCARD_MULTIPLIER: 0.55,
  UPGRADE_RELIEF: 0.5,
  UPGRADE_BONUS: 0.05,
  MIN_SPEED: 0.2,
  MAX_SPEED: 2.5,
} as const;

export const SIMULATION_DISCLAIMER = 'Game simulation\u2014not a delivery forecast.';

/** The one player name that may commit the retro JSON to GitHub. Case-sensitive. */
export const SAVE_PLAYER_NAME = 'Markus';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const RATE_LIMIT = {
  windowMs: 10_000,
  maxActions: 40,
  saveCooldownMs: 15_000,
  httpWindowMs: 60_000,
  httpMaxRequests: 300,
} as const;

export const ROOM_LIFETIME = {
  facilitatorGraceMs: 60_000,
  emptyRoomMs: 30 * 60_000,
  maxIdleMs: 6 * 60 * 60_000,
  janitorIntervalMs: 15_000,
} as const;
