import type { Schedule, ScheduleWeek } from '@/lib/types';
import type { ValuedPlayer } from '@/lib/valuation';

// A game on a light day is worth more: fewer of your own starters play, so the streamer actually fills a slot.
const LIGHT_DAY_BONUS = 0.25;

export interface StreamerOption {
  player: ValuedPlayer;
  games: number;
  lightGames: number;
  projectedPoints: number;
  score: number;
}

/** The fantasy week containing a date, or the first week if the season hasn't started. */
export function currentWeek(schedule: Schedule, today = new Date()): ScheduleWeek {
  const iso = today.toISOString().slice(0, 10);
  return schedule.weeks.find((week) => iso <= week.end) ?? schedule.weeks[schedule.weeks.length - 1];
}

/**
 * Players likely to be on waivers in a league of this size: everyone outside
 * the top (teams x roster size) by market rank, which is how leaguemates draft.
 */
export function likelyAvailable(players: ValuedPlayer[], teams: number, rosterSize: number): ValuedPlayer[] {
  const rostered = teams * rosterSize;
  return players.filter((player) => player.marketRank > rostered && player.team !== 'FA' && player.injury !== 'OUT');
}

export function streamersForWeek(players: ValuedPlayer[], week: ScheduleWeek, limit = 25): StreamerOption[] {
  return players
    .map((player) => {
      const { games = 0, light = 0 } = week.teams[player.team] ?? {};
      const projectedPoints = player.strategyFppg * games;
      return {
        player,
        games,
        lightGames: light,
        projectedPoints: Math.round(projectedPoints),
        score: Math.round(projectedPoints + LIGHT_DAY_BONUS * player.strategyFppg * light),
      };
    })
    .filter((option) => option.games > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Teams ranked by games (then light-day games) in a week. */
export function teamsByGames(week: ScheduleWeek): { team: string; games: number; light: number }[] {
  return Object.entries(week.teams)
    .map(([team, counts]) => ({ team, ...counts }))
    .sort((a, b) => b.games - a.games || b.light - a.light || a.team.localeCompare(b.team));
}
