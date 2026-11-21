import { getLeague, getPlayers } from '@/lib/server/data';

export async function GET() {
  const [players, league] = await Promise.all([
    getPlayers(),
    getLeague(),
  ]);
  return Response.json({ players, league });
}
