import type { NextRequest } from 'next/server';
import { getPlayerGameLogs } from '@/lib/server/data';

const SEASONS = new Set(['2018-19','2019-20','2020-21','2021-22','2022-23','2023-24','2024-25','2025-26']);

export async function GET(request: NextRequest, context: RouteContext<'/api/game-logs/[id]'>) {
  const { id } = await context.params;
  if (!/^\d{1,10}$/.test(id)) {
    return Response.json({ error: 'Invalid player ID' }, { status: 400 });
  }
  const season = request.nextUrl.searchParams.get('season') ?? '2025-26';
  if (!SEASONS.has(season)) {
    return Response.json({ error: 'Invalid season' }, { status: 400 });
  }
  const games = await getPlayerGameLogs(Number(id), season);
  return Response.json({ playerId: Number(id), season, games, count: games.length });
}
