// All basketball data is read from the user's Kaggle 2025-26 season-averages CSV.
export const METRICS = [
  'MPG', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'TOPG',
  'FGM/G', 'FGA/G', 'FG%', '3PM/G', '3PA/G', '3P%',
  'FTM/G', 'FTA/G', 'FT%', 'OREB/G', 'DREB/G', 'PF/G',
] as const;
export type Metric = typeof METRICS[number];

export interface Player {
  /** Original NBA Player ID from Kaggle, not an ESPN ID. */
  id: number;
  name: string;
  team: string;
  teams: string[];
  gp: number;
  mpg: number;
  stats: Record<Metric, number | null>;
  fppg: number;
  /** FPPG times GP: estimated from rounded averages, not official totals. */
  season_fpts: number;
  fp_per36: number | null;
  breakdown: Record<string, number>;
  rank: number;
}

export interface League {
  source: string;
  season: string;
  kind: 'historical_per_game_averages';
  player_count: number;
  generated_at: string;
  scoring: Record<string, number>;
  note: string;
}

export interface DraftPick {
  playerId: number;
  mine: boolean;
}
