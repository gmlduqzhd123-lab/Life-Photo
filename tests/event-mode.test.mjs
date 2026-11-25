import test from 'node:test';
import assert from 'node:assert/strict';
import {eventGroupNumber,eventFilename} from '../dist/event-mode.mjs';

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
