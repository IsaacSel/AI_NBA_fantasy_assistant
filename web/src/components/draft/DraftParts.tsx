'use client';

import { useState, type ReactNode } from 'react';
import {
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
import { IconBolt, IconSearch } from '@tabler/icons-react';

import {
  formatNumber,
  formatPercent,
  PlayerBadges,
  PlayerLink,
  TagBadge,
} from '@/components/common';
import type { Recommendation } from '@/lib/draft';
import type { DraftPick, PlayerTag } from '@/lib/types';
import type { Lineup, ValuedPlayer } from '@/lib/valuation';

interface RecommendationsCardProps {
  recommendations: Recommendation[];
  hasNextPick: boolean;
  canPick: boolean;
  onPick: (player: ValuedPlayer) => void;
  tagFor: (playerId: number) => PlayerTag | null | undefined;
  note?: ReactNode;
}

export function RecommendationsCard({
  recommendations,
  hasNextPick,
  canPick,
  onPick,
  tagFor,
  note,
}: RecommendationsCardProps) {
  return (
    <Card withBorder>
      <Title order={4}>Recommended for you</Title>
      <Text size="xs" c="dimmed" mb="sm">
        Ranked by season value above replacement, discounted for players who&apos;d sit on your bench, with a nudge toward
        players unlikely to last to your next pick (based on historical production, not real ADP).
      </Text>
      {note}
      <ScrollArea>
        <Table fz="sm" verticalSpacing={4} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Player</Table.Th>
              <Table.Th>Pos</Table.Th>
              <Table.Th>FPPG</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th>2025-26</Table.Th>
              <Table.Th>Lineup +</Table.Th>
              <Table.Th>Lasts to next pick</Table.Th>
              <Table.Th>Why</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {recommendations.map((rec) => (
              <Table.Tr key={rec.player.id}>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <PlayerLink player={rec.player} />
                    <Text size="xs" c="dimmed">{rec.player.team}</Text>
                    <TagBadge tag={tagFor(rec.player.id)} />
                  </Group>
                </Table.Td>
                <Table.Td>{rec.player.position}</Table.Td>
                <Table.Td>{formatNumber(rec.player.strategyFppg)}</Table.Td>
                <Table.Td>{rec.player.value}</Table.Td>
                <Table.Td>{formatNumber(rec.player.season_2026?.FPPG)}</Table.Td>
                <Table.Td>{rec.starterGain > 0 ? `+${rec.starterGain}` : '–'}</Table.Td>
                <Table.Td>{hasNextPick ? formatPercent(rec.chanceAvailableNextPick) : '–'}</Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" maw={260}>{rec.reasons.join(' · ')}</Text>
                </Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs"
                    disabled={!canPick}
                    onClick={() => onPick(rec.player)}
                  >
                    Draft
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

interface AvailableCardProps {
  players: ValuedPlayer[];
  canPick: boolean;
  onPick: (player: ValuedPlayer) => void;
  actionLabel?: string;
  title?: string;
}

/** Searchable list of undrafted players with a pick button on each row. */
export function AvailableCard({
  players,
  canPick,
  onPick,
  actionLabel = 'Draft',
  title = 'All available',
}: AvailableCardProps) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = players
    .filter((player) => !query || player.name.toLowerCase().includes(query) || player.team.toLowerCase() === query)
    .slice(0, 60);
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{title}</Title>
        <TextInput
          size="xs"
          placeholder="Search player or team"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </Group>
      <ScrollArea h={420}>
        <Table fz="sm" verticalSpacing={3} stickyHeader highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Player</Table.Th>
              <Table.Th>Pos</Table.Th>
              <Table.Th>FPPG</Table.Th>
              <Table.Th>2025-26</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((player) => (
              <Table.Tr key={player.id}>
                <Table.Td>{player.rank}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <PlayerLink player={player} />
                    <Text size="xs" c="dimmed">{player.team}</Text>
                    <PlayerBadges player={player} />
                  </Group>
                </Table.Td>
                <Table.Td>{player.position}</Table.Td>
                <Table.Td>{formatNumber(player.strategyFppg)}</Table.Td>
                <Table.Td>{formatNumber(player.season_2026?.FPPG)}</Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={!canPick}
                    onClick={() => onPick(player)}
                  >
                    {actionLabel}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Card>
  );
}

export function YourTeamCard({ lineup }: { lineup: Lineup }) {
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Title order={4}>Your team</Title>
        <Badge variant="light" leftSection={<IconBolt size={12} />}>{lineup.starterFppg} FPPG</Badge>
      </Group>
      <Table fz="sm" verticalSpacing={3} mt="xs">
        <Table.Tbody>
          {lineup.starters.map(({ slot, player }, i) => (
            <Table.Tr key={`${slot}-${i}`}>
              <Table.Td w={60}><Badge size="sm" variant="outline">{slot}</Badge></Table.Td>
              <Table.Td>{player ? <PlayerLink player={player} /> : <Text size="sm" c="dimmed">Empty</Text>}</Table.Td>
              <Table.Td ta="right">{player ? formatNumber(player.strategyFppg) : ''}</Table.Td>
            </Table.Tr>
          ))}
          {lineup.bench.map((player) => (
            <Table.Tr key={player.id}>
              <Table.Td><Badge size="sm" variant="outline" color="gray">BE</Badge></Table.Td>
              <Table.Td><PlayerLink player={player} /></Table.Td>
              <Table.Td ta="right">{formatNumber(player.strategyFppg)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

interface DraftBoardCardProps {
  picks: DraftPick[];
  byId: Map<number, ValuedPlayer>;
  teams: number;
  myTeam: number;
  teamLabel: (team: number) => string;
}

export function DraftBoardCard({
  picks,
  byId,
  teams,
  myTeam,
  teamLabel,
}: DraftBoardCardProps) {
  return (
    <Card withBorder>
      <Title order={4} mb="xs">Draft board</Title>
      <ScrollArea h={360}>
        <Stack gap={2}>
          {[...picks].reverse().map((pick) => {
            const player = byId.get(pick.playerId);
            return (
              <Group key={pick.overall} gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed" w={36}>{pick.round}.{((pick.overall - 1) % teams) + 1}</Text>
                <Text
                  size="xs"
                  fw={pick.team === myTeam ? 700 : 400}
                  c={pick.team === myTeam ? 'orange' : undefined}
                  w={70}
                >
                  {teamLabel(pick.team)}
                </Text>
                <Tooltip label={player ? `Our rank #${player.rank} · 2025-26 ${player.season_2026?.FPPG ?? '–'}` : ''}>
                  <Text size="xs">{player?.name ?? `Player ${pick.playerId}`}</Text>
                </Tooltip>
              </Group>
            );
          })}
          {!picks.length && <Text size="sm" c="dimmed">No picks yet.</Text>}
        </Stack>
      </ScrollArea>
    </Card>
  );
}
