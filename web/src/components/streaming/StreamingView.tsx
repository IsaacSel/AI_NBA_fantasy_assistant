'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Card,
  Group,
  List,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

import { useAppData } from '@/components/AppDataProvider';
import {
  formatNumber,
  PageLoader,
  PlayerBadges,
  PlayerLink,
  TagBadge,
} from '@/components/common';
import {
  currentWeek,
  likelyAvailable,
  streamersForWeek,
  teamsByGames,
} from '@/lib/streaming';
import type { Schedule } from '@/lib/types';
import { rosterSize } from '@/lib/valuation';

const GAME_COLORS: Record<number, string> = {
  1: 'bg-gray-200 dark:bg-gray-700',
  2: 'bg-gray-300 dark:bg-gray-600',
  3: 'bg-orange-200 dark:bg-orange-900',
  4: 'bg-orange-400 dark:bg-orange-700',
  5: 'bg-red-500 text-white',
};

function formatRange(start: string, end: string): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(`${start}T12:00:00`).toLocaleDateString('en-US', options)} – ${new Date(`${end}T12:00:00`).toLocaleDateString('en-US', options)}`;
}

export function StreamingView() {
  const data = useAppData();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekNumber, setWeekNumber] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/schedule')
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Failed to load schedule');
        }
        return response.json() as Promise<Schedule>;
      })
      .then((loaded) => {
        setSchedule(loaded);
        setWeekNumber(loaded.weeks.length ? currentWeek(loaded).week : 0);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const pool = useMemo(() => {
    if (!data) {
      return [];
    }
    return likelyAvailable(data.valued, data.user.settings.teams, rosterSize(data.league))
      .filter((player) => data.user.players[String(player.id)]?.tag !== 'avoid');
  }, [data]);

  if (error) {
    return <Alert color="red" title="Couldn't load schedule">{error}. Rebuild with python3 -m app_data.build_app_data.</Alert>;
  }
  if (!data || !schedule || weekNumber === null) {
    return <PageLoader />;
  }
  if (!schedule.weeks.length) {
    return <Alert color="yellow" title="Schedule data needed">Your historical game logs contain past game dates, but no future 2026-27 team schedule was supplied, so weekly streaming recommendations are unavailable. Rankings and drafts still work. Add a permitted 2026-27 schedule source to enable streaming.</Alert>;
  }

  const week = schedule.weeks.find((w) => w.week === weekNumber) ?? schedule.weeks[0];
  const streamers = streamersForWeek(pool, week);
  const teamGames = teamsByGames(week);
  const upcoming = schedule.weeks.filter((w) => w.week > week.week).slice(0, 3);
  const teams = Object.keys(schedule.weeks[0].teams).sort();
  const { settings } = data.user;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Streaming</Title>
          <Text size="sm" c="dimmed">
            Cycle your last {settings.streamingSlots} roster spots through free agents with the most games each week.
          </Text>
        </div>
        <Select
          label="Week"
          value={String(week.week)}
          onChange={(value) => value && setWeekNumber(Number(value))}
          data={schedule.weeks.map((w) => ({
            value: String(w.week),
            label: `Week ${w.week} · ${formatRange(w.start, w.end)}`,
          }))}
          w={260}
          allowDeselect={false}
        />
      </Group>

      <Alert icon={<IconInfoCircle size={16} />} variant="light">
        <List size="sm" spacing={2}>
          <List.Item>
            <b>Who&apos;s available:</b> players outside the top {settings.teams * rosterSize(data.league)} by historical ranking proxy
            ({settings.teams} teams × {rosterSize(data.league)} roster spots), since that&apos;s roughly what gets drafted. Players tagged Avoid are hidden.
          </List.Item>
          <List.Item>
            <b>Score</b> = FPPG × games that week, plus a bonus for games on <b>light days</b> (≤{schedule.light_day_max_games} NBA games),
            when fewer of your starters play and a streamer actually fills an open slot.
          </List.Item>
          <List.Item>Pick up the top option, play them through their games, then drop them for the next team with games left.</List.Item>
        </List>
      </Alert>

      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        <Card withBorder className="lg:col-span-2">
          <Title order={4}>Best streamers · week {week.week}</Title>
          <Text size="xs" c="dimmed" mb="sm">{formatRange(week.start, week.end)}</Text>
          <ScrollArea>
            <Table fz="sm" verticalSpacing={4} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Player</Table.Th>
                  <Table.Th>Pos</Table.Th>
                  <Table.Th>FPPG</Table.Th>
                  <Table.Th>Games</Table.Th>
                  <Table.Th>Light-day games</Table.Th>
                  <Table.Th>Proj. points</Table.Th>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>Owned</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {streamers.map((option) => (
                  <Table.Tr key={option.player.id}>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <PlayerLink player={option.player} />
                        <Text size="xs" c="dimmed">{option.player.team}</Text>
                        <PlayerBadges player={option.player} />
                        <TagBadge tag={data.user.players[String(option.player.id)]?.tag} />
                      </Group>
                    </Table.Td>
                    <Table.Td>{option.player.position}</Table.Td>
                    <Table.Td>{formatNumber(option.player.strategyFppg)}</Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={option.games >= 4 ? 'orange' : 'gray'}>{option.games}</Badge>
                    </Table.Td>
                    <Table.Td>{option.lightGames}</Table.Td>
                    <Table.Td>{option.projectedPoints}</Table.Td>
                    <Table.Td fw={700}>{option.score}</Table.Td>
                    <Table.Td>{option.player.owned === null ? '–' : `${Math.round(option.player.owned)}%`}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">Games this week</Title>
          <Stack gap={4}>
            {teamGames.map(({ team, games, light }) => (
              <Group key={team} gap="xs" wrap="nowrap">
                <Text size="sm" w={48} fw={600}>{team}</Text>
                <div className="flex gap-1">
                  {Array.from({ length: games }, (_, i) => (
                    <div
                      key={i}
                      className={`h-3 w-5 rounded-sm ${i < light ? 'bg-orange-500' : 'bg-gray-400'}`}
                    />
                  ))}
                </div>
                <Text size="xs" c="dimmed">{games}{light ? ` (${light} light)` : ''}</Text>
              </Group>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="sm">Orange blocks are light-day games.</Text>
        </Card>
      </SimpleGrid>

      {upcoming.length > 0 && (
        <Card withBorder>
          <Title order={4} mb="sm">Plan ahead</Title>
          <SimpleGrid cols={{ base: 1, md: upcoming.length }}>
            {upcoming.map((w) => (
              <div key={w.week}>
                <Text fw={600} size="sm">Week {w.week} · {formatRange(w.start, w.end)}</Text>
                <List size="sm" spacing={2} mt={4}>
                  {streamersForWeek(pool, w, 5).map((option) => (
                    <List.Item key={option.player.id}>
                      <PlayerLink player={option.player} /> <Text span size="xs" c="dimmed">{option.player.team} · {option.games} games · {formatNumber(option.player.strategyFppg)} FPPG</Text>
                    </List.Item>
                  ))}
                </List>
              </div>
            ))}
          </SimpleGrid>
        </Card>
      )}

      <Card withBorder>
        <Title order={4}>Season schedule</Title>
        <Text size="xs" c="dimmed" mb="sm">Games per team per week. Click a week to load it above. 4-game weeks are the streaming sweet spots.</Text>
        <ScrollArea>
          <table className="border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="pr-2 text-left">Team</th>
                {schedule.weeks.map((w) => (
                  <th key={w.week} className="w-7 text-center">
                    <Tooltip label={formatRange(w.start, w.end)}>
                      <button
                        type="button"
                        className={`w-full cursor-pointer ${w.week === week.week ? 'font-bold text-orange-500' : ''}`}
                        onClick={() => setWeekNumber(w.week)}
                      >
                        {w.week}
                      </button>
                    </Tooltip>
                  </th>
                ))}
                <th className="pl-2">4+ wks</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team}>
                  <td className="pr-2 font-semibold">{team}</td>
                  {schedule.weeks.map((w) => {
                    const games = w.teams[team]?.games ?? 0;
                    return (
                      <td
                        key={w.week}
                        className={`h-6 w-7 rounded-sm text-center ${GAME_COLORS[games] ?? ''} ${w.week === week.week ? 'ring-2 ring-orange-500' : ''}`}
                      >
                        {games || ''}
                      </td>
                    );
                  })}
                  <td className="pl-2 text-center">
                    {schedule.weeks.filter((w) => (w.teams[team]?.games ?? 0) >= 4).length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </Stack>
  );
}
