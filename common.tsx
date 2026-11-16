'use client';
import Link from 'next/link';
import { Anchor, Badge, Text } from '@mantine/core';
import type { Player } from '@/lib/types';
export function PlayerLink({ player }: { player: Pick<Player, 'id'|'name'> }) {
  return <Anchor component={Link} href={`/players/${player.id}`} fw={600} size="sm">{player.name}</Anchor>;
}
export function Numeric({ value, digits=2 }: { value: number | null | undefined; digits?: number }) {
  return <Text size="sm" span>{value == null ? '—' : value.toFixed(digits)}</Text>;
}
export function DataSourceBadge() {
  return <Badge color="orange" variant="light">Historical averages · not a forecast</Badge>;
}
