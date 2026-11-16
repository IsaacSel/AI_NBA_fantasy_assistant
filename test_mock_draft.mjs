/** Engine tests use Node 22+ built-in type stripping; no third-party dependencies. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  DEFAULT_MOCK_SETTINGS, teamAtPick, availablePlayers, recommend, advanceToHuman,
  humanDraft, finishDraft, undoLastHumanPick, restoreMockSession, normalizedSettings,
} from '../web/src/lib/mockDraft.ts';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const players = JSON.parse(fs.readFileSync(path.join(root,'data/app/players.json'),'utf8'));
const base={...DEFAULT_MOCK_SETTINGS,teams:6,rounds:4,slot:3,minGames:10};

test('snake order goes forward in odd rounds and backward in even rounds',()=>{
  assert.deepEqual(Array.from({length:18},(_,i)=>teamAtPick(i,6)),
    [1,2,3,4,5,6,6,5,4,3,2,1,1,2,3,4,5,6]);
});
test('start advances bot picks to correct human slot, no duplicate players',()=>{
  const pre=advanceToHuman(players,[],base);
  assert.equal(pre.length,2);
  assert.deepEqual(pre.map(p=>p.team),[1,2]);
  const top=recommend(players,pre,base,1)[0];
  const after=humanDraft(players,pre,base,top.id);
  assert.equal(after.length,9); // picks 3..9 are bots; selection #10 is ours again
  assert.equal(teamAtPick(after.length,6),base.slot);
  assert.equal(after[2].playerId,top.id);
  assert.equal(after[2].automatic,false);
  assert.ok(after.slice(3).every(p=>p.automatic));
  assert.equal(new Set(after.map(p=>p.playerId)).size,after.length);
});
test('full automatic simulation completes draft, respects GP, and is deterministic',()=>{
  const first=finishDraft(players,[],base);
  const second=finishDraft(players,[],base);
  assert.deepEqual(first,second);
  assert.equal(first.length,base.teams*base.rounds);
  assert.equal(new Set(first.map(p=>p.playerId)).size,first.length);
  for (const p of first){
    assert.equal(p.team,teamAtPick(p.overall-1,base.teams));
    assert.ok(players.find(player=>player.id===p.playerId).gp>=base.minGames);
  }
  assert.equal(first.filter(p=>p.team===base.slot).length,base.rounds);
});
test('bot strategies make different selections without using non-CSV data',()=>{
  const gpMode=finishDraft(players,[],{...base,botMode:'best'});
  const specialists=finishDraft(players,[],{...base,botMode:'specialists'});
  assert.notDeepEqual(gpMode.map(p=>p.playerId),specialists.map(p=>p.playerId));
});
test('undo removes most recent human pick and bots that came after it',()=>{
  const pre=advanceToHuman(players,[],base);
  const withTurn=humanDraft(players,pre,base,recommend(players,pre,base,1)[0].id);
  assert.deepEqual(undoLastHumanPick(withTurn,base.slot),pre);
  assert.deepEqual(undoLastHumanPick(pre,base.slot),pre);
});
test('saved sessions are validated; old saved values cannot spoof picks',()=>{
  const picks=finishDraft(players,[],base);
  const saved=restoreMockSession({started:true,settings:base,picks},players);
  assert.equal(saved.picks.length,picks.length);
  const malformed=restoreMockSession({started:true,settings:base,picks:[
    {playerId:picks[0].playerId,team:999,overall:99},
    {playerId:picks[0].playerId},
  ]},players);
  assert.equal(malformed.picks.length,1);
  assert.equal(malformed.picks[0].team,1);
  assert.equal(malformed.picks[0].overall,1);
  assert.equal(normalizedSettings({teams:30,rounds:999,slot:99}).slot,20);
});
test('eligibility threshold restricts the candidate pool',()=>{
  const strict={...base, minGames:50};
  assert.ok(availablePlayers(players,[],strict.minGames).every(p=>p.gp>=50));
  assert.ok(recommend(players,[],strict,5).every(p=>p.gp>=50));
});
