'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Card, Group, Loader, NumberInput, Select, Stack, Table, Text, Title,
} from '@mantine/core';

const SEASONS = ['2025-26','2024-25','2023-24','2022-23','2021-22','2020-21','2019-20','2018-19'];

type Game = {
  Date: string; GameID: number; Opponent: string; Team: string; Home: number;
  MIN: number; PTS: number; REB: number; AST: number; STL: number; BLK: number;
  TOV: number; '3PM': number; FPTS: number; Win: number;
};

export function GameLogsPanel({ playerId }: { playerId: number }) {
  const [season, setSeason] = useState('2025-26');
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(30);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/game-logs/${playerId}?season=${season}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load game logs');
        const data = await res.json() as { games: Game[] };
        setGames(data.games);
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [playerId, season]);

  const sorted = useMemo(() => [...games].sort((a,b) => b.Date.localeCompare(a.Date) || b.GameID-a.GameID), [games]);
  const recent = sorted.slice(0,10);
  const avg = recent.length ? recent.reduce((s,g) => s+g.FPTS,0)/recent.length : null;
  const avgSeason = games.length ? games.reduce((s,g) => s+g.FPTS,0)/games.length : null;

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={4}>Individual game logs</Title>
            <Text c="dimmed" size="xs">Actual game-by-game box scores from uploaded Kaggle data · points under your league scoring rules.</Text>
          </div>
          <Group align="flex-end" gap="sm">
            <Select label="Season" w={120} data={SEASONS} value={season} onChange={v => v && setSeason(v)} />
            <NumberInput label="Rows" w={90} min={5} max={100} value={showCount} onChange={v => typeof v==='number' && setShowCount(v)} />
          </Group>
        </Group>
        {loading ? <Loader size="sm" /> : error ? <Alert color="red">{error}</Alert> : games.length===0 ? (
          <Alert color="gray">No games found for this player in {season}.</Alert>
        ) : (
          <>
            <Group gap="xs">
              <Badge variant="light">{games.length} games</Badge>
              <Badge color="blue" variant="light">Season {avgSeason?.toFixed(1)} FP/game</Badge>
              <Badge color="teal" variant="light">Last 10: {avg?.toFixed(1)} FP/game</Badge>
            </Group>
            <Table.ScrollContainer minWidth={870}>
              <Table striped highlightOnHover fz="sm" verticalSpacing={5}>
                <Table.Thead><Table.Tr>
                  {['Date','Matchup','MIN','PTS','REB','AST','STL','BLK','TO','3PM','Fantasy pts'].map(h => <Table.Th key={h}>{h}</Table.Th>)}
                </Table.Tr></Table.Thead>
                <Table.Tbody>
                  {sorted.slice(0,showCount).map(g => (
                    <Table.Tr key={g.GameID}>
                      <Table.Td>{g.Date}</Table.Td>
                      <Table.Td>{g.Home===1?'vs':'@'} {g.Opponent}</Table.Td>
                      <Table.Td>{g.MIN}</Table.Td><Table.Td>{g.PTS}</Table.Td><Table.Td>{g.REB}</Table.Td>
                      <Table.Td>{g.AST}</Table.Td><Table.Td>{g.STL}</Table.Td><Table.Td>{g.BLK}</Table.Td>
                      <Table.Td>{g.TOV}</Table.Td><Table.Td>{g['3PM']}</Table.Td>
                      <Table.Td fw={700}>{g.FPTS.toFixed(1)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {games.length > showCount && <Text size="xs" c="dimmed">Showing newest {showCount} of {games.length} games. Raise the row limit to display more.</Text>}
          </>
        )}
      </Stack>
    </Card>
  );
}
