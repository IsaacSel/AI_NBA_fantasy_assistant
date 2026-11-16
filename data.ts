import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { League, Player } from '@/lib/types';

const dataRoot = process.env.DATA_DIR ?? path.resolve(process.cwd(), '..', 'data');
const dataDir = path.join(dataRoot, 'app');
const cache = new Map<string, { mtime: number; value: unknown }>();
async function readJson<T>(filename: string): Promise<T> {
  const filenameOnDisk = path.join(dataDir, filename);
  const { mtimeMs } = await stat(filenameOnDisk);
  const saved = cache.get(filenameOnDisk);
  if (saved?.mtime === mtimeMs) return saved.value as T;
  const value = JSON.parse(await readFile(filenameOnDisk, 'utf-8')) as T;
  cache.set(filenameOnDisk, { mtime: mtimeMs, value });
  return value;
}
export const getPlayers = () => readJson<Player[]>('players.json');
export const getLeague = () => readJson<League>('league.json');
