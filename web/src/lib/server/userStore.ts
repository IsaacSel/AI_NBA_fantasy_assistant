import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DATA_DIR } from '@/lib/server/data';
import type { UserData, UserOperation } from '@/lib/types';

const USER_FILE = path.join(DATA_DIR, 'user', 'user.json');

export const DEFAULT_USER_DATA: UserData = {
  settings: {
    teams: 10,
    draftSlot: 8,
    strategy: 'balanced',
    streaming: true,
    streamingSlots: 2,
  },
  players: {},
  drafts: [],
  liveDraft: { picks: [] },
};

// Serialize writes so concurrent requests can't clobber each other.
let writeQueue: Promise<unknown> = Promise.resolve();

export async function readUserData(): Promise<UserData> {
  try {
    const stored = JSON.parse(await readFile(USER_FILE, 'utf8')) as Partial<UserData>;
    return {
      settings: {
        ...DEFAULT_USER_DATA.settings,
        ...stored.settings,
        strategy: (['balanced', 'upside', 'safe', 'last_season'] as string[]).includes(String(stored.settings?.strategy))
          ? stored.settings!.strategy! : 'balanced',
      },
      players: stored.players ?? {},
      drafts: stored.drafts ?? [],
      liveDraft: stored.liveDraft ?? { picks: [] },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_USER_DATA);
    }
    throw error;
  }
}

async function writeUserData(data: UserData): Promise<void> {
  await mkdir(path.dirname(USER_FILE), { recursive: true });
  // Write to a temp file and rename so a crash never leaves a half-written store.
  const tempFile = `${USER_FILE}.${randomUUID()}.tmp`;
  await writeFile(tempFile, JSON.stringify(data, null, 2));
  await rename(tempFile, USER_FILE);
}

function applyOperation(data: UserData, operation: UserOperation): UserData {
  switch (operation.op) {
    case 'setPlayer': {
      const key = String(operation.playerId);
      data.players[key] = {
        ...data.players[key],
        ...operation.patch,
      };
      return data;
    }
    case 'addNote': {
      const key = String(operation.playerId);
      const text = operation.text.trim();
      if (!text) {
        return data;
      }
      const existing = data.players[key] ?? {};
      data.players[key] = {
        ...existing,
        notes: [
          {
            id: randomUUID(),
            text,
            createdAt: new Date().toISOString(),
          },
          ...(existing.notes ?? []),
        ],
      };
      return data;
    }
    case 'deleteNote': {
      const existing = data.players[String(operation.playerId)];
      if (existing?.notes) {
        existing.notes = existing.notes.filter((note) => note.id !== operation.noteId);
      }
      return data;
    }
    case 'setSettings':
      data.settings = {
        ...data.settings,
        ...operation.patch,
      };
      return data;
    case 'saveDraft':
      data.drafts = [
        {
          ...operation.draft,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
        },
        ...data.drafts,
      ];
      return data;
    case 'deleteDraft':
      data.drafts = data.drafts.filter((draft) => draft.id !== operation.draftId);
      return data;
    case 'liveDraftPick':
      if (!data.liveDraft.picks.some((pick) => pick.playerId === operation.playerId)) {
        data.liveDraft.picks.push({ playerId: operation.playerId, mine: operation.mine });
      }
      return data;
    case 'liveDraftUndo':
      data.liveDraft.picks = data.liveDraft.picks.filter((pick) => pick.playerId !== operation.playerId);
      return data;
    case 'liveDraftReset':
      data.liveDraft = { picks: [] };
      return data;
  }
}

export function updateUserData(operation: UserOperation): Promise<UserData> {
  const result = writeQueue.then(async () => {
    const data = applyOperation(await readUserData(), operation);
    await writeUserData(data);
    return data;
  });
  writeQueue = result.catch(() => undefined);
  return result;
}
