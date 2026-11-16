'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Center, Loader, Stack, Text } from '@mantine/core';
import type { League, Player } from '@/lib/types';

interface AppData {
  players: Player[];
  league: League;
  byId: Map<number, Player>;
}
const Context = createContext<AppData | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<{ players: Player[]; league: League } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/players', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Unable to load player data (HTTP ${response.status})`);
        return response.json() as Promise<{ players: Player[]; league: League }>;
      })
      .then(setData)
      .catch((err: Error) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, []);
  const value = useMemo(() => data
    ? { ...data, byId: new Map(data.players.map(p => [p.id, p] as const)) }
    : null, [data]);
  if (error) return <Alert color="red" title="Data could not be loaded"><Stack gap="xs"><Text>{error}</Text><Text size="sm">Run <code>./refresh_data.sh</code> from the repository root.</Text></Stack></Alert>;
  if (!value) return <Center mih={280}><Loader size="lg" /></Center>;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAppData(): AppData {
  const data = useContext(Context);
  if (!data) throw new Error('useAppData requires AppDataProvider');
  return data;
}
