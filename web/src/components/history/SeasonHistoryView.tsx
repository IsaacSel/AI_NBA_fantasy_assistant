'use client';

import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Group, NumberInput, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';

type SeasonRow = {
  id: number; name: string; team: string; teams: string; season: string; position: string;
  GP: number; MPG: number; FPPG: number; FP_per_36: number | null;
  PTS: number; REB: number; AST: number; STL: number; BLK: number; TOV: number;
  '3PM': number; FG_pct: number | null; '3P_pct': number | null; FT_pct: number | null; TS: number | null;
};

type SeasonSets = Record<string, SeasonRow[]>;
const DISPLAY = ['2025-26', '2024-25', '2023-24', '2022-23', '2021-22', '2020-21', '2019-20', '2018-19'];

function fixed(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toFixed(2) : '–';
}
export function SeasonHistoryView() {
  const [records, setRecords] = useState<SeasonSets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState('2025-26');
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<string | null>(null);
  const [minGp, setMinGp] = useState<number>(1);
  useEffect(() => {
    fetch('/api/history')
      .then((r) => { if (!r.ok) throw new Error('Could not load season history'); return r.json(); })
      .then((data: { seasons: SeasonSets }) => setRecords(data.seasons))
      .catch((e: Error) => setError(e.message));
  }, []);
  const players = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (records?.[season] ?? [])
      .filter((p) => p.GP >= minGp && (!position || (p.position ?? 'UNK').split('/').includes(position)) && (!q || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q) || p.teams.toLowerCase().includes(q)))
      .sort((a, b) => b.FPPG - a.FPPG);
  }, [records, season, search, minGp, position]);
  return <Stack gap="md">
    <div><Title order={2}>Season-by-season player averages</Title>
      <Text c="dimmed" size="sm">2018–19 to 2025–26 · Uploaded season CSVs · regular-season averages. FPPG is calculated using your league scoring system.</Text></div>
    <Card withBorder p="md">
      <Group align="end" gap="sm">
        <Select label="Season" data={DISPLAY} value={season} onChange={(v) => v && setSeason(v)} w={160} allowDeselect={false} />
        <Select label="Position" data={['G','F','C']} value={position} onChange={setPosition} clearable placeholder="All" w={100}/>
        <TextInput label="Search player or team" placeholder="e.g. Luka" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={260}/>
        <NumberInput label="Minimum games" value={minGp} min={1} max={82} w={140} onChange={(v) => setMinGp(typeof v === 'number' ? v : 1)}/>
        <Text size="sm" c="dimmed">{players.length} players</Text>
      </Group>
    </Card>
    {error && <Alert color="red">{error}</Alert>}
    {!records && !error && <Text>Loading local season averages…</Text>}
    {records && <Card withBorder p="xs"><ScrollArea>
      <Table striped highlightOnHover stickyHeader miw={1100} fz="sm" verticalSpacing={5}>
        <Table.Thead><Table.Tr>
          {['#','Player','Position','Team(s)','GP','MPG','FPPG','PTS','REB','AST','STL','BLK','TOV','3PM','FG%','3P%','FT%','TS%'].map((name) => <Table.Th key={name}>{name}</Table.Th>)}
        </Table.Tr></Table.Thead>
        <Table.Tbody>{players.map((p,i) => <Table.Tr key={p.id}>
          <Table.Td>{i+1}</Table.Td>
          <Table.Td><Text fw={600} size="sm">{p.name}</Text></Table.Td>
          <Table.Td>{p.position ?? 'UNK'}</Table.Td>
          <Table.Td>{p.teams || p.team}</Table.Td><Table.Td>{p.GP}</Table.Td><Table.Td>{fixed(p.MPG)}</Table.Td>
          <Table.Td fw={600}>{fixed(p.FPPG)}</Table.Td>
          {[p.PTS,p.REB,p.AST,p.STL,p.BLK,p.TOV,p['3PM']].map((n,j) => <Table.Td key={j}>{fixed(n)}</Table.Td>)}
          {[p.FG_pct,p['3P_pct'],p.FT_pct,p.TS].map((n,j) => <Table.Td key={j}>{n === null ? '–' : (100*n).toFixed(1)+'%'}</Table.Td>)}
        </Table.Tr>)}</Table.Tbody>
      </Table>
    </ScrollArea></Card>}
    <Alert color="blue" title="Data limitations">Broad G/F/C player positions come from Kaggle Players.csv; PG/SG/SF/PF platform-specific eligibility is not available. The mock draft uses broad-category lineup slots. Future schedules are still unavailable, so weekly streaming requires a separately permitted schedule source. Historical players not present in 2025–26 appear in this table but do not have a current player profile.</Alert>
  </Stack>;
}
