'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  List,
  NumberInput,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconArrowLeft,
  IconInfoCircle,
  IconTrash,
} from '@tabler/icons-react';

import { useAppData } from '@/components/AppDataProvider';
import { GameLogsPanel } from '@/components/player/GameLogsPanel';
import {
  formatNumber,
  formatPercent,
  PageLoader,
  PlayerBadges,
  riskColor,
  TAG_OPTIONS,
} from '@/components/common';
import type {
  OpponentSplit,
  PlayerTag,
  Profile,
  Split,
  TeammateEffect,
} from '@/lib/types';
import type { ValuedPlayer } from '@/lib/valuation';

const TRAIT_LABELS: Record<string, string> = {
  PTS: 'Scoring',
  FGA: 'Shot volume',
  '3PA': '3PT volume',
  FTA: 'Free throw volume',
  REB: 'Rebounding',
  OREB: 'Offensive rebounding',
  AST: 'Playmaking',
  STL: 'Steals',
  BLK: 'Blocks',
  TO: 'Turnovers',
  USG: 'Usage',
  TS: 'Shooting efficiency',
  '3PA_RATE': 'Share of shots from 3',
  FT_RATE: 'Foul drawing',
  STOCKS: 'Steals + blocks',
};
const RATE_TRAITS = new Set(['TS', '3PA_RATE', 'FT_RATE']);

const MATCHUP_ROWS: { key: string; label: (position: string) => string }[] = [
  { key: 'vs_tough_defenses', label: () => 'vs 10 toughest defenses' },
  { key: 'vs_soft_defenses', label: () => 'vs 10 weakest defenses' },
  { key: 'vs_tough_position_defenses', label: (p) => `vs 10 best at defending ${p}s` },
  { key: 'vs_soft_position_defenses', label: (p) => `vs 10 worst at defending ${p}s` },
  { key: 'home', label: () => 'Home' },
  { key: 'away', label: () => 'Away' },
  { key: 'back_to_back', label: () => 'Back-to-backs' },
  { key: 'rested_2plus_days', label: () => '2+ days rest' },
  { key: 'wins', label: () => 'Wins' },
  { key: 'losses', label: () => 'Losses' },
  { key: 'blowouts', label: () => 'Blowouts (20+ pts)' },
  { key: 'close_games', label: () => 'Close games (≤5 pts)' },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder padding="md">
      <Title order={4}>{title}</Title>
      {description && <Text size="xs" c="dimmed" mb="sm">{description}</Text>}
      <div className={description ? '' : 'mt-3'}>{children}</div>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {hint ? (
          <Tooltip label={hint} multiline w={240}>
            <span className="cursor-help border-b border-dotted">{label}</span>
          </Tooltip>
        ) : label}
      </Text>
      <Text size="xl" fw={700}>{value}</Text>
    </div>
  );
}

function SplitTable({ rows, showVsAvg = false }: { rows: [string, Split | null | undefined][]; showVsAvg?: boolean }) {
  const present = rows.filter((row): row is [string, Split] => Boolean(row[1]));
  if (!present.length) {
    return <Text size="sm" c="dimmed">Not enough games.</Text>;
  }
  return (
    <Table.ScrollContainer minWidth={420}>
      <Table fz="sm" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th>GP</Table.Th>
            <Table.Th>MPG</Table.Th>
            <Table.Th>FPPG</Table.Th>
            <Table.Th>FP/36</Table.Th>
            {showVsAvg && <Table.Th>FP/36 vs avg</Table.Th>}
            {showVsAvg && <Table.Th>Typical player</Table.Th>}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {present.map(([label, split]) => {
            const notable = split.FP36_vs_typical !== undefined && Math.abs(split.FP36_vs_typical) >= 3;
            return (
              <Table.Tr key={label}>
                <Table.Td>{label}</Table.Td>
                <Table.Td>{split.GP}</Table.Td>
                <Table.Td>{formatNumber(split.MPG)}</Table.Td>
                <Table.Td>{formatNumber(split.FPPG)}</Table.Td>
                <Table.Td>{formatNumber(split.FP_per_36)}</Table.Td>
                {showVsAvg && (
                  <Table.Td>
                    <Text
                      size="sm"
                      fw={notable ? 700 : 400}
                      c={notable ? ((split.FP36_vs_typical ?? 0) > 0 ? 'green' : 'red') : undefined}
                    >
                      {split.FP36_vs_avg !== undefined ? `${split.FP36_vs_avg > 0 ? '+' : ''}${split.FP36_vs_avg}` : '–'}
                    </Text>
                  </Table.Td>
                )}
                {showVsAvg && <Table.Td>{split.typical !== undefined ? `${split.typical > 0 ? '+' : ''}${split.typical}` : '–'}</Table.Td>}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function TeammateTable({ title, effects, emphasis }: { title: string; effects: TeammateEffect[]; emphasis: 'fppg' | 'fp36' | 'starts' }) {
  if (!effects.length) {
    return null;
  }
  return (
    <div>
      <Text fw={600} size="sm" mb={4}>{title}</Text>
      <Table.ScrollContainer minWidth={520}>
        <Table fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Teammate</Table.Th>
              <Table.Th>With (GP)</Table.Th>
              <Table.Th>Without (GP)</Table.Th>
              <Table.Th>FPPG with → without</Table.Th>
              <Table.Th>FP/36 with → without</Table.Th>
              <Table.Th>Starts with → without</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {effects.map((effect) => (
              <Table.Tr key={`${effect.teammate_id}-${effect.team}`}>
                <Table.Td>
                  <Anchor component={Link} href={`/players/${effect.teammate_id}`} size="sm">{effect.teammate}</Anchor>
                  <Text span size="xs" c="dimmed"> {effect.team}</Text>
                </Table.Td>
                <Table.Td>{effect.with.GP}</Table.Td>
                <Table.Td>{effect.without.GP}</Table.Td>
                <Table.Td fw={emphasis === 'fppg' ? 700 : 400}>{effect.with.FPPG} → {effect.without.FPPG}</Table.Td>
                <Table.Td fw={emphasis === 'fp36' ? 700 : 400}>{formatNumber(effect.with.FP_per_36)} → {formatNumber(effect.without.FP_per_36)}</Table.Td>
                <Table.Td fw={emphasis === 'starts' ? 700 : 400}>{formatPercent(effect.with.start_rate)} → {formatPercent(effect.without.start_rate)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </div>
  );
}

function MyTake({ player }: { player: ValuedPlayer }) {
  const data = useAppData();
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  if (!data) {
    return null;
  }
  const mine = data.user.players[String(player.id)] ?? {};
  const update = (patch: { tier?: number | null; tag?: PlayerTag | null; adjustment?: number | null }) => data.updateUser({
    op: 'setPlayer',
    playerId: player.id,
    patch,
  });

  const addNote = async () => {
    setSaving(true);
    await data.updateUser({ op: 'addNote', playerId: player.id, text: noteText });
    setNoteText('');
    setSaving(false);
  };

  return (
    <Section title="My take" description="Saved locally in data/user/user.json. Adjustments change this player's projection everywhere in the app.">
      <Stack gap="sm">
        <Group gap="md" align="flex-end">
          <NumberInput
            label="Tier"
            placeholder="–"
            value={mine.tier ?? ''}
            min={1}
            max={20}
            w={90}
            onChange={(value) => update({ tier: typeof value === 'number' ? value : null })}
          />
          <NumberInput
            label="FPPG adjustment"
            description="Your +/- on our projection"
            value={mine.adjustment ?? 0}
            step={0.5}
            decimalScale={1}
            w={170}
            onChange={(value) => update({ adjustment: typeof value === 'number' && value !== 0 ? value : null })}
          />
          <div>
            <Text size="sm" fw={500} mb={4}>Tag</Text>
            <SegmentedControl
              value={mine.tag ?? 'none'}
              onChange={(value) => update({ tag: value === 'none' ? null : value as PlayerTag })}
              data={[
                { value: 'none', label: 'None' },
                ...Object.entries(TAG_OPTIONS).map(([value, { label }]) => ({ value, label })),
              ]}
            />
          </div>
        </Group>
        <Textarea
          placeholder="Add a note: role news, a matchup to watch, gut feel…"
          autosize
          minRows={2}
          value={noteText}
          onChange={(event) => setNoteText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && noteText.trim()) {
              void addNote();
            }
          }}
        />
        <Group justify="flex-end">
          <Button
            size="xs"
            onClick={addNote}
            loading={saving}
            disabled={!noteText.trim()}
          >
            Add note
          </Button>
        </Group>
        {(mine.notes ?? []).map((note) => (
          <Card key={note.id} withBorder padding="xs">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Text size="sm" className="whitespace-pre-wrap">{note.text}</Text>
                <Text size="xs" c="dimmed">{new Date(note.createdAt).toLocaleString()}</Text>
              </div>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Delete note"
                onClick={() => data.updateUser({ op: 'deleteNote', playerId: player.id, noteId: note.id })}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          </Card>
        ))}
      </Stack>
    </Section>
  );
}

export function PlayerView({ id }: { id: number }) {
  const data = useAppData();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/players/${id}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.json()).error ?? 'Failed to load profile');
        }
        return response.json() as Promise<Profile>;
      })
      .then(setProfile)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return <Alert color="red" title="Couldn't load player">{error}</Alert>;
  }
  if (!data || !profile) {
    return <PageLoader />;
  }

  const player = data.valued.find((p) => p.id === id);
  const season = profile.season_2026;
  const matchups = profile.matchups ?? {};
  const best = (matchups.best_opponents as OpponentSplit[] | undefined) ?? [];
  const worst = (matchups.worst_opponents as OpponentSplit[] | undefined) ?? [];
  const college = profile.college_2026;

  return (
    <Stack gap="md">
      <Anchor component={Link} href="/" size="sm">
        <Group gap={4}><IconArrowLeft size={14} /> Rankings</Group>
      </Anchor>

      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="sm">
            <Title order={2}>{profile.name}</Title>
            {player && <PlayerBadges player={player} />}
          </Group>
          <Text c="dimmed">
            {profile.position} · {profile.outlook.team_2027 ?? profile.team_2026 ?? 'FA'}
            {profile.position !== 'UNK' && profile.eligible_positions && ` · Broad G/F/C slot categories: ${profile.eligible_positions.filter(p => p !== 'UTIL').join(', ')}`}
            {profile.position === 'UNK' && ' · position unavailable'}
          </Text>
        </div>
        {player && (
          <Group gap="xl">
            <Stat label="Our rank" value={`#${player.rank}`} />
            <Stat label="FPPG" value={formatNumber(player.strategyFppg)} hint="Under your selected projection, including your adjustment." />
            <Stat label="2025-26 FPPG" value={formatNumber(player.season_2026?.FPPG)} />
            <Stat label="Value" value={player.value} hint="Season fantasy points above waiver-wire replacement." />
          </Group>
        )}
      </Group>

      {!player && (
        <Alert icon={<IconInfoCircle size={16} />} color="gray">
          No current fantasy baseline is available for this player.
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Section title="Scouting notes">
          <List spacing={6} size="sm">
            {profile.scouting_notes.map((note) => <List.Item key={note}>{note}</List.Item>)}
          </List>
        </Section>
        {player ? <MyTake player={player} /> : <div />}
      </SimpleGrid>

      {player && (
        <Section title="AI-assisted draft projection" description="70% machine-learned next-game production and 30% weighted historical baseline for qualified players. No future opponent, injury, or role changes are known.">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Draft proxy FPPG" value={formatNumber(player.model.fppg)} />
            <Stat label="Transformer next game" value={formatNumber(player.model.transformer_next_game)} />
            <Stat label="Gradient boosting next game" value={formatNumber(player.model.gb_next_game)} />
            <Stat label="Minutes" value={formatNumber(player.model.mpg)} />
            <Stat label="Games" value={player.model.gp ?? '–'} />
            <Stat label="FP / 36" value={formatNumber(player.model.rate)} />
            <Stat label="Last season FPPG" value={formatNumber(player.season_2026?.FPPG)} hint="Actual 2025-26 averages." />
            <Stat label="Nightly p10–p90" value={`${formatNumber(player.model.floor_fppg)}–${formatNumber(player.model.ceiling_fppg)}`} hint="Observed distribution of 2025–26 game scores, not a calibrated prediction interval." />
            <Stat label="Last season GP" value={player.season_2026?.GP ?? '–'} />
            <Stat label="Projected total (proxy)" value={player.model.total ?? '–'} />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md">
            <div>
              <Text fw={600} size="sm">Good case: {formatNumber(player.upside_fppg)} FPPG</Text>
              <Text size="sm" c="dimmed">{player.upside_reasons.join(' · ') || 'No specific upside signals'}</Text>
            </div>
            <div>
              <Group gap="xs">
                <Text fw={600} size="sm">Risk</Text>
                <Badge color={riskColor(player.risk)} variant="light">{player.risk.toFixed(2)}</Badge>
              </Group>
              <Text size="sm" c="dimmed">{player.risk_reasons.join(' · ') || 'No major risk flags'}</Text>
            </div>
          </SimpleGrid>
        </Section>
      )}

      {season && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Section title="2025-26 season">
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Stat label="FPPG" value={formatNumber(season.FPPG)} />
              <Stat label="Games" value={season.GP} />
              <Stat label="Minutes" value={formatNumber(season.MPG)} />
              <Stat label="FPPG rank" value={season.FPPG_rank ? `#${season.FPPG_rank}` : '–'} hint="Among players with 40+ games." />
            </SimpleGrid>
            <Text size="sm" mt="md">
              {season.per_game.PTS} pts · {season.per_game.REB} reb · {season.per_game.AST} ast · {season.per_game.STL} stl · {season.per_game.BLK} blk · {season.per_game.TO} to · {season.per_game['3PM']} 3pm
            </Text>
            <Text size="sm" c="dimmed">
              FG {formatPercent(season.FG_pct, 1)} · 3P {formatPercent(season['3P_pct'], 1)} · FT {formatPercent(season.FT_pct, 1)} · TS {formatPercent(season.TS, 1)}
            </Text>
            {profile.team_share_when_playing && (
              <Text size="sm" mt="xs">
                Share of team when playing: <b>{formatPercent(profile.team_share_when_playing.FPTS, 1)}</b> of fantasy points, {formatPercent(profile.team_share_when_playing.PTS, 1)} of points
              </Text>
            )}
            {profile.playoffs_2026 && (
              <Text size="sm" mt="xs">
                Playoffs: {profile.playoffs_2026.GP} games, {profile.playoffs_2026.MPG} MPG, {profile.playoffs_2026.FPPG} FPPG
              </Text>
            )}
            {profile.fp_breakdown && (
              <>
                <Text fw={600} size="sm" mt="md" mb={4}>Where the fantasy points come from</Text>
                <Stack gap={4}>
                  {Object.entries(profile.fp_breakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([part, share]) => (
                      <Group key={part} gap="xs" wrap="nowrap">
                        <Text size="xs" w={110}>{part}</Text>
                        <Progress
                          value={Math.abs(share) * 100}
                          color={share < 0 ? 'red' : 'orange'}
                          className="flex-1"
                        />
                        <Text size="xs" w={48} ta="right">{formatPercent(share)}</Text>
                      </Group>
                    ))}
                </Stack>
              </>
            )}
          </Section>

          <Section
            title="Style"
            description={`Per 36 minutes, with percentile vs the league${profile.low_minutes_sample ? ' (small minutes sample)' : ''}.`}
          >
            <Stack gap={4}>
              {Object.entries(TRAIT_LABELS).map(([trait, label]) => {
                const value = profile.per_36?.[trait];
                const pct = profile.league_percentiles?.[trait] ?? null;
                return (
                  <Group key={trait} gap="xs" wrap="nowrap">
                    <Text size="xs" w={140}>{label}</Text>
                    <Text size="xs" w={52} ta="right">{RATE_TRAITS.has(trait) ? formatPercent(value, 1) : formatNumber(value)}</Text>
                    <Progress
                      value={pct ?? 0}
                      color={trait === 'TO' ? 'red' : 'blue'}
                      className="flex-1"
                    />
                    <Text size="xs" w={28} ta="right">{pct ?? '–'}</Text>
                  </Group>
                );
              })}
            </Stack>
            {profile.archetypes && profile.archetypes.length > 0 && (
              <Group gap={6} mt="sm">
                {profile.archetypes.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </Group>
            )}
          </Section>
        </SimpleGrid>
      )}

      {profile.season_history && profile.season_history.length > 0 && (
        <Section title="Season-by-season averages (2018–2026)" description="From the eight uploaded Kaggle-derived CSVs. One row per season, per-game averages; traded players are combined.">
          <Table.ScrollContainer minWidth={750}>
            <Table striped highlightOnHover fz="sm">
              <Table.Thead><Table.Tr>
                {['Season', 'Team', 'GP', 'MPG', 'FPPG', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM'].map((key) => <Table.Th key={key}>{key}</Table.Th>)}
              </Table.Tr></Table.Thead>
              <Table.Tbody>
                {[...profile.season_history].reverse().map((line) => (
                  <Table.Tr key={line.season}>
                    <Table.Td>{line.season}</Table.Td><Table.Td>{line.teams || line.team}</Table.Td>
                    <Table.Td>{line.GP}</Table.Td><Table.Td>{line.MPG}</Table.Td>
                    <Table.Td fw={600}>{line.FPPG}</Table.Td><Table.Td>{line.PTS}</Table.Td>
                    <Table.Td>{line.REB}</Table.Td><Table.Td>{line.AST}</Table.Td>
                    <Table.Td>{line.STL}</Table.Td><Table.Td>{line.BLK}</Table.Td><Table.Td>{line['3PM']}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Section>
      )}

      <GameLogsPanel playerId={id} />

      {season && profile.role && (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Section title="Game-level trends">
            <SplitTable
              rows={[
                ['As starter', profile.role.as_starter],
                ['Off the bench', profile.role.off_bench],
                ['First half of season', profile.role.first_half],
                ['Second half of season', profile.role.second_half],
                ['Last 20 games', profile.role.last_20_games],
              ]}
            />
            <Group gap="xs" mt="sm">
              {Object.entries(profile.role.by_month).map(([month, split]) => split && (
                <Badge key={month} variant="light" color="gray">
                  {new Date(`${month}-01T12:00:00`).toLocaleString('en-US', { month: 'short' })}: {split.FPPG}
                </Badge>
              ))}
            </Group>
          </Section>
          <Section title="Consistency" description="How predictable their nightly fantasy output is.">
            {profile.consistency ? (
              <SimpleGrid cols={{ base: 2, sm: 3 }}>
                <Stat label="Median" value={profile.consistency.median} />
                <Stat label="Bad night (10th pct)" value={profile.consistency.floor_p10} />
                <Stat label="Great night (90th pct)" value={profile.consistency.ceiling_p90} />
                <Stat label="Boom games" value={formatPercent(profile.consistency.boom_rate)} hint="Games at 130%+ of their average." />
                <Stat label="Bust games" value={formatPercent(profile.consistency.bust_rate)} hint="Games at 70% or less of their average." />
                <Stat label="Best / worst" value={`${profile.consistency.best_game} / ${profile.consistency.worst_game}`} />
              </SimpleGrid>
            ) : <Text size="sm" c="dimmed">Not enough games.</Text>}
          </Section>
        </SimpleGrid>
      )}

      {season && profile.teammates && (
        <Section
          title="Teammates"
          description="Game-level with/without splits. A teammate counts as out only when they were absent (injured, resting, inactive), and only teammates averaging 20+ minutes are compared."
        >
          <Stack gap="md">
            <TeammateTable title="Starts more when they're out" effects={profile.teammates.starts_more_when_out} emphasis="starts" />
            <TeammateTable title="Benefits when they're out" effects={profile.teammates.benefits_when_out} emphasis="fppg" />
            <TeammateTable title="Plays best with" effects={profile.teammates.plays_best_with} emphasis="fp36" />
            {!profile.teammates.starts_more_when_out.length && !profile.teammates.benefits_when_out.length && !profile.teammates.plays_best_with.length && (
              <Text size="sm" c="dimmed">No teammate effects with enough games on both sides.</Text>
            )}
          </Stack>
        </Section>
      )}

      {season && (
        <Section
          title="Matchups and situations"
          description="Bold rows differ from the typical player's swing by 3+ FP/36. Defenses are ranked by fantasy points allowed."
        >
          <SplitTable
            showVsAvg
            rows={MATCHUP_ROWS.map(({ key, label }) => [label(profile.position), matchups[key] as Split | null])}
          />
          {best.length > 0 && (
            <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm">
              <Text size="sm"><b>Best opponents:</b> {best.map((o) => `${o.opponent} ${o.FPPG} (${o.GP}g)`).join(', ')}</Text>
              <Text size="sm"><b>Worst opponents:</b> {worst.map((o) => `${o.opponent} ${o.FPPG} (${o.GP}g)`).join(', ')}</Text>
            </SimpleGrid>
          )}
        </Section>
      )}

      {college && (
        <Section title={`College 2025-26 · ${college.college ?? ''}`} description="Fantasy points use our league scoring. Percentiles are vs this rookie class.">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="FPPG" value={formatNumber(college.FPPG)} />
            <Stat label="FP / 40" value={formatNumber(college.FP_per_40)} />
            <Stat label="Games" value={college.GP} />
            <Stat label="Minutes" value={formatNumber(college.MPG)} />
          </SimpleGrid>
          <Text size="sm" mt="md">
            {college.per_game.PTS} pts · {college.per_game.REB} reb · {college.per_game.AST} ast · {college.per_game.STL} stl · {college.per_game.BLK} blk · {college.per_game.TO} to
          </Text>
          <Text size="sm" c="dimmed">
            FG {formatPercent(college.FG_pct, 1)} · 3P {formatPercent(college['3P_pct'], 1)} · FT {formatPercent(college.FT_pct, 1)} · TS {formatPercent(college.TS, 1)}
          </Text>
          <Group gap="xs" mt="sm">
            {college.vs_ranked && <Badge variant="light">vs ranked: {college.vs_ranked.FPPG} FPPG ({college.vs_ranked.GP}g)</Badge>}
            {college.vs_unranked && <Badge variant="light" color="gray">vs unranked: {college.vs_unranked.FPPG} FPPG ({college.vs_unranked.GP}g)</Badge>}
            {college.postseason && <Badge variant="light" color="grape">postseason: {college.postseason.FPPG} FPPG ({college.postseason.GP}g)</Badge>}
          </Group>
          <Text size="sm" mt="sm">
            <b>Best games:</b> {college.best_games.map((g) => `${g.opponent} (${g.PTS}/${g.REB}/${g.AST}, ${g.FPTS} FP)`).join(' · ')}
          </Text>
        </Section>
      )}

      {profile.outlook.preseason && (
        <Section title="2027 preseason" description="Tiny sample against mixed competition; read it as a role signal.">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Games" value={profile.outlook.preseason.GP} />
            <Stat label="Minutes" value={formatNumber(profile.outlook.preseason.MPG)} />
            <Stat label="FPPG" value={formatNumber(profile.outlook.preseason.FPPG)} />
            <Stat label="FP / 36" value={formatNumber(profile.outlook.preseason.FP_per_36)} />
          </SimpleGrid>
        </Section>
      )}
    </Stack>
  );
}
