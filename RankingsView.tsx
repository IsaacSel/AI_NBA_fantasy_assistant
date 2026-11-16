'use client';
import { useMemo, useState } from 'react';
import {
  Badge, Group, NumberInput, Paper, ScrollArea, SegmentedControl,
  Select, Stack, Table, Text, TextInput, Title, UnstyledButton,
} from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconSearch } from '@tabler/icons-react';
import { useAppData } from '@/components/AppDataProvider';
import { DataSourceBadge, Numeric, PlayerLink } from '@/components/common';
import type { Metric, Player } from '@/lib/types';

type SortKey = 'rank' | 'fppg' | 'gp' | 'season_fpts' | 'fp_per36' | Metric;
type View = 'fantasy' | 'boxscore' | 'shooting';
const VIEWS: Record<View, { label: string; columns: SortKey[] }> = {
  fantasy: { label: 'Fantasy', columns: ['fppg', 'gp', 'season_fpts', 'fp_per36', 'MPG', 'PPG', 'RPG', 'APG'] },
  boxscore: { label: 'Box score', columns: ['gp', 'MPG', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'TOPG', 'OREB/G', 'DREB/G', 'PF/G'] },
  shooting: { label: 'Shooting', columns: ['PPG', 'FGM/G', 'FGA/G', 'FG%', '3PM/G', '3PA/G', '3P%', 'FTM/G', 'FTA/G', 'FT%'] },
};
const LABELS: Record<string, string> = {
  fppg: 'FPPG', gp: 'GP', season_fpts: 'Season FP*', fp_per36: 'FP / 36',
};
function statValue(player: Player, key: SortKey): number | null {
  if (key === 'rank') return player.rank;
  if (key === 'gp') return player.gp;
  if (key === 'fppg') return player.fppg;
  if (key === 'season_fpts') return player.season_fpts;
  if (key === 'fp_per36') return player.fp_per36;
  return player.stats[key];
}
export function RankingsView() {
  const { players } = useAppData();
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState<string | null>(null);
  const [minGp, setMinGp] = useState<number | string>(0);
  const [view, setView] = useState<View>('fantasy');
  const [sortBy, setSortBy] = useState<SortKey>('fppg');
  const [descending, setDescending] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const teams = useMemo(() => [...new Set(players.flatMap(p => p.teams))].sort(), [players]);
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return players.filter(p => (!q || p.name.toLowerCase().includes(q) || p.teams.some(t => t.toLowerCase().includes(q)))
      && (!team || p.teams.includes(team)) && p.gp >= (Number(minGp) || 0))
      .sort((a,b) => {
        const av = statValue(a,sortBy), bv = statValue(b,sortBy);
        if (av === null) return 1;
        if (bv === null) return -1;
        return (descending ? bv-av : av-bv) || a.rank-b.rank;
      });
  }, [players,search,team,minGp,sortBy,descending]);
  const columns = VIEWS[view].columns;
  const doSort = (key: SortKey) => {
    if (sortBy === key) setDescending(!descending);
    else { setSortBy(key); setDescending(key !== 'rank'); }
  };
  const sortLabel = (key: SortKey) => <UnstyledButton
    onClick={() => doSort(key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
    {LABELS[key] ?? key}{sortBy === key ? (descending ? <IconArrowDown size={13}/> : <IconArrowUp size={13}/>) : null}
  </UnstyledButton>;
  return <Stack gap="md">
    <Group justify="space-between" align="start">
      <div><Title order={2}>2025–26 Player Rankings</Title>
        <Text c="dimmed" size="sm">Sorted NBA season averages from your Kaggle CSV · {players.length} players</Text>
      </div><DataSourceBadge />
    </Group>
    <Paper withBorder p="md">
      <Group gap="sm" align="end" wrap="wrap">
        <TextInput label="Search" value={search} onChange={e => {setSearch(e.currentTarget.value);setShowAll(false);}}
          leftSection={<IconSearch size={16}/>} placeholder="Player or team" w={220}/>
        <Select label="Team" searchable clearable data={teams} value={team} onChange={value => {setTeam(value);setShowAll(false);}} placeholder="All NBA teams" w={210}/>
        <NumberInput label="Min GP" value={minGp} onChange={setMinGp} min={0} max={82} w={100}/>
        <SegmentedControl value={view} onChange={value => setView(value as View)}
          data={Object.entries(VIEWS).map(([value,record]) => ({value,label:record.label}))}/>
        <Badge color="gray" variant="outline" ml="auto">{filtered.length} matching</Badge>
      </Group>
    </Paper>
    <Paper withBorder>
      <ScrollArea>
        <Table striped highlightOnHover stickyHeader verticalSpacing="xs" horizontalSpacing="sm" fz="sm" miw={850}>
          <Table.Thead><Table.Tr>
            <Table.Th>{sortLabel('rank')}</Table.Th><Table.Th>Player</Table.Th><Table.Th>Team(s)</Table.Th>
            {columns.map(k => <Table.Th key={k}>{sortLabel(k)}</Table.Th>)}
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {filtered.slice(0,showAll?undefined:100).map(p => <Table.Tr key={p.id}>
              <Table.Td><Text size="xs" c="dimmed">{p.rank}</Text></Table.Td>
              <Table.Td><PlayerLink player={p}/></Table.Td>
              <Table.Td><Text size="xs" lineClamp={1} title={p.teams.join(' / ')}>{p.team}</Text></Table.Td>
              {columns.map(k => <Table.Td key={k}><Numeric value={statValue(p,k)} digits={k === 'gp' ? 0 : k === 'season_fpts' ? 1 : 2}/></Table.Td>)}
            </Table.Tr>)}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {!showAll && filtered.length > 100 && <div style={{ padding: 12, textAlign: 'center' }}>
        <UnstyledButton onClick={() => setShowAll(true)} style={{ color: 'var(--mantine-color-orange-6)', fontWeight: 600 }}>Show all {filtered.length} players</UnstyledButton>
      </div>}
    </Paper>
    <Text c="dimmed" size="xs">*Season FP = FPPG × historical games played, calculated from rounded per-game averages. This is not a future projection. Percent columns use the CSV percentage scale (e.g., 47.6 means 47.6%). The CSV contains no player positions, injuries, game dates, or ADP.</Text>
  </Stack>;
}
