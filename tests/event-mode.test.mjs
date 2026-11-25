import test from 'node:test';
import assert from 'node:assert/strict';
import {changeEventGroup,eventGroupNumber,eventFilename,normalizeEvent} from '../dist/event-mode.mjs';

test('event group numbering advances through the final group without creating another', () => {
  const event = {title:'우리 반 체육대회',total:5,completed:0};
  assert.deepEqual(Array.from({length:6},(_,completed)=>eventGroupNumber({...event,completed})),[1,2,3,4,5,null]);
  assert.equal(eventFilename({...event,completed:5},'완성','png'),null);
});

test('event file names use the same group for PNG and PDF and sanitize reserved characters', () => {
  const event = {title:' 우리 반 / 행사:사진 ',total:5,completed:2};
  assert.equal(eventFilename(event,'1컷','png'),'우리_반_행사_사진_03모둠_1컷.png');
  assert.equal(eventFilename(event,'인쇄_4x6_1컷','pdf'),'우리_반_행사_사진_03모둠_인쇄_4x6_1컷.pdf');
  assert.equal(eventFilename({...event,title:'///'},'완성','png'),'상상네컷_행사_03모둠_완성.png');
  assert.equal(eventFilename(null,'완성','png'),null);
});

test('a 10-group event can continue after a hold and resume under the original group number', () => {
  let event = normalizeEvent({id:'sports',title:'체육대회',total:10,completed:0});
  const names = [];
  for (let current = 1; current <= 10; current += 1) {
    assert.equal(event.current,current);
    if (current === 3) {
      event = changeEventGroup(event,'hold');
      assert.equal(event.completed,2);
      assert.equal(event.groups[2],'held');
      continue;
    }
    names.push(eventFilename(event,'완성','png'));
    event = changeEventGroup(event,'complete');
    event = normalizeEvent(JSON.parse(JSON.stringify(event)));
  }
  assert.equal(event.current,null);
  assert.equal(event.completed,9);
  assert.equal(event.groups[2],'held');
  event = changeEventGroup(event,'select',3);
  assert.equal(eventFilename(event,'02번컷','png'),'체육대회_03모둠_02번컷.png');
  assert.equal(eventFilename(event,'인쇄_A4','pdf'),'체육대회_03모둠_인쇄_A4.pdf');
  names.push(eventFilename(event,'완성','png'));
  event = changeEventGroup(event,'complete');
  assert.equal(new Set(names).size,10);
  assert.equal(event.revision,12);
  assert.equal(event.completed,10);
  assert.ok(event.groups.every(state => state === 'done'));
});

test('legacy progress migrates, manual selection returns the replaced slot to waiting, and completed slots stay closed', () => {
  const legacy = {id:'legacy',title:'운동회',total:4,completed:1};
  const event = changeEventGroup(legacy,'select',4);
  assert.deepEqual(event.groups,['done','waiting','waiting','active']);
  assert.equal(event.completed,1);
  assert.equal(event.revision,1);
  assert.equal(changeEventGroup(event,'complete').current,2);
  assert.throws(() => changeEventGroup(event,'select',1),/대기 또는 보류/);
  assert.throws(() => changeEventGroup(event,'select',5),/대기 또는 보류/);
});
