import type { NextRequest } from 'next/server';
import { connection } from 'next/server';

import { readUserData, updateUserData } from '@/lib/server/userStore';
import type { UserOperation } from '@/lib/types';

const OPERATIONS = new Set<UserOperation['op']>([
  'setPlayer',
  'addNote',
  'deleteNote',
  'setSettings',
  'saveDraft',
  'deleteDraft',
  'liveDraftPick',
  'liveDraftUndo',
  'liveDraftReset',
]);

export async function GET() {
  // The store changes between requests, so never prerender it.
  await connection();
  return Response.json(await readUserData());
}

export async function PATCH(request: NextRequest) {
  const operation = (await request.json()) as UserOperation;
  if (!operation || !OPERATIONS.has(operation.op)) {
    return Response.json({ error: 'Unknown operation' }, { status: 400 });
  }
  return Response.json(await updateUserData(operation));
}
