'use client';
import { useMemo, useState } from 'react';
import { Group, Paper, ScrollArea, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useAppData } from '@/components/AppDataProvider';
import { DataSourceBadge, Numeric, PlayerLink } from '@/components/common';
import { METRICS, type Player } from '@/lib/types';
type ComparisonRow = { label: string; get: (player: Player) => number | null; lower?: boolean };
const rows: ComparisonRow[] = [{label:'Rank by FPPG', get:(p:Player)=>p.rank, lower:true},
  {label:'FPPG', get:(p:Player)=>p.fppg},
  {label:'Estimated season FP', get:(p:Player)=>p.season_fpts},
  {label:'GP', get:(p:Player)=>p.gp},
  {label:'FP per 36 min', get:(p:Player)=>p.fp_per36},
  ...METRICS.map(key => ({label:key,get:(p:Player)=>p.stats[key]}))];
export function ComparisonView() {
  const {players,byId}=useAppData();
  const [left,setLeft]=useState<string|null>(String(players[0]?.id??''));
  const [right,setRight]=useState<string|null>(String(players[1]?.id??''));
  const items=useMemo(()=>players.map(p=>({value:String(p.id),label:`${p.name} (${p.team})`})),[players]);
  const a=byId.get(Number(left)), b=byId.get(Number(right));
  return <Stack>
    <Group justify="space-between"><div><Title order={2}>Compare Players</Title>
      <Text size="sm" c="dimmed">Compare the exact season averages and calculated fantasy points.</Text></div><DataSourceBadge/></Group>
    <Paper withBorder p="md"><Group grow align="end"><Select label="Player A" searchable data={items} value={left} onChange={setLeft} nothingFoundMessage="No player"/>
      <Select label="Player B" searchable data={items} value={right} onChange={setRight} nothingFoundMessage="No player"/></Group></Paper>
    {a&&b&&<Paper withBorder><ScrollArea><Table striped highlightOnHover verticalSpacing="sm" miw={450}>
      <Table.Thead><Table.Tr><Table.Th>Metric</Table.Th><Table.Th><PlayerLink player={a}/></Table.Th><Table.Th><PlayerLink player={b}/></Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>{rows.map(({label,get,...rest})=>{
        const av=get(a),bv=get(b);
        const favorA=av!=null&&bv!=null&&av!==bv&&(rest.lower?av<bv:av>bv);
        const favorB=av!=null&&bv!=null&&av!==bv&&(rest.lower?bv<av:bv>av);
        return <Table.Tr key={label}><Table.Td>{label}</Table.Td>
          <Table.Td style={{fontWeight:favorA?700:400}}><Numeric value={av} digits={label==='GP'||label==='Rank by FPPG'?0:2}/></Table.Td>
          <Table.Td style={{fontWeight:favorB?700:400}}><Numeric value={bv} digits={label==='GP'||label==='Rank by FPPG'?0:2}/></Table.Td></Table.Tr>;
      })}</Table.Tbody></Table></ScrollArea></Paper>}
    <Text size="xs" c="dimmed">Bold numbers indicate the larger value (or lower ranking number), not necessarily a better fantasy category. For example, more turnovers or missed shots are worse under some scoring rules. Historical figures are not future projections.</Text>
  </Stack>;
}
