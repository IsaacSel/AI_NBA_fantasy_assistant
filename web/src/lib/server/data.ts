import 'server-only';

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { League, Player, Profile, Schedule } from '@/lib/types';

// The Python pipeline writes to <repo>/data; the app runs from <repo>/web.
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data');
const APP_DATA_DIR = path.join(DATA_DIR, 'app');

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

/** Read a JSON file from data/app, re-reading only when the pipeline has rewritten it. */
async function readAppJson<T>(fileName: string): Promise<T> {
  const filePath = path.join(APP_DATA_DIR, fileName);
  const { mtimeMs } = await stat(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value as T;
  }
  const value = JSON.parse(await readFile(filePath, 'utf8')) as T;
  cache.set(filePath, { mtimeMs, value });
  return value;
}

export function getPlayers(): Promise<Player[]> {
  return readAppJson<Player[]>('players.json');
}

export function getLeague(): Promise<League> {
  return readAppJson<League>('league.json');
}

export function getSchedule(): Promise<Schedule> {
  return readAppJson<Schedule>('schedule.json');
}

export async function getProfile(id: number): Promise<Profile | null> {
  const profiles = await readAppJson<Record<string, Profile>>('profiles.json');
  return profiles[String(id)] ?? null;
}

/** Individual game logs from user-provided Kaggle CSV files (no external requests). */
export interface GameLogLine {
  Date: string;
  GameID: number;
  Player: string;
  Team: string;
  Opponent: string;
  Home: number;
  Win: number;
  MIN: number;
  PTS: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  TOV: number;
  FGM: number;
  FGA: number;
  '3PM': number;
  '3PA': number;
  FTM: number;
  FTA: number;
  FPTS: number;
}

export async function getPlayerGameLogs(id: number, season: string): Promise<GameLogLine[]> {
  const data = await readAppJson<Record<string, GameLogLine[]>>(`game_logs_by_season/${season}.json`);
  return data[String(id)] ?? [];
}

export type GameLogModelMetrics = {
  model: string;
  target: string;
  training_seasons: string[];
  test_season: string;
  training_games: number;
  test_games: number;
  model_mae: number;
  baseline_last10_mae: number;
  model_rmse: number;
  coverage_note: string;
  projection_note: string;
};

export function getModelMetrics(): Promise<GameLogModelMetrics> {
  return readAppJson<GameLogModelMetrics>('model_metrics.json');
}
