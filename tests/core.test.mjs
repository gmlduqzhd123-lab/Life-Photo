import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,addItem,arrangePeople,personItems,History,exportSpec,getPrintLayout,presetOf,hitItem,moveItem,isComplete,nextEmptyCut,emptyCutIndices,photographedProject,swapVisibleCuts,originalPerson} from '../dist/core.mjs';
import {createPrintPdf} from '../dist/print-pdf.mjs';
test('deleting a middle cut preserves every other cut identity and content',()=>{const p=newProject(),ids=p.cuts.map(c=>c.id);p.cuts.forEach((c,i)=>addItem(c,'photo'+i,400,600));p.cuts[1].items=[];assert.deepEqual(p.cuts.map(c=>c.id),ids);assert.equal(p.cuts[2].items[0].assetId,'photo2');assert.equal(isComplete(p),false);});
test('person limit applies to people rather than decorative items',()=>{const c=newProject().cuts[0];for(let i=0;i<8;i++)addItem(c,'heart',180,180,'decoration');for(let i=0;i<3;i++)addItem(c,'person',500,600);assert.equal(personItems(c).length,3);assert.throws(()=>addItem(c,'extra',500,600),/3개/);});
test('history restores replacement, position and deletion without sharing references',()=>{let p=newProject();const h=new History();h.record(p);addItem(p.cuts[0],'first',400,600);h.record(p);p.cuts[0].items[0].assetId='replacement';p=h.undo(p);assert.equal(p.cuts[0].items[0].assetId,'first');p=h.redo(p);assert.equal(p.cuts[0].items[0].assetId,'replacement');h.clear();assert.equal(h.past.length+h.future.length,0);});
test('only the latest twenty snapshots are retained',()=>{const p=newProject(),h=new History();for(let i=0;i<25;i++){h.record(p);p.caption=String(i);}assert.equal(h.past.length,20);});
test('export layouts preserve 4 by 3 photo cells within fixed output dimensions',()=>{for(const layout of ['strip','grid']){const s=exportSpec(layout);assert.equal(s.cells.length,4);for(const c of s.cells){assert.equal(c.w/c.h,4/3);assert.ok(c.x>=0&&c.y>=0&&c.x+c.w<=s.w&&c.y+c.h<=s.h);}assert.ok(s.footerY>s.cells[3].y+s.cells[3].h);}assert.deepEqual([exportSpec('strip').w,exportSpec('strip').h],[1440,4400]);assert.deepEqual([exportSpec('grid').w,exportSpec('grid').h],[2800,2480]);});
test('persistable preset contains no photos, masks, sticker IDs or edit history',()=>{const p=newProject();addItem(p.cuts[0],'sensitive-photo',600,800);const json=JSON.stringify(presetOf(p,{timer:5,sound:false,mission:true,customMissions:['포즈']}));assert.ok(!json.includes('sensitive-photo'));for(const key of ['cuts','items','assetId','mask','history'])assert.ok(!json.includes('"'+key+'"'));});
test('rotated and scaled stickers can be selected; movements remain recoverable',()=>{const c=newProject().cuts[0],it=addItem(c,'a',300,400),assets=new Map([['a',{w:300,h:400}]]);it.rotation=60;assert.equal(hitItem(c,it.x,it.y,assets),it);assert.equal(hitItem(c,0,0,assets),null);moveItem(it,9000,-100);assert.deepEqual([it.x,it.y],[1200,0]);});
test('two and three cuts export all selected slots and ignore hidden slots',()=>{for(const count of [2,3]){const p=newProject({count});for(let i=0;i<count;i++)addItem(p.cuts[i],'person'+i,300,400);assert.equal(isComplete(p),true);for(const layout of ['strip','grid']){const s=exportSpec(layout,count);assert.equal(s.cells.length,count);for(const cell of s.cells)assert.ok(cell.x+cell.w<=s.w&&cell.y+cell.h<=s.h);assert.ok(s.footerY+225<s.h);}}assert.equal(exportSpec('grid',3).cells[2].x,800);});

test('paper layout fits every copy inside the selected sheet margins', () => {
  for (const size of ['A4', 'A6', 'letter', 'photo-4x6']) {
    for (const copies of [1, 2, 4]) {
      const paper = getPrintLayout(size, copies);
      assert.equal(paper.cells.length, copies);
      for (const cell of paper.cells) {
        assert.ok(cell.x >= paper.margin && cell.y >= paper.margin);
        assert.ok(cell.x + cell.w <= paper.width - paper.margin + 1e-6);
        assert.ok(cell.y + cell.h <= paper.height - paper.margin + 1e-6);
      }
    }
  }
  const {cells, gap} = getPrintLayout('A6', 4);
  assert.equal(cells[1].x - cells[0].x - cells[0].w, gap);
  assert.equal(cells[2].y - cells[0].y - cells[0].h, gap);
});

test('arranging two or three people fits rotated photos without moving decorations', () => {
  for (const count of [2, 3]) {
    const cut = newProject().cuts[0];
    const assets = new Map();
    for (let i = 0; i < count; i++) {
      const dims = {w: 410 + i * 220, h: 910 - i * 160};
      const person = addItem(cut, 'person' + i, dims.w, dims.h);
      person.rotation = i * 25 - 10;
      assets.set(person.assetId, dims);
    }
    const decoration = addItem(cut, 'star', 180, 180, 'decoration');
    const originalDecoration = {...decoration};
    assert.ok(arrangePeople(cut, assets));
    assert.deepEqual(decoration, originalDecoration);
    let previousRight = 0;
    for (const person of personItems(cut)) {
      const {w, h} = assets.get(person.assetId);
      const angle = person.rotation * Math.PI / 180;
      const halfWidth = (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) * person.scale / 2;
      const halfHeight = (Math.abs(Math.sin(angle)) * w + Math.abs(Math.cos(angle)) * h) * person.scale / 2;
      assert.ok(person.x - halfWidth > previousRight);
      assert.ok(person.x + halfWidth <= 1200);
      assert.ok(person.y - halfHeight >= 0 && person.y + halfHeight <= 900);
      previousRight = person.x + halfWidth;
    }
  }
});

test('next empty cut respects the current selection, wraps around and ignores hidden cuts', () => {
  const project = newProject({count:3});
  const [first, second, third] = project.cuts;
  addItem(second, 'second', 300, 400);
  assert.equal(nextEmptyCut(project, 1), 2);
  assert.equal(nextEmptyCut(project, 2), 2);
  addItem(third, 'third', 300, 400);
  assert.equal(nextEmptyCut(project, 2), 0);
  addItem(first, 'first', 300, 400);
  assert.equal(nextEmptyCut(project, 2), -1);
});

test('partial output keeps photographed visible cuts in order and supports one cut', () => {
  const project = newProject({count:3});
  addItem(project.cuts[0], 'decor', 100, 100, 'decoration');
  addItem(project.cuts[1], 'visible', 300, 400);
  addItem(project.cuts[3], 'hidden', 300, 400);
  const output = photographedProject(project);
  assert.equal(output.count, 1);
  assert.deepEqual(output.cuts.map(c => c.id), [project.cuts[1].id]);
  assert.deepEqual(emptyCutIndices(project, 2), [2, 0]);
  assert.equal(exportSpec(output.layout, output.count).cells.length, 1);
  assert.equal(exportSpec('grid', output.count).cells.length, 1);
  assert.equal(project.count, 3);
});

test('4x6 print PDF declares exact page dimensions, repeat count and byte offsets', async () => {
  const image = new Blob([new Uint8Array([255,216,255,217])], {type:'image/jpeg'});
  const pdf = createPrintPdf(image, 1440, 4400, getPrintLayout('photo-4x6', 2));
  const content = new TextDecoder('latin1').decode(await pdf.arrayBuffer());
  assert.equal(pdf.type, 'application/pdf');
  assert.match(content, /\/MediaBox \[0 0 288 432\]/);
  assert.equal((content.match(/\/Photo Do/g) || []).length, 2);
  const offset = Number(content.match(/startxref\n(\d+)/)[1]);
  assert.equal(content.slice(offset, offset + 4), 'xref');
  const lookup = content.slice(offset).split('\n').slice(3, 8);
  lookup.forEach((entry, i) => {
    const start = Number(entry.slice(0, 10));
    assert.equal(content.slice(start, start + 7), (i + 1) + ' 0 obj');
  });
});

test('moving a visible cut keeps its photo, background and adjustments together and is undoable', () => {
  const project = newProject({count:3});
  const first = project.cuts[0], second = project.cuts[1], hidden = project.cuts[3];
  first.background = 'ocean';
  first.adjustment.brightness = 115;
  addItem(first, 'person-a', 400, 600);
  const history = new History();
  history.record(project);
  assert.equal(swapVisibleCuts(project, 0, 1), true);
  assert.equal(project.cuts[0], second);
  assert.equal(project.cuts[1], first);
  assert.equal(project.cuts[1].items[0].assetId, 'person-a');
  assert.equal(project.cuts[1].adjustment.brightness, 115);
  assert.equal(project.cuts[1].background, 'ocean');
  assert.equal(swapVisibleCuts(project, 2, 3), false);
  assert.equal(project.cuts[3], hidden);
  assert.equal(history.undo(project).cuts[0].id, first.id);
});

test('a cut can explicitly use a selected person’s original photo', () => {
  const cut = newProject().cuts[0];
  const first = addItem(cut,'first',300,400);
  const second = addItem(cut,'second',300,400);
  assert.equal(originalPerson(cut),first);
  cut.originalPerson = second.id;
  assert.equal(originalPerson(cut),second);
  cut.items = [first];
  assert.equal(originalPerson(cut),first);
});
