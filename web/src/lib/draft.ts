import type { DraftPick, League } from '@/lib/types';
import {
  buildLineup,
  positionLimits,
  rosterSize,
  type ValuedPlayer,
} from '@/lib/valuation';

export interface DraftConfig {
  teams: number;
  /** Zero-based index of the user's team. */
  myTeam: number;
  rounds: number;
  /** Late rounds treated as streaming spots: drafted for upside, since they'll be cycled anyway. */
  streamingRounds: number;
  seed: number;
}

export interface Recommendation {
  player: ValuedPlayer;
  score: number;
  fillsStarter: boolean;
  starterGain: number;
  chanceAvailableNextPick: number;
  marketDiff: number;
  reasons: string[];
}

// CPU teams pick one of the top few players by market rank with these odds.
const CPU_PICK_WEIGHTS = [0.45, 0.25, 0.15, 0.1, 0.05];
const BENCH_DISCOUNT = 0.85;
// Among similar values, favor players unlikely to last to your next pick: score x (1 + weight x chance gone).
// Tested in simulated drafts: 0.1 raised starting-lineup FPPG by ~2 per team; a by-position "drop-off"
// rule made drafts slightly worse, since this league's flexible slots (3 UTIL, G, F) make position scarcity rare.
const URGENCY_WEIGHT = 0.1;

export function draftConfig(teams: number, draftSlot: number, league: League, streamingSlots: number, streaming: boolean): DraftConfig {
  return {
    teams,
    myTeam: Math.min(Math.max(draftSlot, 1), teams) - 1,
    rounds: rosterSize(league),
    streamingRounds: streaming ? streamingSlots : 0,
    seed: Math.floor(Math.random() * 2 ** 31),
  };
}

/** Which team picks at a given overall pick (1-based) in a snake draft. */
export function teamForPick(overall: number, teams: number): number {
  const round = Math.floor((overall - 1) / teams);
  const position = (overall - 1) % teams;
  return round % 2 === 0 ? position : teams - 1 - position;
}

export function roundForPick(overall: number, teams: number): number {
  return Math.floor((overall - 1) / teams) + 1;
}

export function totalPicks(config: DraftConfig): number {
  return config.teams * config.rounds;
}

/** The user's next pick at or after `overall`, or null if they're done. */
export function nextPickFor(team: number, overall: number, config: DraftConfig): number | null {
  for (let pick = overall; pick <= totalPicks(config); pick++) {
    if (teamForPick(pick, config.teams) === team) {
      return pick;
    }
  }
  return null;
}

export function rosterFor(team: number, picks: DraftPick[], byId: Map<number, ValuedPlayer>): ValuedPlayer[] {
  return picks
    .filter((pick) => pick.team === team)
    .map((pick) => byId.get(pick.playerId))
    .filter((player): player is ValuedPlayer => Boolean(player));
}

function withinLimits(player: ValuedPlayer, roster: ValuedPlayer[], limits: Record<string, number>): boolean {
  // Count F/C players against the center maximum as well as C-only players.
  return Object.entries(limits).every(([position, limit]) =>
    !player.eligible.includes(position) || roster.filter((p) => p.eligible.includes(position)).length < limit
  );
}

function openStarterSlots(roster: ValuedPlayer[], league: League): number {
  return buildLineup(roster, league).starters.filter((slot) => slot.player === null).length;
}

/** Players a team can still take without breaking limits or leaving starting slots unfillable. */
function eligibleFor(roster: ValuedPlayer[], available: ValuedPlayer[], league: League, config: DraftConfig): ValuedPlayer[] {
  const limits = positionLimits(league);
  const legal = available.filter((player) => withinLimits(player, roster, limits));
  const picksLeft = config.rounds - roster.length;
  const open = openStarterSlots(roster, league);
  if (picksLeft > open) {
    return legal;
  }
  // Every remaining pick must fill a starting slot.
  const fillers = legal.filter((player) => openStarterSlots([...roster, player], league) < open);
  return fillers.length ? fillers : legal;
}

/** Deterministic random numbers so a seeded mock draft can be replayed. */
export function seededRandom(seed: number, step: number): number {
  let t = (seed + step * 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function cpuPick(
  team: number,
  overall: number,
  picks: DraftPick[],
  available: ValuedPlayer[],
  byId: Map<number, ValuedPlayer>,
  league: League,
  config: DraftConfig,
): ValuedPlayer {
  const roster = rosterFor(team, picks, byId);
  const candidates = eligibleFor(roster, available, league, config)
    .sort((a, b) => a.marketRank - b.marketRank)
    .slice(0, CPU_PICK_WEIGHTS.length);
  let roll = seededRandom(config.seed, overall);
  for (let i = 0; i < candidates.length; i++) {
    roll -= CPU_PICK_WEIGHTS[i];
    if (roll <= 0) {
      return candidates[i];
    }
  }
  return candidates[0];
}

/** Rough chance a player is still there at a later pick, based on where the market drafts them. */
function chanceAvailable(player: ValuedPlayer, atPick: number): number {
  const spread = Math.max(4, player.marketRank * 0.2);
  const z = (player.marketRank - atPick) / spread;
  return 1 / (1 + Math.exp(-1.7 * z));
}

/**
 * Rank the available players for the user's pick.
 *
 * Score is season value above replacement, discounted for players who would
 * only sit on the bench, with a small boost for players unlikely to last until
 * your next pick. In the final streaming rounds, upside value is used instead,
 * since those spots get cycled for streamers anyway.
 */
export function recommend(
  overall: number,
  picks: DraftPick[],
  available: ValuedPlayer[],
  byId: Map<number, ValuedPlayer>,
  upsideById: Map<number, ValuedPlayer>,
  league: League,
  config: DraftConfig,
  limit = 12,
): Recommendation[] {
  const roster = rosterFor(config.myTeam, picks, byId);
  const currentLineup = buildLineup(roster, league);
  const round = roundForPick(overall, config.teams);
  const streamingRound = round > config.rounds - config.streamingRounds;
  const nextPick = nextPickFor(config.myTeam, overall + 1, config);
  const valueOf = (player: ValuedPlayer) => (streamingRound ? upsideById.get(player.id) ?? player : player).value;

  return eligibleFor(roster, available, league, config)
    .map((player) => {
      const lineup = buildLineup([...roster, player], league);
      const starterGain = Math.round((lineup.starterFppg - currentLineup.starterFppg) * 10) / 10;
      const fillsStarter = lineup.starters.some((slot) => slot.player?.id === player.id);
      const chanceAvailableNextPick = nextPick ? chanceAvailable(player, nextPick) : 0;
      const marketDiff = player.marketRank - player.rank;
      const chanceGone = nextPick ? 1 - chanceAvailableNextPick : 1;
      const score = valueOf(player) * (fillsStarter ? 1 : BENCH_DISCOUNT) * (1 + URGENCY_WEIGHT * chanceGone);

      const reasons: string[] = [];
      if (streamingRound) {
        reasons.push('Streaming round: drafting for upside');
      }
      if (fillsStarter && currentLineup.starters.some((slot) => slot.player === null)) {
        reasons.push('Fills an open starting slot');
      } else if (!fillsStarter) {
        reasons.push('Would start on your bench');
      }
      if (marketDiff >= 15) {
        reasons.push(`Market drafts them ${marketDiff} spots later than we rank them`);
      }
      if (nextPick && chanceAvailableNextPick < 0.25) {
        reasons.push('Likely gone by your next pick');
      } else if (nextPick && chanceAvailableNextPick > 0.75) {
        reasons.push('Likely still there next pick');
      }
      return {
        player,
        score,
        fillsStarter,
        starterGain,
        chanceAvailableNextPick,
        marketDiff,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Run a whole draft with the user's team auto-picking the top recommendation.
 * `available` order doesn't matter; picks are returned in draft order.
 */
export function simulateDraft(
  players: ValuedPlayer[],
  upsideById: Map<number, ValuedPlayer>,
  league: League,
  config: DraftConfig,
): DraftPick[] {
  const byId = new Map(players.map((player) => [player.id, player]));
  const taken = new Set<number>();
  const picks: DraftPick[] = [];
  for (let overall = 1; overall <= totalPicks(config); overall++) {
    const team = teamForPick(overall, config.teams);
    const available = players.filter((player) => !taken.has(player.id));
    const choice = team === config.myTeam
      ? recommend(overall, picks, available, byId, upsideById, league, config, 1)[0]?.player
      : cpuPick(team, overall, picks, available, byId, league, config);
    if (!choice) {
      break;
    }
    taken.add(choice.id);
    picks.push({
      overall,
      round: roundForPick(overall, config.teams),
      team,
      playerId: choice.id,
    });
  }
  return picks;
}

export interface TeamResult {
  team: number;
  roster: ValuedPlayer[];
  starterFppg: number;
  rank: number;
}

/** Compare every team's projected starting lineup at the end of a draft. */
export function draftResults(picks: DraftPick[], byId: Map<number, ValuedPlayer>, league: League, config: DraftConfig): TeamResult[] {
  const results = Array.from({ length: config.teams }, (_, team) => {
    const roster = rosterFor(team, picks, byId);
    return {
      team,
      roster,
      starterFppg: buildLineup(roster, league).starterFppg,
      rank: 0,
    };
  }).sort((a, b) => b.starterFppg - a.starterFppg);
  results.forEach((result, i) => {
    result.rank = i + 1;
  });
  return results;
}
