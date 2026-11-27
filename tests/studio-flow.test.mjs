import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedPlacement,inspectEventFiles,eventReportCsv} from '../dist/studio-flow.mjs';

test('background suggestions position people at the scene floor and keep all people in frame',() => {
  const people = [{id:'a',width:270,height:810},{id:'b',width:710,height:480},{id:'c',width:220,height:990}];
  const track = suggestedPlacement('track-finish',people);
  assert.deepEqual(track.map(item => item.id),['a','b','c']);
  assert.ok(track[0].x < track[1].x && track[1].x < track[2].x);
  for (const [i,{x,y,scale,rotation}] of track.entries()) {
    assert.equal(rotation,0);
    assert.ok(x - people[i].width * scale / 2 >= 0);
    assert.ok(x + people[i].width * scale / 2 <= 1200);
    assert.ok(Math.abs(y + people[i].height * scale / 2 - 801) < 1e-8);
  }
  assert.notEqual(suggestedPlacement('space',people)[0].y,track[0].y);
});

test('report matches generated names, detects duplicates, and counts only completed groups as missing',() => {
  const event = {title:'우리 반/체육대회',groups:['done','held','done','waiting'],reprint:[1]};
  const names = [
    '우리_반_체육대회_01모둠_완성.png','우리_반_체육대회_01모둠_완성 (2).PNG',
    '우리_반_체육대회_01모둠_인쇄_A4.pdf','우리_반_체육대회_02모둠_1컷_작게.png',
    '우리_반_체육대회_03모둠_01번컷.png','다른_행사_03모둠_완성.png','우리_반_체육대회_모아인쇄_A4.pdf'
  ];
  const report = inspectEventFiles(event,names);
  assert.deepEqual(report.rows.map(({files,duplicates,missing,reprint}) => [files,duplicates,missing,reprint]),
    [[3,1,false,true],[1,0,false,false],[0,0,true,false],[0,0,false,false]]);
  assert.equal(report.skipped,3);
  const csv = eventReportCsv(event,report);
  assert.equal(csv.charCodeAt(0),0xfeff);
  assert.match(csv,/"우리 반\/체육대회","1","완료","3개","1","필요"/);
  assert.match(csv,/"3","완료","누락"/);
});

test('CSV leaves unchecked files as unreviewed and escapes spreadsheet expressions and quotes',() => {
  const csv = eventReportCsv({title:'= "행사"',groups:['done','held']},null);
  assert.match(csv,/"'= ""행사""","1","완료","미점검"/);
  assert.match(csv,/"2","보류","미점검"/);
});
