import test from 'node:test';
import assert from 'node:assert/strict';
import {canRetryGroup,changeEventGroup,confirmEventPrint,eventGroupNumber,eventGroupTotal,eventPrintLabel,eventRound} from '../dist/event-mode.mjs';
import {mergeStationResults,openStationAssignment,stationAssignment,stationResult} from '../dist/event-stations.mjs';

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
