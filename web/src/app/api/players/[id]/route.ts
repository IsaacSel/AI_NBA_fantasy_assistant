import type { NextRequest } from 'next/server';

import { getProfile } from '@/lib/server/data';

export async function GET(_request: NextRequest, context: RouteContext<'/api/players/[id]'>) {
  const { id } = await context.params;
  const profile = await getProfile(Number(id));
  if (!profile) {
    return Response.json({ error: `No profile for player ${id}` }, { status: 404 });
  }
  return Response.json(profile);
}
