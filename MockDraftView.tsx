'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Group, NumberInput, Paper, Progress, ScrollArea, Select,
  SimpleGrid, Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconArrowBackUp, IconBolt, IconPlayerPlay, IconRefresh, IconSearch, IconTrophy } from '@tabler/icons-react';
import { useAppData } from '@/components/AppDataProvider';
import { DataSourceBadge, Numeric, PlayerLink } from '@/components/common';
import {
  DEFAULT_MOCK_SETTINGS, DRAFT_FOCUS_OPTIONS, advanceToHuman, availablePlayers,
  finishDraft, humanDraft, normalizedSettings, priorityScore, recommend,
  restoreMockSession, teamAtPick, teamStrategy, undoLastHumanPick,
  type DraftFocus, type MockSession,
} from '@/lib/mockDraft';
import type { Player } from '@/lib/types';

const STORAGE_KEY = 'fantasy-hoops-mock-draft-csv-v1';
const initialSession = (): MockSession => ({ started:false,settings:DEFAULT_MOCK_SETTINGS,picks:[] });
const BOT_MODES = [
  {value:'mixed',label:'Mixed strategies'},
  {value:'best',label:'Highest historical FPPG'},
  {value:'specialists',label:'Stat-category specialists'},
];
const format = (value: number): string => value.toFixed(1);

function Summary({player, tag}: {player: Player; tag?:string}) {
  return <Group gap="xs" wrap="nowrap">
    <PlayerLink player={player}/>
    {tag && <Badge size="xs" variant="light" color="orange">{tag}</Badge>}
  </Group>;
}

export function MockDraftView() {
  const {players,byId,league}=useAppData();
  const [session,setSession]=useState<MockSession>(initialSession);
  const [hydrated,setHydrated]=useState(false);
  const [search,setSearch]=useState('');
  const [teamFilter,setTeamFilter]=useState<string|null>(null);
  const [showAll,setShowAll]=useState(false);

  useEffect(()=>{
    try {
      const raw=localStorage.getItem(STORAGE_KEY);
      const restored=raw ? restoreMockSession(JSON.parse(raw),players) : null;
      if (restored) setSession(restored);
    } catch { /* Ignore corrupted or inaccessible browser storage. */ }
    setHydrated(true);
  },[players]);
  useEffect(()=>{
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(session)); }
    catch { /* The simulator still works when browser storage is disabled. */ }
  },[session,hydrated]);

  const {settings,picks,started}=session;
  const eligibleCount=useMemo(()=>players.filter(p=>p.gp>=settings.minGames).length,[players,settings.minGames]);
  const totalPicks=settings.teams*settings.rounds;
  const done=picks.length>=totalPicks;
  const nextTeam=done?null:teamAtPick(picks.length,settings.teams);
  const yourTurn=started && nextTeam===settings.slot;
  const available=useMemo(()=>availablePlayers(players,picks,settings.minGames),[players,picks,settings.minGames]);
  const recommended=useMemo(()=>recommend(players,picks,settings,5),[players,picks,settings]);
  const teamNames=useMemo(()=>[...new Set(players.flatMap(p=>p.teams))].sort(),[players]);
  const filtered=useMemo(()=>available.filter(p=>(!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()))
    &&(!teamFilter || p.teams.includes(teamFilter)))
    .sort((a,b)=>priorityScore(b,settings.myFocus)-priorityScore(a,settings.myFocus)||b.fppg-a.fppg),
  [available,search,teamFilter,settings.myFocus]);
  const draftedTeams=useMemo(()=>Array.from({length:settings.teams},(_,i)=>{
    const team=i+1;
    const roster=picks.filter(p=>p.team===team).map(p=>byId.get(p.playerId)).filter((p):p is Player=>!!p);
    return {team,roster,historyFppg:roster.reduce((sum,p)=>sum+p.fppg,0),
      avgGp:roster.length?roster.reduce((sum,p)=>sum+p.gp,0)/roster.length:0};
  }),[settings.teams,picks,byId]);
  const yourRoster=draftedTeams[settings.slot-1]?.roster ?? [];
  const chosen=new Map(picks.map(p=>[p.overall,p] as const));

  function updateSettings(fields: Partial<typeof settings>) {
    if (started) return;
    setSession(old=>({...old,settings:normalizedSettings({...old.settings,...fields})}));
  }
  function beginDraft() {
    if (eligibleCount<totalPicks) return;
    const adjusted=normalizedSettings({...settings,seed:Math.floor(Math.random()*1000000)+1});
    setSession({started:true,settings:adjusted,picks:advanceToHuman(players,[],adjusted)});
    setSearch('');setShowAll(false);
  }
  function selectPlayer(playerId: number) {
    if (!yourTurn) return;
    setSession(old=>({...old,picks:humanDraft(players,old.picks,old.settings,playerId)}));
    setShowAll(false);
  }
  function autoFinish() {
    if (!window.confirm('Automatically pick for your team too, using your selected historical stat priority, and finish this entire draft?')) return;
    setSession(old=>({...old,picks:finishDraft(players,old.picks,old.settings)}));
  }
  function restart() {
    if (picks.length>0 && !window.confirm('Restart this mock draft? Saved selections will be cleared.')) return;
    setSession(old=>({...old,started:false,picks:[]}));
    setSearch('');setShowAll(false);
  }

  if (!hydrated) return <Text c="dimmed">Loading saved mock draft…</Text>;

  return <Stack gap="md">
    <Group justify="space-between" align="start" wrap="wrap">
      <div>
        <Title order={2}>Fantasy mock draft simulator</Title>
        <Text size="sm" c="dimmed">Draft against computer opponents using the {league.season} player averages from your CSV.</Text>
      </div>
      <DataSourceBadge/>
    </Group>
    <Alert color="blue" variant="light" title="Historical-data simulation, not future predictions">
      All selections use CSV fantasy points per game, games played, and statistical averages. There are no real player positions,
      ESPN average draft positions, injuries, schedules, or 2026–27 projections. Computer teams use transparent scoring rules with a new randomized draft sequence each time, not a trained AI model.
    </Alert>

    <Paper withBorder p="md">
      <Group justify="space-between" align="center" mb="sm">
        <Title order={4}>{started?'Draft settings':'Configure your mock draft'}</Title>
        {started && <Badge color="gray" variant="outline">Settings locked until restart</Badge>}
      </Group>
      <SimpleGrid cols={{base:2,sm:3,lg:6}} spacing="md">
        <NumberInput label="Teams" min={2} max={20} value={settings.teams} disabled={started}
          onChange={v=>updateSettings({teams:Number(v)||10})}/>
        <NumberInput label="Rounds" min={1} max={20} value={settings.rounds} disabled={started}
          onChange={v=>updateSettings({rounds:Number(v)||13})}/>
        <NumberInput label="Your draft slot" min={1} max={settings.teams} value={settings.slot} disabled={started}
          onChange={v=>updateSettings({slot:Number(v)||1})}/>
        <NumberInput label="Minimum games" description="2025–26 GP" min={0} max={60} value={settings.minGames} disabled={started}
          onChange={v=>updateSettings({minGames:Number(v)||0})}/>
        <Select label="Opponent behavior" data={BOT_MODES} value={settings.botMode} disabled={started}
          onChange={v=>v&&updateSettings({botMode:v as typeof settings.botMode})}/>
        <Select label="Your pick priority" data={DRAFT_FOCUS_OPTIONS} value={settings.myFocus} disabled={started}
          onChange={v=>v&&updateSettings({myFocus:v as DraftFocus})}/>
      </SimpleGrid>
      {eligibleCount<totalPicks && !started && <Alert mt="sm" color="red">Only {eligibleCount} players meet the minimum-games rule, but this draft requires {totalPicks} picks. Reduce rounds, teams, or minimum games.</Alert>}
      <Group mt="md" gap="sm">
        {!started ? <Button leftSection={<IconPlayerPlay size={16}/>} disabled={eligibleCount<totalPicks} onClick={beginDraft}>
          Start mock draft ({settings.teams} teams × {settings.rounds} rounds)
        </Button> : <>
          <Button variant="outline" color="gray" leftSection={<IconArrowBackUp size={16}/>} disabled={!picks.some(p=>p.team===settings.slot)}
            onClick={()=>setSession(old=>({...old,picks:undoLastHumanPick(old.picks,old.settings.slot)}))}>Undo my last pick</Button>
          <Button color="orange" variant="light" leftSection={<IconBolt size={16}/>} disabled={done} onClick={autoFinish}>Auto-finish draft</Button>
          <Button color="red" variant="subtle" leftSection={<IconRefresh size={16}/>} onClick={restart}>New draft</Button>
        </>}
        <Text size="xs" c="dimmed">{eligibleCount} eligible players · {totalPicks} total picks</Text>
      </Group>
    </Paper>

    {started && <>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Draft progress</Title>
          <Badge size="lg" color={done?'green':yourTurn?'orange':'blue'}>
            {done?'Draft complete':yourTurn?'Your turn':`Team ${nextTeam} to pick`}
          </Badge>
        </Group>
        <Progress value={100*picks.length/totalPicks} color="orange" size="lg" radius="xl"/>
        <Group justify="space-between" mt="xs">
          <Text size="sm">{picks.length} / {totalPicks} picks made</Text>
          {!done && <Text size="sm">Overall pick #{picks.length+1} · Round {Math.floor(picks.length/settings.teams)+1}</Text>}
        </Group>
        {!done && !yourTurn && <Button mt="sm" variant="light" onClick={()=>setSession(old=>({...old,picks:advanceToHuman(players,old.picks,old.settings)}))}>Simulate computer picks to my turn</Button>}
      </Paper>
      <SimpleGrid cols={{base:2,md:4}}>
        <Paper withBorder p="md"><Text c="dimmed" size="xs">Your team</Text><Title order={3}>Team {settings.slot}</Title></Paper>
        <Paper withBorder p="md"><Text c="dimmed" size="xs">Your drafted players</Text><Title order={3}>{yourRoster.length} / {settings.rounds}</Title></Paper>
        <Paper withBorder p="md"><Text c="dimmed" size="xs">Sum of historical FPPG</Text><Title order={3}>{format(draftedTeams[settings.slot-1]?.historyFppg??0)}</Title></Paper>
        <Paper withBorder p="md"><Text c="dimmed" size="xs">Undrafted eligible players</Text><Title order={3}>{available.length}</Title></Paper>
      </SimpleGrid>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm"><Title order={4}>Recommended picks for your team</Title>
          <Badge variant="outline">{DRAFT_FOCUS_OPTIONS.find(o=>o.value===settings.myFocus)?.label}</Badge></Group>
        {yourTurn ? <>
          <Text c="dimmed" size="sm" mb="sm">Ranked by your historical statistical priority. No position eligibility or future projections assumed.</Text>
          <SimpleGrid cols={{base:1,sm:2,lg:3}}>
            {recommended.slice(0,3).map((p,index)=><Paper withBorder p="sm" key={p.id}>
              <Group justify="space-between"><Badge variant="light" color="orange">#{index+1} choice</Badge><Text size="xs" c="dimmed">{p.gp} GP</Text></Group>
              <Text mt="sm" fw={700}><PlayerLink player={p}/></Text>
              <Text c="dimmed" size="xs">{p.team}</Text>
              <Group mt="sm" justify="space-between"><Text size="sm">{format(p.fppg)} historical FPPG</Text>
                <Button size="xs" onClick={()=>selectPlayer(p.id)}>Draft</Button></Group>
            </Paper>)}
          </SimpleGrid>
          <Button mt="sm" size="sm" variant="light" leftSection={<IconBolt size={16}/>} disabled={!recommended.length}
            onClick={()=>recommended[0]&&selectPlayer(recommended[0].id)}>Auto-pick top recommendation</Button>
        </> : <Text c="dimmed" size="sm">{done ? 'All rounds are finished. Review the draft board and team results below.' : 'Computer opponents are picking. You can advance their picks above.'}</Text>}
      </Paper>
    </>}

    <Paper withBorder p="md">
      <Group justify="space-between" mb="sm"><Title order={4}>Available player board</Title>
        <Badge variant="light" color="gray">{filtered.length} players</Badge></Group>
      <Group align="end" gap="sm" mb="sm">
        <TextInput label="Search player" value={search} onChange={e=>setSearch(e.currentTarget.value)}
          placeholder="Name" leftSection={<IconSearch size={16}/>} w={220}/>
        <Select label="NBA team" value={teamFilter} onChange={setTeamFilter} data={teamNames} searchable clearable
          placeholder="All teams" w={210}/>
        <Text c="dimmed" size="xs">Sorted by your selected statistical priority</Text>
      </Group>
      <ScrollArea>
        <Table striped highlightOnHover miw={850} verticalSpacing="xs">
          <Table.Thead><Table.Tr>
            <Table.Th>CSV rank</Table.Th><Table.Th>Player</Table.Th><Table.Th>2025–26 GP</Table.Th>
            <Table.Th>Historical FPPG</Table.Th><Table.Th>PPG</Table.Th><Table.Th>RPG</Table.Th><Table.Th>APG</Table.Th><Table.Th>SPG + BPG</Table.Th>
            <Table.Th>Selection</Table.Th>
          </Table.Tr></Table.Thead>
          <Table.Tbody>{filtered.slice(0,showAll?undefined:75).map(p=><Table.Tr key={p.id}>
            <Table.Td>{p.rank}</Table.Td><Table.Td><Summary player={p} tag={recommended[0]?.id===p.id&&yourTurn?'Top pick':undefined}/></Table.Td>
            <Table.Td>{p.gp}</Table.Td><Table.Td><Numeric value={p.fppg}/></Table.Td>
            <Table.Td><Numeric value={p.stats.PPG}/></Table.Td><Table.Td><Numeric value={p.stats.RPG}/></Table.Td><Table.Td><Numeric value={p.stats.APG}/></Table.Td>
            <Table.Td>{format((p.stats.SPG??0)+(p.stats.BPG??0))}</Table.Td>
            <Table.Td><Button size="xs" disabled={!yourTurn} onClick={()=>selectPlayer(p.id)}>Draft</Button></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {!showAll && filtered.length>75 && <Group justify="center" mt="sm"><Button size="xs" variant="subtle" onClick={()=>setShowAll(true)}>Show all {filtered.length} matching players</Button></Group>}
      {!started && <Text size="sm" c="dimmed" mt="sm">Start a mock draft to select players. Available players are taken entirely from your CSV.</Text>}
    </Paper>

    {started && <>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm"><Title order={4}>Draft board</Title><Text size="xs" c="dimmed">Round-by-round snake draft</Text></Group>
        <ScrollArea>
          <Table miw={Math.max(800,settings.teams*160)} striped withTableBorder withColumnBorders verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Round</Table.Th>{draftedTeams.map(t=><Table.Th key={t.team} style={{background:t.team===settings.slot?'var(--mantine-color-orange-light)':undefined}}>Team {t.team}{t.team===settings.slot?' (You)':''}</Table.Th>)}</Table.Tr></Table.Thead>
            <Table.Tbody>{Array.from({length:settings.rounds},(_,round)=><Table.Tr key={round}>
              <Table.Td fw={700}>{round+1}</Table.Td>{draftedTeams.map(t=>{
                const offset=round%2===0?t.team-1:settings.teams-t.team;
                const overall=round*settings.teams+offset+1;
                const pick=chosen.get(overall);
                const player=pick?byId.get(pick.playerId):undefined;
                return <Table.Td key={t.team} style={{background:t.team===settings.slot?'var(--mantine-color-orange-light)':undefined}}>
                  {player ? <div><Text size="xs" fw={600}>{player.name}</Text><Text size="xs" c="dimmed">#{overall} · {format(player.fppg)} FPPG</Text></div> : <Text size="xs" c="dimmed">#{overall} —</Text>}
                </Table.Td>;
              })}
            </Table.Tr>)}</Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm"><Group gap="xs"><IconTrophy size={19}/><Title order={4}>Team results</Title></Group>
          <Text size="xs" c="dimmed">Historical FPPG totals only — not predicted team scores</Text></Group>
        <ScrollArea><Table striped miw={700} verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Team</Table.Th><Table.Th>Bot strategy</Table.Th><Table.Th>Picks</Table.Th><Table.Th>Combined 2025–26 FPPG</Table.Th><Table.Th>Average GP</Table.Th><Table.Th>Drafted players</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{[...draftedTeams].sort((a,b)=>b.historyFppg-a.historyFppg).map(team=><Table.Tr key={team.team}>
            <Table.Td>{team.team===settings.slot?<Badge color="orange">Team {team.team} (You)</Badge>:`Team ${team.team}`}</Table.Td>
            <Table.Td>{team.team===settings.slot?DRAFT_FOCUS_OPTIONS.find(o=>o.value===settings.myFocus)?.label:DRAFT_FOCUS_OPTIONS.find(o=>o.value===teamStrategy(team.team,settings))?.label}</Table.Td>
            <Table.Td>{team.roster.length} / {settings.rounds}</Table.Td><Table.Td>{format(team.historyFppg)}</Table.Td><Table.Td>{format(team.avgGp)}</Table.Td>
            <Table.Td><Text size="xs" lineClamp={3}>{team.roster.map(p=>p.name).join(' · ') || '—'}</Text></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table></ScrollArea>
        <Text size="xs" c="dimmed" mt="sm">The table is ordered by historical FPPG sums, which are not directly comparable while teams have drafted different numbers of players. It does not project wins or account for positional lineups.</Text>
      </Paper>
    </>}
  </Stack>;
}
