'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon, Badge, Button, Group, NumberInput, Paper, ScrollArea, Select,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core';
import { IconArrowBackUp, IconSearch, IconTrash } from '@tabler/icons-react';
import { useAppData } from '@/components/AppDataProvider';
import { DataSourceBadge, Numeric, PlayerLink } from '@/components/common';
import type { DraftPick } from '@/lib/types';
const STORAGE_KEY='fantasy-hoops-csv-draft-v1';
export function DraftTracker() {
  const {players,byId}=useAppData();
  const [picks,setPicks]=useState<DraftPick[]>([]);
  const [hydrated,setHydrated]=useState(false);
  const [search,setSearch]=useState('');
  const [team,setTeam]=useState<string|null>(null);
  const [showAll,setShowAll]=useState(false);
  const [teams,setTeams]=useState<number|string>(10);
  const [slot,setSlot]=useState<number|string>(1);
  useEffect(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]') as unknown;
      if(Array.isArray(saved)) setPicks(saved.filter((p):p is DraftPick =>
        typeof p==='object' && p!==null && typeof p.playerId==='number' &&
        byId.has(p.playerId) && typeof p.mine==='boolean'));
    } catch { /* Unsupported or invalid saved drafts start empty. */ }
    setHydrated(true);
  },[byId]);
  useEffect(()=>{ if(hydrated) localStorage.setItem(STORAGE_KEY,JSON.stringify(picks)); },[hydrated,picks]);
  const taken=new Set(picks.map(p=>p.playerId));
  const available=useMemo(()=>players.filter(p=>!taken.has(p.id) &&
    (!search.trim() || p.name.toLowerCase().includes(search.toLowerCase())) &&
    (!team || p.teams.includes(team))),[players,taken,search,team]);
  const teamNames=useMemo(()=>[...new Set(players.flatMap(p=>p.teams))].sort(),[players]);
  const totalTeams=Math.max(2,Math.floor(Number(teams)||10));
  const draftSlot=Math.max(1,Math.min(totalTeams,Math.floor(Number(slot)||1)));
  function pickTeam(index: number): number {
    const round=Math.floor(index/totalTeams);
    const offset=index%totalTeams;
    return round%2===0 ? offset+1 : totalTeams-offset;
  }
  const yourPicks=picks.filter(p=>p.mine).map(p=>byId.get(p.playerId)).filter(p=>p!==undefined);
  const nextTeam=pickTeam(picks.length);
  const makePick=(playerId:number,mine=false)=>setPicks(current => current.some(p=>p.playerId===playerId)?current:[...current,{playerId,mine}]);
  return <Stack gap="md">
    <Group justify="space-between" align="start"><div><Title order={2}>Manual Draft Tracker</Title>
      <Text size="sm" c="dimmed">Track live picks using 2025–26 FPPG as a reference, not a future forecast or ADP.</Text></div>
      <DataSourceBadge/></Group>
    <Paper p="md" withBorder>
      <Group align="end" gap="md">
        <NumberInput label="Fantasy teams" value={teams} min={2} max={30} w={135} onChange={setTeams}/>
        <NumberInput label="Your draft slot" value={slot} min={1} max={totalTeams} w={135} onChange={setSlot}/>
        <Badge color={nextTeam===draftSlot?'orange':'gray'} size="lg">Next: pick #{picks.length+1} · Team {nextTeam}</Badge>
        <Text size="xs" c="dimmed">Assumes snake order. You mark your own picks manually.</Text>
      </Group>
    </Paper>
    <Group align="stretch" grow>
      <Paper withBorder p="md"><Text size="xs" c="dimmed">Players remaining</Text><Title order={3}>{players.length-taken.size}</Title></Paper>
      <Paper withBorder p="md"><Text size="xs" c="dimmed">Your picks</Text><Title order={3}>{yourPicks.length}</Title></Paper>
      <Paper withBorder p="md"><Text size="xs" c="dimmed">Your combined historical FPPG</Text><Title order={3}><Numeric value={yourPicks.reduce((a,p)=>a+p.fppg,0)}/></Title></Paper>
    </Group>
    <Paper withBorder p="md"><Group gap="sm" align="end">
      <TextInput label="Search remaining" placeholder="Player name" value={search} onChange={e=>setSearch(e.currentTarget.value)}
        leftSection={<IconSearch size={16}/>} w={230}/>
      <Select label="Team" searchable clearable placeholder="All teams" data={teamNames} value={team} onChange={setTeam} w={220}/>
      <Badge variant="outline" color="gray" ml="auto">{available.length} available</Badge>
    </Group></Paper>
    <Paper withBorder><ScrollArea><Table striped highlightOnHover miw={620} verticalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>Rank</Table.Th><Table.Th>Available player</Table.Th><Table.Th>Team</Table.Th>
        <Table.Th>GP</Table.Th><Table.Th>2025–26 FPPG</Table.Th><Table.Th>Record pick</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{available.slice(0,showAll?undefined:100).map(p=><Table.Tr key={p.id}>
        <Table.Td>{p.rank}</Table.Td><Table.Td><PlayerLink player={p}/></Table.Td><Table.Td>{p.team}</Table.Td>
        <Table.Td>{p.gp}</Table.Td><Table.Td><Numeric value={p.fppg}/></Table.Td>
        <Table.Td><Group gap="xs" wrap="nowrap"><Button size="xs" variant="light" onClick={()=>makePick(p.id,false)}>Other</Button>
          <Button size="xs" onClick={()=>makePick(p.id,true)}>Mine</Button></Group></Table.Td>
      </Table.Tr>)}</Table.Tbody></Table></ScrollArea>
      {!showAll && available.length>100 && <div style={{padding:12,textAlign:'center'}}>
        <Button variant="subtle" size="xs" onClick={()=>setShowAll(true)}>Show all {available.length} available players</Button>
      </div>}
    </Paper>
    <Paper withBorder p="md"><Group justify="space-between" mb="sm"><Title order={4}>Recorded picks ({picks.length})</Title>
      <Group gap="xs"><Button size="xs" variant="outline" leftSection={<IconArrowBackUp size={14}/>} disabled={!picks.length} onClick={()=>setPicks(p=>p.slice(0,-1))}>Undo last</Button>
        <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14}/>} disabled={!picks.length} onClick={()=>{
          if(window.confirm('Clear all recorded draft picks?')) setPicks([]);
        }}>Reset</Button></Group></Group>
      {!picks.length?<Text c="dimmed" size="sm">No picks recorded. Select “Mine” or “Other” above to begin.</Text>:
        <ScrollArea mah={300}><Table verticalSpacing="xs"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Player</Table.Th><Table.Th>Draft team</Table.Th><Table.Th>Yours?</Table.Th><Table.Th></Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{picks.map((pick,i)=>{const player=byId.get(pick.playerId);
            return <Table.Tr key={pick.playerId}><Table.Td>{i+1}</Table.Td><Table.Td>{player?.name??'Unknown player'}</Table.Td>
              <Table.Td>{pickTeam(i)}</Table.Td><Table.Td><Badge color={pick.mine?'orange':'gray'}>{pick.mine?'Mine':'Other'}</Badge></Table.Td>
              <Table.Td><ActionIcon variant="subtle" color="red" title="Remove pick" onClick={()=>setPicks(old=>old.filter(p=>p.playerId!==pick.playerId))}><IconTrash size={15}/></ActionIcon></Table.Td>
            </Table.Tr>;})}</Table.Tbody></Table></ScrollArea>}
    </Paper>
    <Text size="xs" c="dimmed">Draft picks are saved in this browser only. Because the CSV contains no positions, team needs, ADP, injuries, or forward projections, this tool does not simulate drafts or recommend future outcomes.</Text>
  </Stack>;
}
