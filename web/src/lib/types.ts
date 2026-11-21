// Shapes of the data written by the Python pipeline (data/app/) and the user store (data/user/).

export interface PlayerModel {
  fppg: number;
  ml_next_game?: number | null;
  transformer_next_game?: number | null;
  gb_next_game?: number | null;
  prediction_method?: string;
  mpg: number | null;
  gp: number | null;
  rate: number | null;
  total: number | null;
  floor_fppg: number;
  ceiling_fppg: number;
  changed_team: boolean;
  low_confidence: boolean;
}

/** The current injury report for a player (build_app_data.injury_reports). */
export interface InjuryReport {
  status: string;
  injury: string | null;
  return_date: string | null;
  reported: string | null;
  comment: string | null;
  term: 'rest' | 'day-to-day' | 'short term' | 'weeks' | 'long term' | 'no timeline';
  games_missed: number | null;
}

export interface SeasonLine {
  GP: number;
  MPG: number;
  FPPG: number;
  FP_per_36: number | null;
  start_rate: number | null;
}

export interface Player {
  id: number;
  name: string;
  position: string;
  position_source?: string;
  eligible: string[];
  team: string;
  team_2026: string | null;
  rookie: {
    pick: number | null;
    college: string | null;
  } | null;
  adp: number | null;
  owned: number | null;
  injury: string | null;
  injury_report: InjuryReport | null;
  model: PlayerModel;
  upside_fppg: number;
  upside_reasons: string[];
  risk: number;
  risk_reasons: string[];
  volatility: number | null;
  floor: number | null;
  ceiling: number | null;
  season_2026: SeasonLine | null;
  fppg_rank_2026: number | null;
  preseason: {
    GP: number;
    MPG: number;
    FPPG: number;
    FP_per_36: number | null;
  } | null;
  archetypes: string[];
  headline_notes: string[];
}

export interface BacktestMetrics {
  players: number;
  fppg_mae: number;
  total_mae: number;
  rank_corr: number;
  top100_hit: number;
  below_floor?: number;
  above_ceiling?: number;
}

export interface BacktestSeason {
  trained_on: number[];
  ours: BacktestMetrics;
  marcel: BacktestMetrics;
  last_season: BacktestMetrics;
}

export interface PositionRule {
  starters: number;
  maximum: number | null;
  name: string;
}

export interface League {
  scoring: Record<string, number>;
  positions: Record<string, PositionRule>;
  built_at: string;
  backtest: Record<string, BacktestSeason> | null;
}

export interface ScheduleWeek {
  week: number;
  start: string;
  end: string;
  teams: Record<string, {
    games: number;
    light: number;
  }>;
}

export interface Schedule {
  weeks: ScheduleWeek[];
  games_per_day: Record<string, number>;
  light_day_max_games: number;
}

// Profiles are large and deeply nested; the player page reads them defensively.
export interface Split {
  GP: number;
  MPG: number;
  FPPG: number;
  FP_per_36: number | null;
  start_rate: number | null;
  FPPG_vs_avg?: number;
  FP36_vs_avg?: number;
  typical?: number;
  FP36_vs_typical?: number;
}

export interface TeammateEffect {
  teammate: string;
  teammate_id: number;
  team: string;
  with: Split;
  without: Split;
  FPPG_change_when_out: number;
  FP36_change_when_out: number;
  MPG_change_when_out: number;
  start_rate_change_when_out: number;
}

export interface OpponentSplit extends Split {
  opponent: string;
}

export interface Profile {
  id: number;
  name: string;
  position: string;
  position_source?: string;
  eligible_positions: string[] | null;
  team_2026: string | null;
  teams_2026: string[];
  rookie?: {
    draft: {
      year: number;
      round: number;
      pick: number;
    } | null;
    college: string | null;
    age: number | null;
  };
  season_2026?: Split & {
    FPPG_rank: number | null;
    per_game: Record<string, number>;
    FG_pct: number | null;
    '3P_pct': number | null;
    FT_pct: number | null;
    TS: number | null;
  };
  per_36?: Record<string, number | null>;
  league_percentiles?: Record<string, number | null>;
  low_minutes_sample?: boolean;
  archetypes?: string[];
  fp_breakdown?: Record<string, number>;
  team_share_when_playing?: {
    FPTS: number | null;
    PTS: number | null;
  };
  consistency?: {
    mean: number;
    median: number;
    std_dev: number;
    floor_p10: number;
    ceiling_p90: number;
    boom_rate: number | null;
    bust_rate: number | null;
    best_game: number;
    worst_game: number;
  } | null;
  role?: {
    start_rate: number | null;
    as_starter: Split | null;
    off_bench: Split | null;
    by_month: Record<string, Split | null>;
    first_half: Split | null;
    second_half: Split | null;
    last_20_games: Split | null;
  };
  teammates?: {
    plays_best_with: TeammateEffect[];
    benefits_when_out: TeammateEffect[];
    starts_more_when_out: TeammateEffect[];
  };
  matchups?: Record<string, Split | OpponentSplit[] | null>;
  playoffs_2026?: Split;
  college_2026?: {
    college: string | null;
    GP: number;
    MPG: number;
    per_game: Record<string, number>;
    FPPG: number | null;
    FP_per_40: number | null;
    FG_pct: number | null;
    '3P_pct': number | null;
    FT_pct: number | null;
    TS: number | null;
    rookie_class_percentiles: Record<string, number | null>;
    vs_ranked: { GP: number; FPPG: number | null } | null;
    vs_unranked: { GP: number; FPPG: number | null } | null;
    postseason: { GP: number; FPPG: number | null } | null;
    best_games: {
      date: string;
      opponent: string;
      PTS: number;
      REB: number;
      AST: number;
      FPTS: number;
    }[];
  };
  outlook: {
    team_2027: string | null;
    projected_FPPG: number | null;
    projected_GP: number | null;
    preseason: {
      GP: number;
      MPG: number;
      FPPG: number;
      FP_per_36: number | null;
    } | null;
  };
  scouting_notes: string[];
  season_history?: Array<{
    id: number; name: string; season: string; team: string; teams: string; position?: string;
    GP: number; MPG: number; FPPG: number; FP_per_36: number | null;
    PTS: number; REB: number; AST: number; STL: number; BLK: number; TOV: number;
    '3PM': number; FG_pct: number | null; '3P_pct': number | null; FT_pct: number | null; TS: number | null;
  }>;
}

export type Strategy = 'balanced' | 'upside' | 'safe' | 'last_season';

export type PlayerTag = 'target' | 'sleeper' | 'avoid';

export interface PlayerNote {
  id: string;
  text: string;
  createdAt: string;
}

export interface UserPlayerData {
  adjustment?: number | null;
  tier?: number | null;
  tag?: PlayerTag | null;
  notes?: PlayerNote[];
}

export interface UserSettings {
  teams: number;
  draftSlot: number;
  strategy: Strategy;
  streaming: boolean;
  streamingSlots: number;
}

export interface SavedDraft {
  id: string;
  createdAt: string;
  name: string;
  settings: UserSettings;
  picks: DraftPick[];
  summary: {
    myRank: number;
    myStarterFppg: number;
  };
}

export interface UserData {
  settings: UserSettings;
  players: Record<string, UserPlayerData>;
  drafts: SavedDraft[];
  liveDraft: LiveDraft;
}

/** The real draft as it happens: every pick in order, by another team or by us. */
export interface LiveDraft {
  picks: LiveDraftPick[];
}

export interface LiveDraftPick {
  playerId: number;
  mine: boolean;
}

export interface DraftPick {
  overall: number;
  round: number;
  team: number;
  playerId: number;
}

export type UserOperation =
  | {
    op: 'setPlayer';
    playerId: number;
    patch: Pick<UserPlayerData, 'adjustment' | 'tier' | 'tag'>;
  }
  | {
    op: 'addNote';
    playerId: number;
    text: string;
  }
  | {
    op: 'deleteNote';
    playerId: number;
    noteId: string;
  }
  | {
    op: 'setSettings';
    patch: Partial<UserSettings>;
  }
  | {
    op: 'saveDraft';
    draft: Omit<SavedDraft, 'id' | 'createdAt'>;
  }
  | {
    op: 'deleteDraft';
    draftId: string;
  }
  | {
    op: 'liveDraftPick';
    playerId: number;
    mine: boolean;
  }
  | {
    op: 'liveDraftUndo';
    playerId: number;
  }
  | {
    op: 'liveDraftReset';
  };

// ---------------------------------------------------------------- seasons

export type SeasonType = 'simulated' | 'live';

export type SeasonPhase = 'drafting' | 'regular_season' | 'playoffs' | 'eliminated' | 'complete';

export interface StandingRow {
  team: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
}

export interface SeasonResults {
  regular_season_rank: number;
  made_playoffs: boolean;
  made_final: boolean;
  champion: string;
  won_title: boolean;
}

export interface SeasonFile {
  id: string;
  name: string;
  type: SeasonType;
  createdAt: string;
  draftSlot: number;
  seed: number;
  phase: SeasonPhase;
  picks: DraftPick[];
  status?: {
    phase: SeasonPhase;
    date: string;
    standings: StandingRow[];
    results: SeasonResults | null;
  };
  engine?: unknown;
}

export interface SeasonSummary {
  id: string;
  name: string;
  type: SeasonType;
  phase: SeasonPhase;
  createdAt: string;
  draftSlot: number;
  picks: number;
  date: string | null;
  record: string | null;
  results: SeasonResults | null;
}

export interface SeasonRosterRow {
  id: number;
  name: string;
  team: string;
  position: string;
  slot: string;
  fppg: number;
  projected_fppg: number;
  games_played: number;
  plays_today: boolean;
  out_until: string | null;
}

export type SeasonAction =
  | { kind: 'stream'; drop: number; add: number }
  | { kind: 'ir'; stash: number; add: number }
  | { kind: 'trade'; give: number; get: number };

export interface SeasonRecommendation {
  kind: 'stream' | 'ir' | 'trade';
  title: string;
  detail: string;
  gain?: number;
  action: SeasonAction;
}

export interface SeasonLogEntry {
  day: number;
  date: string;
  kind: string;
  text: string;
  team: number;
}

export interface SeasonStatus {
  phase: SeasonPhase;
  date: string;
  day: number;
  total_days: number;
  trade_deadline: string;
  adds_used: number;
  adds_limit: number;
  matchup: {
    period: number;
    label: string;
    opponent: string;
    my_points: number;
    their_points: number;
    my_projected: number;
    their_projected: number;
    start: string | null;
    end: string | null;
    days_left: number;
  } | null;
  standings: StandingRow[];
  my_team: number;
  roster: SeasonRosterRow[];
  ir: SeasonRosterRow | null;
  recommendations: SeasonRecommendation[];
  log: SeasonLogEntry[];
  results: SeasonResults | null;
  message: string | null;
}
