import test from 'node:test';
import assert from 'node:assert/strict';
import {addPrintBatch,canRetryGroup,changeEventGroup,confirmEventPrint,eventGroupNumber,eventGroupTotal,eventPrintLabel,eventRound} from '../dist/event-mode.mjs';
import {mergeStationResults,openStationAssignment,stationAssignment,stationResult,stationPlan,updateStationResults} from '../dist/event-stations.mjs';
import {eventBackup,openEventBackup} from '../dist/event-backup.mjs';

const id = 'abcdef12-2222-4444-8888-111111111111';
const event = {id,title:'학교 축제',total:4,round:eventRound(id,new Date('2026-11-27T00:00Z'))};
const assign = (name,first,last,source = event) => openStationAssignment(stationAssignment(source,{name,first,last},{})).event;

test('retry preserves the previous group and counts through cancel and full replacement',() => {
  const saved = {...event,groups:['done','active','waiting','waiting'],current:2,completed:1,revision:2,
    outputs:{1:{captured:1,target:4}},printed:[1]};
  assert.equal(canRetryGroup(saved,1),true);
  const retry = changeEventGroup(saved,'retry',1);
  assert.equal(eventGroupNumber(retry),1);
  assert.equal(retry.completed,1);
  assert.equal(retry.outputs[1].captured,1);
  assert.throws(() => changeEventGroup(retry,'complete',undefined,{captured:2,target:4}),/모든 컷/);
  const cancel = changeEventGroup(retry,'cancel-retry');
  assert.deepEqual(cancel.outputs,saved.outputs);
  assert.equal(eventGroupNumber(cancel),2);
  const done = changeEventGroup(retry,'complete',undefined,{captured:4,target:4});
  assert.equal(eventGroupNumber(done),2);
  assert.equal(done.outputs[1].captured,4);
  assert.equal(done.completed,1);
  assert.equal(eventPrintLabel(done,1),'출력 대기');
  assert.equal(canRetryGroup(done,1),false);
});

test('physical print confirmation updates only chosen completed groups and clears their reprint flags',() => {
  const saved = {...event,groups:['done','done','active','waiting'],revision:0,reprint:[1]};
  assert.throws(() => confirmEventPrint(saved,[1,3]),/저장을 마친/);
  const first = confirmEventPrint(saved,[1]);
  assert.equal(eventPrintLabel(first,1),'인쇄 확인');
  assert.equal(eventPrintLabel(first,2),'출력 대기');
  assert.deepEqual(first.reprint,[]);
  assert.equal(eventPrintLabel(saved,1),'재출력 필요');
});

test('assigned stations keep original group numbers and merging identifies gaps and overlaps',() => {
  let a = assign('운동장 A',1,2);
  let b = assign('운동장 B',3,4);
  assert.deepEqual(b.groups,['unassigned','unassigned','active','waiting']);
  assert.equal(eventGroupTotal(b),2);
  a = changeEventGroup(a,'complete',undefined,{captured:1,target:4});
  b = changeEventGroup(b,'complete',undefined,{captured:4,target:4});
  b = confirmEventPrint(b,[3]);
  const merged = mergeStationResults([stationResult(a),stationResult(b)]);
  assert.equal(merged.event.completed,2);
  assert.deepEqual(merged.pending,[2,4]);
  assert.deepEqual(merged.conflict,[]);
  assert.equal(eventPrintLabel(merged.event,3),'인쇄 확인');
  const collision = mergeStationResults([stationResult(a),stationResult(assign('C',2,4))]);
  assert.deepEqual(collision.conflict,[{number:2,stations:['운동장 A','C']}]);
  assert.equal(collision.event.groups[1],'conflict');
  const otherId = 'abc12345-2222-4444-8888-111111111111';
  const other = assign('다른 회차',3,4,{...event,id:otherId,round:eventRound(otherId)});
  assert.throws(() => mergeStationResults([stationResult(a),stationResult(other)]),/같은 회차/);
});

const aPlan = {id:'a1b2c3d4-2222-4444-8888-111111111111',generation:1,name:'A',first:1,last:2};
const bPlan = {id:'a2b3c4d5-2222-4444-8888-111111111111',generation:1,name:'B',first:3,last:4};
test('the assignment board rejects ambiguous names and overlaps and identifies unassigned groups',() => {
  assert.deepEqual(stationPlan([aPlan],4).missing,[3,4]);
  assert.deepEqual(stationPlan([bPlan,aPlan],4),{plan:[aPlan,bPlan],missing:[]});
  assert.throws(() => stationPlan([aPlan,{...bPlan,name:' a '}],4),/서로 다르게/);
  assert.throws(() => stationPlan([aPlan,{...bPlan,first:2}],4),/2모둠/);
});

test('round totals use the latest station revision even when an older file arrives later',() => {
  const initial = openStationAssignment(stationAssignment(event,aPlan,{})).event;
  const old = stationResult(initial);
  const recent = stationResult(changeEventGroup(initial,'complete',undefined,{captured:4,target:4}));
  const {files,ignored} = updateStationResults([recent],[old,recent]);
  assert.equal(ignored,2);
  assert.equal(mergeStationResults(files).event.completed,1);
  assert.equal(updateStationResults([old],[recent]).updated,1);
  const reissued = stationResult(openStationAssignment(stationAssignment(event,{...aPlan,generation:2},{})).event);
  assert.equal(mergeStationResults([recent,reissued]).event.completed,0);
  assert.equal(mergeStationResults([{...old,version:1}]).event.completed,0);
  assert.equal(openStationAssignment({...stationAssignment(event,aPlan,{}),version:1}).event.current,1);
});

test('PDF batch history tracks copies without claiming physical confirmation and expires after a retake',() => {
  const initial = openStationAssignment(stationAssignment(event,aPlan,{})).event;
  const partial = changeEventGroup(initial,'complete',undefined,{captured:1,target:4});
  const batched = addPrintBatch(partial,[{number:1,copies:2},{number:1,copies:1}],2,'2026-11-27T01:00:00Z');
  assert.deepEqual(batched.printBatches[0].groups,[{number:1,copies:3}]);
  assert.equal(eventPrintLabel(batched,1),'PDF 준비');
  assert.equal(eventPrintLabel(mergeStationResults([stationResult(batched)]).event,1),'PDF 준비');
  assert.equal(eventPrintLabel(confirmEventPrint(batched,[1]),1),'인쇄 확인');
  const retried = changeEventGroup(changeEventGroup(batched,'retry',1),'complete',undefined,{captured:4,target:4});
  assert.equal(eventPrintLabel(retried,1),'출력 대기');
  assert.equal(retried.printBatches.length,1);
});

test('operating backups round-trip only valid metadata and reject mixed rounds or invalid progress',() => {
  const a = openStationAssignment(stationAssignment(event,aPlan,{})).event;
  const state = {...event,groups:['done','active','waiting','waiting'],completed:1,current:2,revision:3,
    photos:['private'],outputs:{1:{captured:3,target:4,bytes:'private'}},stationPlan:[aPlan,bPlan]};
  const batched = addPrintBatch(state,[{number:1,copies:1}],1,'2026-11-27T01:00:00Z');
  const data = eventBackup(batched,{layout:'grid'},[stationResult(a)]);
  const opened = openEventBackup(JSON.parse(JSON.stringify(data)));
  assert.equal(opened.event.current,2);
  assert.deepEqual(opened.event.stationPlan,[aPlan,bPlan]);
  assert.equal(eventPrintLabel(opened.event,1),'PDF 준비');
  assert.equal(opened.results.length,1);
  assert.doesNotMatch(JSON.stringify(opened),/private/);
  assert.throws(() => openEventBackup({...data,event:{...data.event,current:4}}),/진행 기록/);
  const differentId = 'fdceba12-2222-4444-8888-111111111111';
  assert.throws(() => eventBackup(batched,{},[stationResult({...a,id:differentId,round:eventRound(differentId)})]),/회차/);
});
