'use client';
import Link from 'next/link';
import { Badge, Button, Grid, Group, Paper, Progress, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useAppData } from '@/components/AppDataProvider';
import { DataSourceBadge, Numeric } from '@/components/common';
import { METRICS } from '@/lib/types';

function StatTile({ label, value }: { label: string; value: number | null }) {
  return <Paper withBorder p="md"><Text c="dimmed" size="xs" tt="uppercase">{label}</Text>
    <Title order={3}><Numeric value={value}/></Title></Paper>;
}
export function PlayerView({ id }: { id: number }) {
  const { byId, league } = useAppData();
  const p = byId.get(id);
  if (!p) return <Stack><Title order={3}>Player not in this dataset</Title><Button component={Link} href="/">Return to rankings</Button></Stack>;
  const maxContribution = Math.max(1,...Object.values(p.breakdown).map(Math.abs));
  return <Stack gap="md">
    <Group justify="space-between"><Button component={Link} href="/" leftSection={<IconArrowLeft size={16}/>} variant="subtle">Rankings</Button><DataSourceBadge/></Group>
    <div><Group gap="sm"><Title order={2}>{p.name}</Title><Badge color="gray" variant="light">#{p.rank} by historical FPPG</Badge></Group>
      <Text c="dimmed">{p.teams.join(' / ')} · NBA player ID {p.id} · 2025–26</Text>
    </div>
    <SimpleGrid cols={{base:2,sm:3,lg:6}} spacing="sm">
      <StatTile label="Fantasy pts/game" value={p.fppg}/>
      <StatTile label="Games played" value={p.gp}/>
      <StatTile label="Minutes/game" value={p.mpg}/>
      <StatTile label="Est. season FP" value={p.season_fpts}/>
      <StatTile label="Fantasy pts/36" value={p.fp_per36}/>
      <StatTile label="Points/game" value={p.stats.PPG}/>
    </SimpleGrid>
    <Grid gutter="md">
      <Grid.Col span={{base:12,md:7}}>
        <Paper withBorder p="md">
          <Title order={4} mb="md">Complete CSV statistics</Title>
          <Table striped verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>Category</Table.Th><Table.Th style={{textAlign:'right'}}>Per-game average / %</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{METRICS.map(key => <Table.Tr key={key}><Table.Td>{key}</Table.Td>
              <Table.Td style={{textAlign:'right'}}><Numeric value={p.stats[key]}/></Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{base:12,md:5}}>
        <Paper withBorder p="md">
          <Title order={4} mb="xs">Fantasy scoring breakdown</Title>
          <Text size="xs" c="dimmed" mb="lg">Point contribution per game, applying your league&apos;s scoring weights to the CSV averages.</Text>
          <Stack gap="md">{Object.entries(p.breakdown).sort((a,b) => Math.abs(b[1])-Math.abs(a[1])).map(([key,contribution]) => <div key={key}>
            <Group justify="space-between" mb={4}><Text size="sm">{key} ({league.scoring[key] > 0 ? '+' : ''}{league.scoring[key]}×)</Text>
            <Text fw={600} size="sm">{contribution > 0 ? '+' : ''}{contribution.toFixed(2)}</Text></Group>
            <Progress value={100 * Math.abs(contribution)/maxContribution} color={contribution < 0 ? 'red' : 'orange'}/>
          </div>)}</Stack>
        </Paper>
        <Paper withBorder p="md" mt="md"><Text size="sm" c="dimmed">This page uses only the uploaded CSV. It does not estimate injury risk, recent form, matchup splits, future games, or next-season performance. Missing shooting percentages are shown as —.</Text></Paper>
      </Grid.Col>
    </Grid>
  </Stack>;
}
