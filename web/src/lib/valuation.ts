import type { League, Player, Strategy, UserData } from '@/lib/types';

export const STRATEGIES: Record<Strategy, { label: string; description: string }> = {
  balanced: {
    label: 'ML + history',
    description: 'Blends a next-game machine-learning projection (70%) with a historical season baseline (30%) when enough games are available.',
  },
  upside: {
    label: 'Upside',
    description: 'Boost toward the empirical 90th-percentile nightly performance; not a calibrated forecast interval.',
  },
  safe: {
    label: 'Low risk',
    description: 'Discounts the draft projection using observed nightly volatility and missed-game history.',
  },
  last_season: {
    label: 'Last season',
    description: '2025-26 observed fantasy points per game; no future-season adjustment.',
  },
};

export interface ValuedPlayer extends Player {
  /** FPPG after the user's adjustment and the chosen strategy. */
  strategyFppg: number;
  gamesPlayed: number;
  /** Fantasy points above a freely available replacement over the season. */
  value: number;
  rank: number;
  /** Proxy draft rank based on recent on-court production, NOT an external ADP. */
  marketRank: number;
  adjustment: number;
}

export interface Slot {
  key: string;
  accepts: (player: Player) => boolean;
}

const SEASON_GAMES = 82;
const REPLACEMENT_POOL_SIZE = 2; // Waiver pool depth per team used to set replacement level.

export function rosterSize(league: League): number {
  // Every starter and bench slot is drafted; injured reserve is not.
  return Object.entries(league.positions)
    .filter(([key]) => key !== 'IR')
    .reduce((sum, [, rule]) => sum + rule.starters, 0);
}

/** Starting lineup slots, most restrictive first so the lineup fills sensibly. */
export function starterSlots(league: League): Slot[] {
  const slots: Slot[] = [];
  const order = Object.entries(league.positions)
    .filter(([key, rule]) => key !== 'BE' && key !== 'IR' && rule.starters > 0)
    .sort(([a], [b]) => slotFlexibility(a) - slotFlexibility(b));
  for (const [key, rule] of order) {
    for (let i = 0; i < rule.starters; i++) {
      slots.push({
        key,
        accepts: (player) => key === 'UTIL' || player.eligible.includes(key),
      });
    }
  }
  return slots;
}

function slotFlexibility(key: string): number {
  if (key === 'UTIL') {
    return 3;
  }
  if (key.includes('/') || key === 'G' || key === 'F') {
    return 2;
  }
  return 1;
}

/** Positions with a roster maximum (e.g. at most 4 centers). */
export function positionLimits(league: League): Record<string, number> {
  return Object.fromEntries(
    Object.entries(league.positions)
      .filter(([, rule]) => typeof rule.maximum === 'number')
      .map(([key, rule]) => [key, rule.maximum as number]),
  );
}

function strategyFppg(player: Player, strategy: Strategy, adjustment: number): number {
  const base = player.model.fppg + adjustment;
  switch (strategy) {
    case 'balanced':
      return base;
    case 'upside':
      return base + 0.5 * (player.upside_fppg - player.model.fppg);
    case 'safe':
      return base * (1 - 0.25 * player.risk);
    case 'last_season':
      return (player.season_2026?.FPPG ?? player.model.fppg) + adjustment;
  }
}

/**
 * Value every player as fantasy points above replacement over the season.
 *
 * Replacement level is the average FPPG of the best players left after every
 * team fills its roster: who you could pick up off waivers. Missed games are
 * assumed to be filled at that level (by a bench player or a streamer), so a
 * player's value is (FPPG - replacement) x games played.
 */
export function valuePlayers(
  players: Player[],
  league: League,
  user: UserData | null,
  strategy: Strategy,
  teams: number,
): {
  players: ValuedPlayer[];
  replacementFppg: number;
} {
  const withFppg = players.map((player) => {
    const adjustment = user?.players[String(player.id)]?.adjustment ?? 0;
    return {
      player,
      adjustment,
      fppg: strategyFppg(player, strategy, adjustment),
      games: strategy === 'safe'
        ? Math.min(player.model.gp ?? 60, SEASON_GAMES) * (1 - 0.15 * player.risk)
        : Math.min(player.model.gp ?? 60, SEASON_GAMES),
    };
  });

  const byFppg = [...withFppg].sort((a, b) => b.fppg - a.fppg);
  const drafted = teams * rosterSize(league);
  const pool = byFppg.slice(drafted, drafted + teams * REPLACEMENT_POOL_SIZE);
  const replacementFppg = pool.length
    ? pool.reduce((sum, entry) => sum + entry.fppg, 0) / pool.length
    : 0;

  const marketOrder = [...players].sort((a, b) => marketSortKey(a) - marketSortKey(b));
  const marketRank = new Map(marketOrder.map((player, i) => [player.id, i + 1]));

  const valued = withFppg
    .map(({ player, adjustment, fppg, games }) => ({
      ...player,
      adjustment,
      strategyFppg: round1(fppg),
      gamesPlayed: Math.round(games),
      value: Math.round((fppg - replacementFppg) * games),
      rank: 0,
      marketRank: marketRank.get(player.id) ?? players.length,
    }))
    .sort((a, b) => b.value - a.value);
  valued.forEach((player, i) => {
    player.rank = i + 1;
  });
  return {
    players: valued,
    replacementFppg: round1(replacementFppg),
  };
}

/** CPU draft proxy uses recent fantasy production, with no third-party market ADP. */
function marketSortKey(player: Player): number {
  if (player.adp !== null) {
    return player.adp;
  }
  return 1000 - (player.season_2026?.FPPG ?? player.model.fppg) * 0.9;
}

export interface Lineup {
  starters: { slot: string; player: ValuedPlayer | null }[];
  bench: ValuedPlayer[];
  starterFppg: number;
}

/** Fill the starting lineup greedily: best players first, into their most restrictive open slot. */
export function buildLineup(roster: ValuedPlayer[], league: League): Lineup {
  const slots = starterSlots(league);
  const filled: (ValuedPlayer | null)[] = slots.map(() => null);
  const bench: ValuedPlayer[] = [];
  for (const player of [...roster].sort((a, b) => b.strategyFppg - a.strategyFppg)) {
    const index = slots.findIndex((slot, i) => filled[i] === null && slot.accepts(player));
    if (index === -1) {
      bench.push(player);
    } else {
      filled[index] = player;
    }
  }
  return {
    starters: slots.map((slot, i) => ({ slot: slot.key, player: filled[i] })),
    bench,
    starterFppg: round1(filled.reduce((sum, player) => sum + (player?.strategyFppg ?? 0), 0)),
  };
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
