'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronUp,
  IconNote,
  IconSearch,
  IconTag,
  IconX,
} from '@tabler/icons-react';

import { useAppData } from '@/components/AppDataProvider';
import {
  formatNumber,
  PageLoader,
  PlayerBadges,
  PlayerLink,
  riskColor,
  TAG_OPTIONS,
  TagBadge,
} from '@/components/common';
import type { PlayerTag, Strategy } from '@/lib/types';
import { STRATEGIES, type ValuedPlayer } from '@/lib/valuation';

type SortKey = 'rank' | 'strategyFppg' | 'gamesPlayed' | 'value' | 'lastSeason' | 'upside' | 'risk' | 'tier';

const PAGE_SIZE = 100;
const POSITIONS = ['G', 'F', 'C'];

const SORTERS: Record<SortKey, (player: ValuedPlayer, tier: number | null) => number> = {
  rank: (p) => p.rank,
  strategyFppg: (p) => -p.strategyFppg,
  gamesPlayed: (p) => -p.gamesPlayed,
  value: (p) => -p.value,
  lastSeason: (p) => -(p.season_2026?.FPPG ?? -1),
  upside: (p) => -p.upside_fppg,
  risk: (p) => p.risk,
  tier: (_p, tier) => tier ?? 99,
};

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  tooltip?: string;
  onSort: (key: SortKey) => void;
}

function SortHeader({
  label,
  sortKey,
  current,
  tooltip,
  onSort,
}: SortHeaderProps) {
  const header = (
    <UnstyledButton
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 whitespace-nowrap font-semibold"
    >
      {label}
      {current === sortKey ? <IconChevronDown size={14} /> : <IconChevronUp size={14} className="opacity-20" />}
    </UnstyledButton>
  );
  return (
    <Table.Th>
      {tooltip ? (
        <Tooltip
          label={tooltip}
          multiline
          w={260}
        >
          {header}
        </Tooltip>
      ) : header}
    </Table.Th>
  );
}

export function RankingsView() {
  const data = useAppData();
  const [search, setSearch] = useState('');
  const [position, setPosition] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [rookiesOnly, setRookiesOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const rows = useMemo(() => {
    if (!data) {
      return [];
    }
    const query = search.trim().toLowerCase();
    return data.valued
      .filter((player) => !query || player.name.toLowerCase().includes(query) || player.team.toLowerCase() === query)
      .filter((player) => !position || player.eligible.includes(position))
      .filter((player) => !rookiesOnly || player.rookie)
      .filter((player) => !tagFilter || data.user.players[String(player.id)]?.tag === tagFilter)
      .sort((a, b) => {
        const tierA = data.user.players[String(a.id)]?.tier ?? null;
        const tierB = data.user.players[String(b.id)]?.tier ?? null;
        return SORTERS[sortKey](a, tierA) - SORTERS[sortKey](b, tierB) || a.rank - b.rank;
      });
  }, [data, search, position, rookiesOnly, tagFilter, sortKey]);

  if (!data) {
    return <PageLoader />;
  }

  const { user, updateUser, replacementFppg } = data;
  const { strategy, teams } = user.settings;

  const setTag = (playerId: number, tag: PlayerTag | null) => updateUser({
    op: 'setPlayer',
    playerId,
    patch: { tag },
  });

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Rankings</Title>
          <Text size="sm" c="dimmed">
            Value = fantasy points above a waiver-wire replacement ({replacementFppg} FPPG in a {teams}-team league) over a season.
          </Text>
        </div>
        <Group gap="sm" align="flex-end">
          <NumberInput
            label="Teams"
            value={teams}
            min={6}
            max={20}
            w={90}
            onChange={(value) => typeof value === 'number' && updateUser({ op: 'setSettings', patch: { teams: value } })}
          />
          <div>
            <Text size="sm" fw={500} mb={4}>Projection</Text>
            <SegmentedControl
              value={strategy}
              onChange={(value) => updateUser({ op: 'setSettings', patch: { strategy: value as Strategy } })}
              data={Object.entries(STRATEGIES).map(([value, { label }]) => ({ value, label }))}
            />
          </div>
        </Group>
      </Group>
      <Text size="xs" c="dimmed">{STRATEGIES[strategy]?.description ?? STRATEGIES.balanced.description} Position filters use the Kaggle roster's broad G/F/C categories; PG/SG/SF/PF fantasy-platform eligibility is not supplied. The mock draft uses compatible broad slots.</Text>

      <Paper withBorder p="sm">
        <Group gap="sm">
          <TextInput
            placeholder="Search player or team"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setVisible(PAGE_SIZE);
            }}
            rightSection={search && <IconX size={14} className="cursor-pointer" onClick={() => setSearch('')} />}
            w={240}
          />
          <Select
            placeholder="All positions"
            data={POSITIONS}
            disabled={!data.players.some((p) => p.position !== 'UNK')}
            value={position}
            onChange={setPosition}
            clearable
            w={150}
          />
          <Select
            placeholder="Any tag"
            data={Object.entries(TAG_OPTIONS).map(([value, { label }]) => ({ value, label }))}
            value={tagFilter}
            onChange={setTagFilter}
            clearable
            w={140}
          />
          <Checkbox
            label="Rookies only (unavailable)"
            disabled
            checked={rookiesOnly}
            onChange={(event) => setRookiesOnly(event.currentTarget.checked)}
          />
          <Text size="sm" c="dimmed" ml="auto">{rows.length} players</Text>
        </Group>
      </Paper>

      <Paper withBorder>
        <ScrollArea>
          <Table
            striped
            highlightOnHover
            stickyHeader
            verticalSpacing={6}
            fz="sm"
          >
            <Table.Thead>
              <Table.Tr>
                <SortHeader label="#" sortKey="rank" current={sortKey} onSort={setSortKey} />
                <Table.Th>Player</Table.Th>
                <Table.Th>Pos</Table.Th>
                <SortHeader label="FPPG" sortKey="strategyFppg" current={sortKey} onSort={setSortKey} tooltip="Projected fantasy points per game under the selected projection, including your adjustment." />
                <SortHeader label="GP" sortKey="gamesPlayed" current={sortKey} onSort={setSortKey} tooltip="Projected games played." />
                <SortHeader label="Value" sortKey="value" current={sortKey} onSort={setSortKey} tooltip="Season fantasy points above replacement level." />
                <SortHeader label="2025-26 FPPG" sortKey="lastSeason" current={sortKey} onSort={setSortKey} tooltip="Observed 2025-26 fantasy points per game (not a projection)." />
                <SortHeader label="Upside" sortKey="upside" current={sortKey} onSort={setSortKey} tooltip="Good-case FPPG: the model's ~80th-percentile outcome." />
                <SortHeader label="Risk" sortKey="risk" current={sortKey} onSort={setSortKey} tooltip="0-1 score from missed games, volatility, thin data, and new-team uncertainty." />
                <SortHeader label="Tier" sortKey="tier" current={sortKey} onSort={setSortKey} tooltip="Your own tier, set on the player page." />
                <Table.Th>Tag</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.slice(0, visible).map((player) => {
                const mine = user.players[String(player.id)];
                return (
                  <Table.Tr key={player.id}>
                    <Table.Td>{player.rank}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <PlayerLink player={player} />
                        <Text size="xs" c="dimmed">{player.team}</Text>
                        <PlayerBadges player={player} />
                        {(mine?.notes?.length ?? 0) > 0 && (
                          <Tooltip label={mine?.notes?.[0].text} multiline w={260}>
                            <IconNote size={14} className="opacity-60" />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={`Eligible: ${player.eligible.join(', ')}`}>
                        <Text size="sm">{player.position}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={600}>
                        {formatNumber(player.strategyFppg)}
                        {player.adjustment !== 0 && (
                          <Text span size="xs" c={player.adjustment > 0 ? 'green' : 'red'}>
                            {' '}({player.adjustment > 0 ? '+' : ''}{player.adjustment})
                          </Text>
                        )}
                      </Text>
                    </Table.Td>
                    <Table.Td>{player.gamesPlayed}</Table.Td>
                    <Table.Td>{player.value}</Table.Td>
                    <Table.Td>{formatNumber(player.season_2026?.FPPG)}</Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={player.upside_reasons.join(', ') || 'No specific upside signals'}
                        multiline
                        w={240}
                      >
                        <Text size="sm">{formatNumber(player.upside_fppg)}</Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={player.risk_reasons.join(', ') || 'No major risk flags'}
                        multiline
                        w={240}
                      >
                        <Badge color={riskColor(player.risk)} variant="light" size="sm">
                          {player.risk.toFixed(2)}
                        </Badge>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>{mine?.tier ?? '–'}</Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <UnstyledButton aria-label={`Tag ${player.name}`}>
                            {mine?.tag ? <TagBadge tag={mine.tag} /> : <IconTag size={16} className="opacity-40" />}
                          </UnstyledButton>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {Object.entries(TAG_OPTIONS).map(([tag, { label, icon: Icon }]) => (
                            <Menu.Item
                              key={tag}
                              leftSection={<Icon size={14} />}
                              onClick={() => setTag(player.id, tag as PlayerTag)}
                            >
                              {label}
                            </Menu.Item>
                          ))}
                          <Menu.Item
                            leftSection={<IconX size={14} />}
                            onClick={() => setTag(player.id, null)}
                          >
                            Clear tag
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      {visible < rows.length && (
        <Button
          variant="default"
          onClick={() => setVisible((count) => count + PAGE_SIZE)}
        >
          Show more ({rows.length - visible} left)
        </Button>
      )}
    </Stack>
  );
}
