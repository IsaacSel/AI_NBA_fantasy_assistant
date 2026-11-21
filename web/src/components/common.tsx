'use client';

import Link from 'next/link';
import {
  Anchor,
  Badge,
  Center,
  Group,
  Loader,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconStar,
  IconThumbDown,
  IconTrendingUp,
} from '@tabler/icons-react';

import type { Player, PlayerTag } from '@/lib/types';

export function PageLoader() {
  return (
    <Center className="py-24">
      <Loader />
    </Center>
  );
}

export function PlayerLink({ player }: { player: Pick<Player, 'id' | 'name'> }) {
  return (
    <Anchor
      component={Link}
      href={`/players/${player.id}`}
      fw={600}
      size="sm"
    >
      {player.name}
    </Anchor>
  );
}

export const TAG_OPTIONS: Record<PlayerTag, { label: string; color: string; icon: typeof IconStar }> = {
  target: {
    label: 'Target',
    color: 'green',
    icon: IconStar,
  },
  sleeper: {
    label: 'Sleeper',
    color: 'violet',
    icon: IconTrendingUp,
  },
  avoid: {
    label: 'Avoid',
    color: 'red',
    icon: IconThumbDown,
  },
};

export function TagBadge({ tag }: { tag: PlayerTag | null | undefined }) {
  if (!tag) {
    return null;
  }
  const { label, color, icon: Icon } = TAG_OPTIONS[tag];
  return (
    <Badge
      color={color}
      variant="light"
      size="sm"
      leftSection={<Icon size={12} />}
    >
      {label}
    </Badge>
  );
}

/** Small badges for rookies, team changes, and injuries next to a player's name. */
export function PlayerBadges({ player, hideInjury = false }: { player: Player; hideInjury?: boolean }) {
  return (
    <Group gap={4} wrap="nowrap">
      {player.rookie && (
        <Badge
          size="xs"
          variant="light"
          color="blue"
        >
          {player.rookie.pick ? `R #${player.rookie.pick}` : 'Rookie'}
        </Badge>
      )}
      {player.model.changed_team && (
        <Tooltip label={`New team: ${player.team_2026} → ${player.team}`}>
          <Badge
            size="xs"
            variant="light"
            color="grape"
            leftSection={<IconArrowsExchange size={10} />}
          >
            {player.team_2026}
          </Badge>
        </Tooltip>
      )}
      {!hideInjury && player.injury && player.injury !== 'ACTIVE' && (
        <Tooltip label={`Legacy injury status: ${player.injury.replaceAll('_', ' ').toLowerCase()}`}>
          <Badge
            size="xs"
            variant="light"
            color={player.injury === 'OUT' ? 'red' : 'yellow'}
            leftSection={<IconAlertTriangle size={10} />}
          >
            {player.injury === 'OUT' ? 'OUT' : 'DTD'}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '–' : value.toFixed(digits);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? '–' : `${(value * 100).toFixed(digits)}%`;
}

export function riskColor(risk: number): string {
  if (risk >= 0.35) {
    return 'red';
  }
  if (risk >= 0.22) {
    return 'yellow';
  }
  return 'green';
}
