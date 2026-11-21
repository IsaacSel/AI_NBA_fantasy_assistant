'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconCheck,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';

import { useAppData } from '@/components/AppDataProvider';
import { PageLoader, PlayerBadges, PlayerLink, TagBadge } from '@/components/common';
import type { InjuryReport, Player, Schedule } from '@/lib/types';
import { buildLineup, type ValuedPlayer } from '@/lib/valuation';

/** Our 2027 board: players by projected season total (FPPG incl. your adjustment x games). */
interface BoardRow {
  player: Player;
  rank: number;
  lastSeasonRank: number | null;
  fppg: number;
  gp: number;
  total: number;
}

const SHOW_AVAILABLE = 200;
const HIGHLIGHT_TOP = 5;
const WEEKS_AHEAD = 6;

const INJURY_COLORS: Record<InjuryReport['term'], string> = {
  'rest': 'gray',
  'day-to-day': 'yellow',
  'short term': 'yellow',
  'weeks': 'orange',
  'long term': 'red',
  'no timeline': 'red',
};

function shortDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${month}/${day}`;
}

/** Injury status from the current report: how long he's out, with the details and latest note on hover. */
function InjuryCell({ report }: { report: InjuryReport | null }) {
  if (!report || report.term === 'rest') {
    return null;
  }
  // Short label (the color says how long; hover for the details): DTD, or OUT with games missed.
  const label = report.term === 'day-to-day' ? 'DTD'
    : report.games_missed ? `OUT · ${report.games_missed}g` : report.term === 'no timeline' ? 'OUT · ?' : 'OUT';
  return (
    <Tooltip
      multiline
      w={340}
      withArrow
      label={(
        <Stack gap={4}>
          <Text size="xs" fw={700}>
            {report.status}{report.injury ? ` · ${report.injury}` : ''}
          </Text>
          {report.return_date && (
            <Text size="xs">
              Expected back {shortDate(report.return_date)}
              {report.games_missed ? ` · misses ~${report.games_missed} games` : ''}
            </Text>
          )}
          {report.comment && <Text size="xs">{report.comment}</Text>}
          {report.reported && <Text size="xs" c="dimmed">Reported {shortDate(report.reported)}</Text>}
        </Stack>
      )}
    >
      <Badge size="xs" variant="light" color={INJURY_COLORS[report.term]} style={{ cursor: 'help', overflow: 'visible' }}>
        {label}
      </Badge>
    </Tooltip>
  );
}

export function LiveDraftView() {
  const data = useAppData();
  const [search, setSearch] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    fetch('/api/schedule')
      .then((response) => response.json() as Promise<Schedule>)
      .then(setSchedule)
      .catch(() => setSchedule(null));
  }, []);

  const board = useMemo<BoardRow[]>(() => {
    if (!data) {
      return [];
    }
    const rows = data.players.map((player) => {
      const adjustment = data.user.players[String(player.id)]?.adjustment ?? 0;
      const fppg = player.model.fppg + adjustment;
      const gp = player.model.gp ?? (player.model.total && player.model.fppg ? player.model.total / player.model.fppg : 0);
      return { player, fppg, gp, total: fppg * gp };
    });
    const lastSeasonTotal = (p: Player) => (p.season_2026 ? p.season_2026.FPPG * p.season_2026.GP : null);
    const lastSeasonOrder = rows
      .filter((r) => lastSeasonTotal(r.player) !== null)
      .sort((a, b) => (lastSeasonTotal(b.player) ?? 0) - (lastSeasonTotal(a.player) ?? 0));
    const lastSeasonRank = new Map(lastSeasonOrder.map((r, i) => [r.player.id, i + 1]));
    return rows
      .sort((a, b) => b.total - a.total)
      .map((r, i) => ({ ...r, rank: i + 1, lastSeasonRank: lastSeasonRank.get(r.player.id) ?? null }));
  }, [data]);

  if (!data) {
    return <PageLoader />;
  }

  const { user, updateUser, league, valued } = data;
  const picks = user.liveDraft.picks;
  const taken = new Set(picks.map((p) => p.playerId));
  const byId = new Map(board.map((r) => [r.player.id, r]));

  const available = board.filter((r) => !taken.has(r.player.id));
  const query = search.trim().toLowerCase();
  const shown = (query
    ? available.filter((r) => r.player.name.toLowerCase().includes(query) || r.player.team.toLowerCase() === query)
    : available
  ).slice(0, SHOW_AVAILABLE);
  const highlight = new Set(available.slice(0, HIGHLIGHT_TOP).map((r) => r.player.id));

  // Your team, slotted into the league's lineup (most restrictive open slot first), then the bench.
  const valuedById = new Map(valued.map((v) => [v.id, v]));
  const myPlayers = picks.filter((p) => p.mine).map((p) => valuedById.get(p.playerId)).filter((v): v is ValuedPlayer => !!v);
  const lineup = buildLineup(myPlayers, league);
  const benchSlots = league.positions.BE?.starters ?? 0;
  const bench: (ValuedPlayer | null)[] = [...lineup.bench, ...Array(Math.max(0, benchSlots - lineup.bench.length)).fill(null)];
  const myCenters = myPlayers.filter((v) => v.eligible.includes('C')).length;
  const centerMax = league.positions.C?.maximum ?? null;
  const myTotal = myPlayers.reduce((sum, v) => sum + (byId.get(v.id)?.total ?? 0), 0);
  const recent = [...picks].reverse().slice(0, 10);
  // The next WEEKS_AHEAD fantasy weeks (Mon-Sun; week 1 starts on opening night), games per team.
  const today = new Date().toISOString().slice(0, 10);
  const weeks = (schedule?.weeks ?? []).filter((w) => w.end >= today).slice(0, WEEKS_AHEAD);
  const gamesIn = (team: string) => weeks.map((w) => w.teams[team]?.games ?? 0);

  const mark = (playerId: number, mine: boolean) => {
    setSearch('');
    void updateUser({ op: 'liveDraftPick', playerId, mine });
  };

  const slotRow = (label: string, v: ValuedPlayer | null, key: string) => (
    <Group key={key} justify="space-between" wrap="nowrap" gap="xs">
      <Group gap={8} wrap="nowrap">
        <Badge variant={v ? 'light' : 'outline'} color={v ? 'blue' : 'gray'} w={52} radius="sm">{label}</Badge>
        {v ? (
          <>
            <PlayerLink player={v} />
            <Text size="xs" c="dimmed">{v.position}</Text>
            <InjuryCell report={v.injury_report} />
          </>
        ) : (
          <Text size="sm" c="dimmed" fs="italic">empty</Text>
        )}
      </Group>
      {v && <Text size="sm">{(byId.get(v.id)?.fppg ?? v.model.fppg).toFixed(1)}</Text>}
    </Group>
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Live draft</Title>
          <Text size="sm" c="dimmed">
            Game-log ML and historical baselines, ranked for a hypothetical future season. Broad G/F/C roster positions come from Kaggle, not fantasy-platform eligibility. Mark players as they go: Taken (another team) or Mine.
            {' '}{picks.length} taken so far.
          </Text>
        </div>
        <Button
          variant="subtle"
          color="red"
          leftSection={<IconTrash size={16} />}
          onClick={() => {
            if (window.confirm('Clear every pick and start over?')) {
              void updateUser({ op: 'liveDraftReset' });
            }
          }}
        >
          Reset
        </Button>
      </Group>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card withBorder padding="sm">
            <TextInput
              placeholder="Find a player (name or team)…"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              mb="sm"
              autoFocus
            />
            <ScrollArea h={700}>
              <Table striped highlightOnHover stickyHeader verticalSpacing={4} miw={1180} style={{ whiteSpace: 'nowrap' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Rk</Table.Th>
                    <Table.Th>Player</Table.Th>
                    <Table.Th>Pos</Table.Th>
                    <Table.Th ta="right">FPPG</Table.Th>
                    <Table.Th ta="right">GP</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    <Table.Th ta="right">2025-26 rk</Table.Th>
                    <Table.Th>Injury</Table.Th>
                    {weeks.map((w) => (
                      <Table.Th key={w.week} ta="center" px={4}>
                        <Tooltip label={`Week ${w.week}: ${shortDate(w.start)}–${shortDate(w.end)}`}>
                          <Text size="xs" fw={700}>W{w.week}</Text>
                        </Tooltip>
                      </Table.Th>
                    ))}
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((r) => (
                    <Table.Tr key={r.player.id} bg={highlight.has(r.player.id) ? 'var(--mantine-color-yellow-light)' : undefined}>
                      <Table.Td>{r.rank}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <PlayerLink player={r.player} />
                          <Text size="xs" c="dimmed">{r.player.team}</Text>
                          <PlayerBadges player={r.player} hideInjury />
                          <TagBadge tag={user.players[String(r.player.id)]?.tag} />
                        </Group>
                      </Table.Td>
                      <Table.Td>{r.player.position}</Table.Td>
                      <Table.Td ta="right">{r.fppg.toFixed(1)}</Table.Td>
                      <Table.Td ta="right">{r.gp.toFixed(0)}</Table.Td>
                      <Table.Td ta="right" fw={600}>{Math.round(r.total)}</Table.Td>
                      <Table.Td ta="right" c="dimmed">{r.lastSeasonRank ?? '-'}</Table.Td>
                      <Table.Td><InjuryCell report={r.player.injury_report} /></Table.Td>
                      {gamesIn(r.player.team).map((games, i) => (
                        <Table.Td key={weeks[i].week} ta="center" px={4}
                          c={games >= 4 ? 'green' : games <= 2 ? 'dimmed' : undefined} fw={games >= 4 ? 700 : 400}>
                          {games}
                        </Table.Td>
                      ))}
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Button size="compact-xs" variant="light" color="gray" leftSection={<IconX size={12} />}
                            onClick={() => mark(r.player.id, false)}>
                            Taken
                          </Button>
                          <Button size="compact-xs" variant="light" color="green" leftSection={<IconCheck size={12} />}
                            onClick={() => mark(r.player.id, true)}>
                            Mine
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {shown.length === 0 && <Text c="dimmed" ta="center" py="lg">No available players match.</Text>}
            </ScrollArea>
          </Card>
        </div>

        <Stack gap="md">
          <Card withBorder padding="sm">
            <Group justify="space-between" mb="xs">
              <Title order={4}>Your team</Title>
              <Text size="sm" c="dimmed">{myPlayers.length} players · {Math.round(myTotal)} pts</Text>
            </Group>
            {centerMax !== null && myCenters >= centerMax && (
              <Badge color="orange" variant="light" mb="xs">{myCenters} centers: the league maximum is {centerMax}</Badge>
            )}
            <Stack gap={6}>
              {lineup.starters.map((s, i) => slotRow(s.slot, s.player, `s${i}`))}
              <Text size="xs" c="dimmed" mt={4}>Bench</Text>
              {bench.map((v, i) => slotRow('BE', v, `b${i}`))}
            </Stack>
          </Card>

          <Card withBorder padding="sm">
            <Title order={4} mb="xs">Recently taken</Title>
            {recent.length === 0 && <Text size="sm" c="dimmed">Nothing yet.</Text>}
            <Stack gap={4}>
              {recent.map((p) => {
                const r = byId.get(p.playerId);
                return (
                  <Group key={p.playerId} justify="space-between" wrap="nowrap">
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={p.mine ? 700 : 400}>{r?.player.name ?? p.playerId}</Text>
                      {p.mine && <Badge size="xs" color="green" variant="light">mine</Badge>}
                      {r && <Text size="xs" c="dimmed">our #{r.rank}</Text>}
                    </Group>
                    <Tooltip label="Undo (back to available)">
                      <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Undo"
                        onClick={() => updateUser({ op: 'liveDraftUndo', playerId: p.playerId })}>
                        <IconArrowBackUp size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                );
              })}
            </Stack>
          </Card>
        </Stack>
      </div>
    </Stack>
  );
}
