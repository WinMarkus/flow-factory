import type { Condition, Phase } from './constants.js';

export type SubmissionKind = 'booster' | 'bottleneck' | 'wildcard';

export interface Station {
  id: string;
  name: string;
  emoji: string;
}

export interface MergedSource {
  title: string;
  description: string;
}

/** Submission as exposed to clients and snapshots - never carries an author. */
export interface PublicSubmission {
  id: string;
  kind: SubmissionKind;
  title: string;
  description: string;
  station: string;
  impact: 1 | 2 | 3;
  mergedFrom: MergedSource[];
}

export interface CheckIn {
  avatar: string;
  energy: 1 | 2 | 3 | 4 | 5;
  condition: Condition;
}

export interface CheckInAggregate {
  submitted: number;
  total: number;
  averageEnergy: number | null;
  energyCounts: Record<string, number>;
  conditionCounts: Record<string, number>;
}

export interface Upgrade {
  id: string;
  name: string;
  problem: string;
  experiment: string;
  signal: string;
  cost: number;
  owner: string;
  reviewDate: string;
  station: string;
}

export interface DiscussionNote {
  id: string;
  itemId: string;
  text: string;
  createdAt: number;
}

export interface TimerState {
  durationSeconds: number;
  running: boolean;
  /** Epoch ms when the timer ends; null while paused or unset. */
  endsAt: number | null;
  remainingSeconds: number;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  connected: boolean;
  isFacilitator: boolean;
  checkedIn: boolean;
  readyBuild: boolean;
  readyInspect: boolean;
  readyShop: boolean;
}

export interface StationFrame {
  id: string;
  queue: number;
  processed: number;
  speed: number;
  warning: boolean;
}

export interface SimEvent {
  tick: number;
  station: string;
  title: string;
  kind: 'wildcard' | 'booster' | 'upgrade';
}

export interface SimFrame {
  tick: number;
  stations: StationFrame[];
  throughput: number;
  wip: number;
  waitIndex: number;
  activeEvents: SimEvent[];
}

export interface ContributionSummary {
  id: string;
  title: string;
  station: string;
  impact: number;
  effectPercent: number;
}

export interface SimSummary {
  throughput: number;
  largestQueue: { station: string; value: number };
  averageWaitIndex: number;
  warningLights: number;
  warningStations: string[];
  topBoosters: ContributionSummary[];
  topBottlenecks: ContributionSummary[];
  affectedStations: string[];
  stationSpeeds: Record<string, number>;
}

export interface SimulationResult {
  id: 'first' | 'second';
  frames: SimFrame[];
  summary: SimSummary;
  upgradesApplied: string[];
}

export interface PlaybackState {
  run: 'first' | 'second' | null;
  tick: number;
  playing: boolean;
  finished: boolean;
}

export type SaveStatus = 'idle' | 'working' | 'success' | 'error';

export interface SaveState {
  status: SaveStatus;
  message: string;
  url: string | null;
  path: string | null;
  savedAt: number | null;
}

export interface InspectionResult {
  itemId: string;
  tokens: number;
}

export interface BasketSupport {
  upgradeId: string;
  supporters: number;
  coinsCommitted: number;
}

export interface GameStateView {
  code: string;
  factoryName: string;
  phase: Phase;
  createdAt: number;
  you: {
    id: string;
    name: string;
    avatar: string;
    isFacilitator: boolean;
    canSaveToGitHub: boolean;
  };
  players: PlayerView[];
  stations: Station[];
  checkin: CheckInAggregate & { mine: CheckIn | null };
  build: {
    mine: PublicSubmission[];
    revealed: boolean;
    items: PublicSubmission[];
  };
  inspect: {
    tokensPerPlayer: number;
    myAllocations: Record<string, number>;
    closed: boolean;
    results: InspectionResult[];
    focusItemId: string | null;
    notes: DiscussionNote[];
    timer: TimerState;
  };
  shop: {
    coins: number;
    upgrades: Upgrade[];
    myBasket: string[];
    revealed: boolean;
    support: BasketSupport[];
    basketsSubmitted: number;
    purchased: string[];
  };
  runs: {
    first: SimulationResult | null;
    second: SimulationResult | null;
  };
  playback: PlaybackState;
  save: {
    visible: boolean;
    githubConfigured: boolean;
    state: SaveState;
  };
}

/* ---------------------------------------------------------------- snapshot */

export interface SnapshotUpgrade extends Upgrade {
  supporters: number;
  purchased: boolean;
}

export interface SnapshotMetrics {
  throughput: number;
  largestQueue: { station: string; value: number };
  averageWaitIndex: number;
  warningLights: number;
  affectedStations: string[];
}

export interface RetroSnapshot {
  app: string;
  schemaVersion: number;
  disclaimer: string;
  room: {
    code: string;
    factoryName: string;
    createdAt: string;
    savedAt: string;
    phase: Phase;
  };
  participants: string[];
  checkIn: CheckInAggregate;
  stations: Station[];
  boosters: PublicSubmission[];
  bottlenecks: PublicSubmission[];
  wildcards: PublicSubmission[];
  mergedItems: Array<{ id: string; title: string; mergedFrom: MergedSource[] }>;
  inspectionAllocations: Array<{
    itemId: string;
    title: string;
    kind: SubmissionKind;
    station: string;
    tokens: number;
  }>;
  discussionNotes: Array<{ itemId: string; title: string; notes: string[] }>;
  upgradeProposals: SnapshotUpgrade[];
  shoppingResults: {
    coins: number;
    basketsSubmitted: number;
    support: BasketSupport[];
  };
  purchasedUpgrades: Array<{
    id: string;
    name: string;
    problem: string;
    experiment: string;
    signal: string;
    cost: number;
    owner: string;
    reviewDate: string;
    station: string;
  }>;
  metrics: {
    before: SnapshotMetrics | null;
    after: SnapshotMetrics | null;
  };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}
