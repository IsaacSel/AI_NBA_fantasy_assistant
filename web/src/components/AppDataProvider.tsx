'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type {
  League,
  Player,
  Strategy,
  UserData,
  UserOperation,
} from '@/lib/types';
import { valuePlayers, type ValuedPlayer } from '@/lib/valuation';

interface AppData {
  players: Player[];
  league: League;
  user: UserData;
  /** Players valued with the saved strategy and league size. */
  valued: ValuedPlayer[];
  replacementFppg: number;
  updateUser: (operation: UserOperation) => Promise<void>;
  valueWith: (strategy: Strategy, teams: number) => ReturnType<typeof valuePlayers>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; players: Player[]; league: League; user: UserData };

const AppDataContext = createContext<AppData | null>(null);

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `${url} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    Promise.all([
      fetchJson<{ players: Player[]; league: League }>('/api/players'),
      fetchJson<UserData>('/api/user'),
    ])
      .then(([{ players, league }, user]) => setState({
        status: 'ready',
        players,
        league,
        user,
      }))
      .catch((error: Error) => setState({
        status: 'error',
        message: error.message,
      }));
  }, []);

  const updateUser = useCallback(async (operation: UserOperation) => {
    const user = await fetchJson<UserData>('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(operation),
    });
    setState((current) => (current.status === 'ready' ? { ...current, user } : current));
  }, []);

  const value = useMemo<AppData | null>(() => {
    if (state.status !== 'ready') {
      return null;
    }
    const { players, league, user } = state;
    const valueWith = (strategy: Strategy, teams: number) => valuePlayers(players, league, user, strategy, teams);
    const { players: valued, replacementFppg } = valueWith(user.settings.strategy, user.settings.teams);
    return {
      players,
      league,
      user,
      valued,
      replacementFppg,
      updateUser,
      valueWith,
    };
  }, [state, updateUser]);

  if (state.status === 'error') {
    return (
      <div className="p-8">
        <h2 className="text-lg font-semibold">Couldn&apos;t load data</h2>
        <p className="mt-2 text-sm opacity-80">{state.message}</p>
        <p className="mt-2 text-sm opacity-80">
          Run the data pipeline first (see README), then reload.
        </p>
      </div>
    );
  }

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

/** App data, or null while it's still loading. */
export function useAppData(): AppData | null {
  return useContext(AppDataContext);
}
