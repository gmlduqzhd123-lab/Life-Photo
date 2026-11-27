import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestedPlacement,inspectEventFiles,eventReportCsv,cameraCrop,cameraGuideBox} from '../dist/studio-flow.mjs';

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

test('same-name event output uses the round code and admits legacy names only by request',() => {
  const event = {title:'운동회',round:{date:'2026-11-27',code:'ABCDEF12'},groups:['done','done'],outputs:{1:{captured:1,target:4}}};
  const names = [
    '운동회_2026-11-27_ABCDEF12_01모둠_1컷.png',
    '운동회_2026-11-27_ABCDEF12_01모둠_1컷 (1).png',
    '운동회_2026-11-27_ABCDEF12_01모둠_인쇄_A4_1컷.pdf',
    '운동회_2026-11-27_99999999_02모둠_완성.png',
    '운동회_02모둠_완성.png'
  ];
  const report = inspectEventFiles(event,names);
  assert.equal(report.pendingLegacy,1);
  assert.equal(report.skipped,1);
  assert.equal(report.rows[1].missing,true);
  assert.deepEqual(report.rows[0].png,[0,1]);
  const accepted = inspectEventFiles(event,names,{acceptLegacy:true});
  assert.deepEqual(accepted.rows[1].png,[4]);
  assert.equal(accepted.skipped,1);
  assert.match(eventReportCsv(event,accepted),/"일부 저장 1\/4","2026-11-27","ABCDEF12"/);
});

test('camera guide and capture use the same centered 4:3 crop for wide and portrait streams',() => {
  assert.deepEqual(cameraCrop(960,540),{x:120,y:0,w:720,h:540});
  assert.deepEqual(cameraCrop(600,1000),{x:0,y:275,w:600,h:450});
  assert.deepEqual(cameraGuideBox(960,540,320,240),{left:12.5,top:12.5,width:75,height:75});
  assert.deepEqual(cameraGuideBox(640,480,320,240),{left:0,top:0,width:100,height:100});
  assert.deepEqual(cameraGuideBox(600,1000,320,240),{left:27.5,top:27.5,width:45,height:45});
  assert.equal(cameraGuideBox(0,0,320,240),null);
});
