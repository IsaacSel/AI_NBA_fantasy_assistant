'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconArrowBackUp,
  IconChartBar,
  IconDeviceFloppy,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';

import { useAppData } from '@/components/AppDataProvider';
import {
  AvailableCard,
  DraftBoardCard,
  RecommendationsCard,
  YourTeamCard,
} from '@/components/draft/DraftParts';
import {
  PageLoader,
} from '@/components/common';
import {
  cpuPick,
  draftConfig,
  draftResults,
  nextPickFor,
  recommend,
  rosterFor,
  roundForPick,
  simulateDraft,
  teamForPick,
  totalPicks,
  type DraftConfig,
} from '@/lib/draft';
import type { DraftPick, Strategy, UserSettings } from '@/lib/types';
import {
  buildLineup,
  STRATEGIES,
  type ValuedPlayer,
} from '@/lib/valuation';

const CPU_PICK_DELAY_MS = 120;
const SIMULATIONS_PER_STRATEGY = 15;

interface StrategyComparison {
  strategy: Strategy;
  avgStarterFppg: number;
  avgRank: number;
  firstPlace: number;
  typicalFirstPicks: string[];
}

function teamLabel(team: number, myTeam: number): string {
  return team === myTeam ? 'You' : `Team ${team + 1}`;
}

export function DraftView() {
  const data = useAppData();
  const [config, setConfig] = useState<DraftConfig | null>(null);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [instant, setInstant] = useState(false);
  const [autoMe, setAutoMe] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [comparison, setComparison] = useState<StrategyComparison[] | null>(null);
  const [comparing, setComparing] = useState(false);

  const settings = data?.user.settings ?? null;

  // Valuations for the draft's league size: the chosen strategy, upside (for streaming rounds), and our model (for scoring results).
  const valuations = useMemo(() => {
    if (!data || !settings) {
      return null;
    }
    const chosen = data.valueWith(settings.strategy, settings.teams).players;
    const upside = data.valueWith('upside', settings.teams).players;
    const model = data.valueWith('balanced', settings.teams).players;
    return {
      chosen,
      byId: new Map(chosen.map((p) => [p.id, p])),
      upsideById: new Map(upside.map((p) => [p.id, p])),
      modelById: new Map(model.map((p) => [p.id, p])),
    };
  }, [data, settings]);

  const taken = useMemo(() => new Set(picks.map((pick) => pick.playerId)), [picks]);
  const available = useMemo(
    () => (valuations ? valuations.chosen.filter((player) => !taken.has(player.id)) : []),
    [valuations, taken],
  );

  const currentPick = picks.length + 1;
  const done = config ? picks.length >= totalPicks(config) : false;
  const onClock = config && !done ? teamForPick(currentPick, config.teams) : null;
  const myTurn = config !== null && onClock === config.myTeam;

  const makePick = useCallback((player: ValuedPlayer) => {
    if (!config) {
      return;
    }
    setPicks((current) => {
      const overall = current.length + 1;
      if (current.some((pick) => pick.playerId === player.id) || overall > totalPicks(config)) {
        return current;
      }
      return [
        ...current,
        {
          overall,
          round: roundForPick(overall, config.teams),
          team: teamForPick(overall, config.teams),
          playerId: player.id,
        },
      ];
    });
  }, [config]);

  const recommendations = useMemo(() => {
    if (!config || !valuations || !data || done) {
      return [];
    }
    return recommend(currentPick, picks, available, valuations.byId, valuations.upsideById, data.league, config);
  }, [config, valuations, data, done, currentPick, picks, available]);

  // CPU teams (and the user, with auto-draft on) pick automatically.
  useEffect(() => {
    if (!config || !valuations || !data || done || onClock === null) {
      return;
    }
    if (myTurn && !autoMe) {
      return;
    }
    const choose = () => (myTurn
      ? recommendations[0]?.player
      : cpuPick(onClock, currentPick, picks, available, valuations.byId, data.league, config));
    const timer = setTimeout(() => {
      const choice = choose();
      if (choice) {
        makePick(choice);
      }
    }, instant ? 0 : CPU_PICK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [config, valuations, data, done, onClock, myTurn, autoMe, instant, currentPick, picks, available, recommendations, makePick]);

  if (!data || !settings || !valuations) {
    return <PageLoader />;
  }

  const { league, user, updateUser } = data;

  const updateSettings = (patch: Partial<UserSettings>) => {
    void updateUser({ op: 'setSettings', patch });
  };

  const startDraft = () => {
    setConfig(draftConfig(settings.teams, settings.draftSlot, league, settings.streamingSlots, settings.streaming));
    setPicks([]);
    setDraftName('');
  };

  const undo = () => {
    if (!config) {
      return;
    }
    // Roll back to just before the user's most recent pick.
    const lastMine = [...picks].reverse().find((pick) => pick.team === config.myTeam);
    setAutoMe(false);
    setPicks(lastMine ? picks.slice(0, lastMine.overall - 1) : []);
  };

  const compareStrategies = () => {
    setComparing(true);
    // Defer so the button can show its loading state before the heavy work.
    setTimeout(() => {
      const upsideById = valuations.upsideById;
      const results = (Object.keys(STRATEGIES) as Strategy[]).map((strategy) => {
        const valued = data.valueWith(strategy, settings.teams).players;
        let totalFppg = 0;
        let totalRank = 0;
        let firstPlace = 0;
        const firstPicks = new Map<string, number>();
        for (let run = 0; run < SIMULATIONS_PER_STRATEGY; run++) {
          const simConfig = {
            ...draftConfig(settings.teams, settings.draftSlot, league, settings.streamingSlots, settings.streaming),
            seed: 1000 + run,
          };
          const simPicks = simulateDraft(valued, upsideById, league, simConfig);
          // Score every roster with our model so strategies are compared on the same yardstick.
          const results = draftResults(simPicks, valuations.modelById, league, simConfig);
          const mine = results.find((result) => result.team === simConfig.myTeam);
          if (mine) {
            totalFppg += mine.starterFppg;
            totalRank += mine.rank;
            firstPlace += mine.rank === 1 ? 1 : 0;
          }
          const firstPick = simPicks.find((pick) => pick.team === simConfig.myTeam);
          const name = firstPick ? valuations.modelById.get(firstPick.playerId)?.name : undefined;
          if (name) {
            firstPicks.set(name, (firstPicks.get(name) ?? 0) + 1);
          }
        }
        return {
          strategy,
          avgStarterFppg: Math.round((totalFppg / SIMULATIONS_PER_STRATEGY) * 10) / 10,
          avgRank: Math.round((totalRank / SIMULATIONS_PER_STRATEGY) * 10) / 10,
          firstPlace,
          typicalFirstPicks: [...firstPicks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name),
        };
      });
      setComparison(results.sort((a, b) => b.avgStarterFppg - a.avgStarterFppg));
      setComparing(false);
    }, 20);
  };

  // Setup screen.
  if (!config) {
    return (
      <Stack gap="md">
        <div>
          <Title order={2}>Mock draft</Title>
          <Text size="sm" c="dimmed">
            Snake draft against CPU teams using a ranking based on last-season production (not real ADP). Broad G/F/C lineup slots use the uploaded Kaggle positions; specific PG/SG/SF/PF eligibility is unverified.
            Recommendations use your chosen projection plus lineup needs and whether a player will last to your next pick.
          </Text>
        </div>
        <Paper withBorder p="md">
          <Group align="flex-end" gap="md">
            <NumberInput
              label="Teams"
              value={settings.teams}
              min={6}
              max={20}
              w={90}
              onChange={(value) => typeof value === 'number' && updateSettings({ teams: value, draftSlot: Math.min(settings.draftSlot, value) })}
            />
            <NumberInput
              label="Your draft slot"
              value={settings.draftSlot}
              min={1}
              max={settings.teams}
              w={130}
              onChange={(value) => typeof value === 'number' && updateSettings({ draftSlot: value })}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>Draft by</Text>
              <SegmentedControl
                value={settings.strategy}
                onChange={(value) => updateSettings({ strategy: value as Strategy })}
                data={Object.entries(STRATEGIES).map(([value, { label }]) => ({ value, label }))}
              />
            </div>
            <Stack gap={4}>
              <Switch
                label="Plan to stream"
                checked={settings.streaming}
                onChange={(event) => updateSettings({ streaming: event.currentTarget.checked })}
              />
              <NumberInput
                size="xs"
                description="Streaming spots (last rounds go for upside)"
                value={settings.streamingSlots}
                min={0}
                max={5}
                w={230}
                disabled={!settings.streaming}
                onChange={(value) => typeof value === 'number' && updateSettings({ streamingSlots: value })}
              />
            </Stack>
          </Group>
          <Text size="xs" c="dimmed" mt="sm">{STRATEGIES[settings.strategy].description}</Text>
          <Group mt="md">
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={startDraft}
            >
              Start mock draft
            </Button>
            <Button
              variant="default"
              leftSection={<IconChartBar size={16} />}
              loading={comparing}
              onClick={compareStrategies}
            >
              Compare strategies from this slot
            </Button>
          </Group>
        </Paper>

        {comparison && (
          <Card withBorder>
            <Title order={4}>Strategy comparison · slot {settings.draftSlot} of {settings.teams}</Title>
            <Text size="xs" c="dimmed" mb="sm">
              {SIMULATIONS_PER_STRATEGY} simulated drafts per strategy, your team auto-picking. Every roster is scored by our model&apos;s
              projected starting-lineup FPPG, so this measures which approach builds the best team if our projections are right.
            </Text>
            <Table fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Strategy</Table.Th>
                  <Table.Th>Avg starting lineup FPPG</Table.Th>
                  <Table.Th>Avg finish (of {settings.teams})</Table.Th>
                  <Table.Th>Best team in league</Table.Th>
                  <Table.Th>Usual first pick</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {comparison.map((row) => (
                  <Table.Tr key={row.strategy}>
                    <Table.Td fw={600}>{STRATEGIES[row.strategy].label}</Table.Td>
                    <Table.Td>{row.avgStarterFppg}</Table.Td>
                    <Table.Td>{row.avgRank}</Table.Td>
                    <Table.Td>{row.firstPlace} / {SIMULATIONS_PER_STRATEGY}</Table.Td>
                    <Table.Td>{row.typicalFirstPicks.join(', ')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}

        {user.drafts.length > 0 && (
          <Card withBorder>
            <Title order={4} mb="sm">Saved drafts</Title>
            <Table fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Setup</Table.Th>
                  <Table.Th>Finish</Table.Th>
                  <Table.Th>Lineup FPPG</Table.Th>
                  <Table.Th>Your picks</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {user.drafts.map((draft) => (
                  <Table.Tr key={draft.id}>
                    <Table.Td>{draft.name}</Table.Td>
                    <Table.Td>{new Date(draft.createdAt).toLocaleDateString()}</Table.Td>
                    <Table.Td>{draft.settings.teams} teams, slot {draft.settings.draftSlot}, {STRATEGIES[draft.settings.strategy].label}</Table.Td>
                    <Table.Td>{draft.summary.myRank} of {draft.settings.teams}</Table.Td>
                    <Table.Td>{draft.summary.myStarterFppg}</Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={2}>
                        {draft.picks
                          .filter((pick) => pick.team === draft.settings.draftSlot - 1)
                          .map((pick) => valuations.modelById.get(pick.playerId)?.name ?? pick.playerId)
                          .join(', ')}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => updateUser({ op: 'deleteDraft', draftId: draft.id })}
                        aria-label="Delete draft"
                      >
                        <IconTrash size={14} />
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}
      </Stack>
    );
  }

  const myRoster = rosterFor(config.myTeam, picks, valuations.byId);
  const myLineup = buildLineup(myRoster, league);
  const nextMine = nextPickFor(config.myTeam, currentPick, config);
  const results = done ? draftResults(picks, valuations.modelById, league, config) : null;
  const myResult = results?.find((result) => result.team === config.myTeam);

  const saveDraft = async () => {
    if (!myResult) {
      return;
    }
    await updateUser({
      op: 'saveDraft',
      draft: {
        name: draftName.trim() || `Slot ${settings.draftSlot} · ${STRATEGIES[settings.strategy].label}`,
        settings,
        picks,
        summary: {
          myRank: myResult.rank,
          myStarterFppg: myResult.starterFppg,
        },
      },
    });
    setConfig(null);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={2}>Mock draft</Title>
          <Text size="sm" c="dimmed">
            {config.teams} teams · slot {config.myTeam + 1} · {STRATEGIES[settings.strategy].label}
            {config.streamingRounds > 0 && ` · last ${config.streamingRounds} rounds for upside (streaming)`}
          </Text>
        </div>
        <Group gap="sm">
          <Switch
            label="Instant CPU picks"
            checked={instant}
            onChange={(event) => setInstant(event.currentTarget.checked)}
          />
          <Switch
            label="Auto-draft for me"
            checked={autoMe}
            onChange={(event) => setAutoMe(event.currentTarget.checked)}
          />
          <Button
            variant="default"
            leftSection={<IconArrowBackUp size={16} />}
            onClick={undo}
            disabled={!picks.some((pick) => pick.team === config.myTeam)}
          >
            Undo my last pick
          </Button>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={() => setConfig(null)}
          >
            New draft
          </Button>
        </Group>
      </Group>

      {!done && (
        <Paper withBorder p="sm">
          <Group justify="space-between">
            <Text fw={600}>
              Round {roundForPick(currentPick, config.teams)} · Pick {currentPick} of {totalPicks(config)} ·{' '}
              {myTurn ? <Text span c="orange" fw={700}>You&apos;re on the clock</Text> : `${teamLabel(onClock ?? 0, config.myTeam)} picking…`}
            </Text>
            {nextMine && !myTurn && <Text size="sm" c="dimmed">Your next pick: #{nextMine} ({nextMine - currentPick} away)</Text>}
          </Group>
          <Progress value={(picks.length / totalPicks(config)) * 100} mt="xs" size="sm" />
        </Paper>
      )}

      {done && results && myResult && (
        <Card withBorder>
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>Draft complete: you finished #{myResult.rank} of {config.teams}</Title>
              <Text size="sm" c="dimmed">Teams ranked by projected starting-lineup FPPG (our model).</Text>
            </div>
            <Group gap="xs" align="flex-end">
              <TextInput
                placeholder="Name this draft"
                value={draftName}
                onChange={(event) => setDraftName(event.currentTarget.value)}
              />
              <Button leftSection={<IconDeviceFloppy size={16} />} onClick={saveDraft}>Save</Button>
            </Group>
          </Group>
          <SimpleGrid cols={{ base: 2, sm: 4, lg: 6 }} mt="md">
            {results.map((result) => (
              <Paper
                key={result.team}
                withBorder
                p="xs"
                className={result.team === config.myTeam ? 'border-orange-500 border-2' : ''}
              >
                <Text size="xs" c="dimmed">#{result.rank}</Text>
                <Text fw={700}>{teamLabel(result.team, config.myTeam)}</Text>
                <Text size="sm">{result.starterFppg} FPPG</Text>
              </Paper>
            ))}
          </SimpleGrid>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Stack gap="md" className="lg:col-span-2">
          {!done && (
            <RecommendationsCard
              recommendations={recommendations}
              hasNextPick={nextMine !== null}
              canPick={myTurn}
              onPick={makePick}
              tagFor={(id) => user.players[String(id)]?.tag}
            />
          )}

          {!done && (
            <AvailableCard
              players={available}
              canPick={myTurn}
              onPick={makePick}
            />
          )}

          {done && results && (
            <Card withBorder>
              <Title order={4} mb="sm">Every roster</Title>
              <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }}>
                {results.map((result) => (
                  <div key={result.team}>
                    <Text fw={700} size="sm">{teamLabel(result.team, config.myTeam)} · {result.starterFppg} FPPG</Text>
                    <Text size="xs" c="dimmed">{result.roster.map((player) => player.name).join(', ')}</Text>
                  </div>
                ))}
              </SimpleGrid>
            </Card>
          )}
        </Stack>

        <Stack gap="md">
          <YourTeamCard lineup={myLineup} />

          <DraftBoardCard
            picks={picks}
            byId={valuations.byId}
            teams={config.teams}
            myTeam={config.myTeam}
            teamLabel={(team) => teamLabel(team, config.myTeam)}
          />

          {!myTurn && !done && autoMe === false && nextMine === null && (
            <Alert color="gray">Your roster is full; the CPU teams are finishing up.</Alert>
          )}
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
