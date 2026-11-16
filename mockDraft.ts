/** CSV-only fantasy mock draft: historical scoring and deterministic strategy bots.
 * No game logs, positions, ADP, injury reports, play-by-play, or projections.
 */
import type { Player } from './types';

export type DraftFocus = 'best' | 'durable' | 'scoring' | 'rebounding' | 'playmaking' | 'defense';
export type BotMode = 'mixed' | 'best' | 'specialists';
export interface MockSettings {
  teams: number;
  rounds: number;
  slot: number;
  minGames: number;
  botMode: BotMode;
  myFocus: DraftFocus;
  /** Randomized at the beginning of each draft, persisted for reproducible undo. */
  seed: number;
}
export interface MockPick {
  playerId: number;
  team: number;
  round: number;
  overall: number;
  automatic: boolean;
  focus: DraftFocus;
}
export interface MockSession {
  started: boolean;
  settings: MockSettings;
  picks: MockPick[];
}
export const DEFAULT_MOCK_SETTINGS: MockSettings = {
  teams: 10, rounds: 13, slot: 1, minGames: 10, botMode: 'mixed', myFocus: 'best', seed: 1,
};
export const DRAFT_FOCUS_OPTIONS: { value: DraftFocus; label: string }[] = [
  {value:'best', label:'Highest FPPG'},
  {value:'durable', label:'Games played'},
  {value:'scoring', label:'Scoring'},
  {value:'rebounding', label:'Rebounding'},
  {value:'playmaking', label:'Playmaking'},
  {value:'defense', label:'Steals + blocks'},
];
const SPECIALISTS: DraftFocus[] = ['scoring','rebounding','playmaking','defense','durable'];
const MIXED: DraftFocus[] = ['best','durable','scoring','best','rebounding','playmaking','best','defense'];
export function normalizedSettings(input: Partial<MockSettings> = {}): MockSettings {
  const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min,Math.min(max,Math.floor(value))) : fallback;
  const botMode: BotMode = input.botMode === 'best' || input.botMode === 'specialists' ? input.botMode : 'mixed';
  const allowed = DRAFT_FOCUS_OPTIONS.map(o=>o.value);
  const myFocus: DraftFocus = input.myFocus && allowed.includes(input.myFocus) ? input.myFocus : 'best';
  const teams = clamp(input.teams,2,20,10);
  return {
    teams, rounds:clamp(input.rounds,1,20,13), slot:clamp(input.slot,1,teams,1),
    minGames:clamp(input.minGames,0,60,10), botMode, myFocus, seed:clamp(input.seed,1,1000000,1),
  };
}
/** 0-indexed overall selection -> team number (1-indexed). */
export function teamAtPick(index: number, teams: number): number {
  const round = Math.floor(index / teams);
  const within = index % teams;
  return round % 2 === 0 ? within + 1 : teams - within;
}
export function teamStrategy(team: number, settings: MockSettings): DraftFocus {
  if (settings.botMode === 'best') return 'best';
  const rotation = settings.botMode === 'specialists' ? SPECIALISTS : MIXED;
  return rotation[(team - 1) % rotation.length];
}
const stat = (p: Player, name: string): number => p.stats[name as keyof Player['stats']] ?? 0;
/** Historic FPPG remains the base; specialty bonuses are clearly draft heuristics, not forecasts. */
export function priorityScore(p: Player, focus: DraftFocus): number {
  const base = p.fppg;
  switch (focus) {
    case 'durable': return base + 0.16 * p.gp;
    case 'scoring': return base + 0.45 * stat(p,'PPG');
    case 'rebounding': return base + 1.10 * stat(p,'RPG');
    case 'playmaking': return base + 1.50 * stat(p,'APG');
    case 'defense': return base + 2.80 * (stat(p,'SPG') + stat(p,'BPG'));
    default: return base;
  }
}
export function availablePlayers(players: Player[], picks: MockPick[], minGames: number): Player[] {
  const selected = new Set(picks.map(p => p.playerId));
  return players.filter(p=>p.gp>=minGames && !selected.has(p.id));
}
export function recommend(players: Player[], picks: MockPick[], settings: MockSettings, limit=5): Player[] {
  return availablePlayers(players,picks,settings.minGames).sort((a,b)=>
    priorityScore(b,settings.myFocus)-priorityScore(a,settings.myFocus) || b.fppg-a.fppg || a.id-b.id).slice(0,limit);
}
function deterministicRandom(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}
function bestBotPlayer(players: Player[], picks: MockPick[], settings: MockSettings, team: number): Player | null {
  const focus = teamStrategy(team,settings);
  // One pick among the highest scoring eight choices, with stronger weighting at the top.
  // A reproducible seed makes undo, refresh and replay consistent.
  const candidates = availablePlayers(players,picks,settings.minGames)
    .sort((a,b)=>priorityScore(b,focus)-priorityScore(a,focus) || b.fppg-a.fppg || a.id-b.id)
    .slice(0,8);
  if (candidates.length===0) return null;
  const best = priorityScore(candidates[0],focus);
  const weights = candidates.map(p=>Math.exp(Math.max(-35,(priorityScore(p,focus)-best)/3.5)));
  let needle = deterministicRandom(settings.seed ^ ((picks.length + 1)*7919) ^ (team*104729)) * weights.reduce((a,b)=>a+b,0);
  for (let i=0;i<candidates.length;i++) {
    needle -= weights[i];
    if (needle <= 0) return candidates[i];
  }
  return candidates[candidates.length-1];
}
export function appendPick(picks: MockPick[], playerId: number, settings: MockSettings,
  automatic: boolean, focus: DraftFocus): MockPick[] {
  if (picks.length>=settings.teams*settings.rounds || picks.some(p=>p.playerId===playerId)) return picks;
  const index = picks.length;
  return [...picks, { playerId, team:teamAtPick(index,settings.teams),
    round:Math.floor(index/settings.teams)+1, overall:index+1, automatic, focus }];
}
/** Run computer turns until it is the human's turn (or all picks are completed). */
export function advanceToHuman(players: Player[], picks: MockPick[], settings: MockSettings, maxBots=Infinity): MockPick[] {
  let result=picks;
  let bots=0;
  while(result.length<settings.teams*settings.rounds && bots<maxBots) {
    const team=teamAtPick(result.length,settings.teams);
    if (team===settings.slot) break;
    const choice=bestBotPlayer(players,result,settings,team);
    if (!choice) break;
    result=appendPick(result,choice.id,settings,true,teamStrategy(team,settings));
    bots++;
  }
  return result;
}
export function humanDraft(players: Player[], picks: MockPick[], settings: MockSettings, playerId: number): MockPick[] {
  if (teamAtPick(picks.length,settings.teams)!==settings.slot || picks.length>=settings.rounds*settings.teams) return picks;
  const chosen=availablePlayers(players,picks,settings.minGames).some(p=>p.id===playerId);
  if (!chosen) return picks;
  const afterHuman=appendPick(picks,playerId,settings,false,settings.myFocus);
  return advanceToHuman(players,afterHuman,settings);
}
export function finishDraft(players: Player[], picks: MockPick[], settings: MockSettings): MockPick[] {
  let result=picks;
  while(result.length<settings.teams*settings.rounds) {
    const team=teamAtPick(result.length,settings.teams);
    const player=team===settings.slot
      ? recommend(players,result,settings,1)[0]
      : bestBotPlayer(players,result,settings,team);
    if (!player) break;
    result=appendPick(result,player.id,settings,true,team===settings.slot?settings.myFocus:teamStrategy(team,settings));
  }
  return result;
}
export function undoLastHumanPick(picks: MockPick[], slot: number): MockPick[] {
  for(let i=picks.length-1;i>=0;i--) if (picks[i].team===slot) return picks.slice(0,i);
  return picks;
}
/** Restore only well-formed and sequential picks; old or different CSV entries are ignored. */
export function restoreMockSession(raw: unknown, players: Player[]): MockSession | null {
  if (!raw || typeof raw!=='object') return null;
  const data=raw as Record<string,unknown>;
  if (typeof data.started!=='boolean' || !data.settings || typeof data.settings!=='object') return null;
  const settings=normalizedSettings(data.settings as Partial<MockSettings>);
  const byId=new Map(players.map(p=>[p.id,p]));
  const result: MockPick[]=[];
  if (!Array.isArray(data.picks)) return null;
  for (const entry of data.picks) {
    if (!entry || typeof entry !== 'object') break;
    const pick=entry as Partial<MockPick>;
    const player=typeof pick.playerId==='number' ? byId.get(pick.playerId) : undefined;
    if (!player || player.gp<settings.minGames || result.some(p=>p.playerId===player.id)
       || result.length>=settings.teams*settings.rounds) break;
    const team=teamAtPick(result.length,settings.teams);
    // We recompute positions, never trust imported stored round/team/overall values.
    result.push({playerId:player.id, team, round:Math.floor(result.length/settings.teams)+1,
      overall:result.length+1, automatic:pick.automatic===true,
      focus:team===settings.slot?settings.myFocus:teamStrategy(team,settings)});
  }
  return {started:data.started,settings,picks:data.started?result:[]};
}
