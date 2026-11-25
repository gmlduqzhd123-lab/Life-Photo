import test from 'node:test';
import assert from 'node:assert/strict';
import {planBatchPrint,pngPrintDimensions} from '../dist/batch-print.mjs';
import {createImagePdf,printTrimLines} from '../dist/print-pdf.mjs';

test('batch print keeps selection order, repeats chosen photos and puts every placement inside the requested A4 margin', () => {
  const files = [{width:1440,height:4400,copies:2},{width:2800,height:2480,copies:1},{width:1200,height:900,copies:1}];
  const {paper,pages,count} = planBatchPrint(files,2,12);
  assert.equal(count,4);
  assert.deepEqual(pages.map(page => page.map(cell => cell.image)),[[0,0],[1,2]]);
  assert.deepEqual([paper.width,paper.height,paper.margin],[210,297,12]);
  for (const cell of pages.flat()) {
    assert.ok(cell.x >= 12 && cell.y >= 12 && cell.x + cell.w <= 198 && cell.y + cell.h <= 285.00001);
    assert.ok(Math.abs(cell.w / cell.h - files[cell.image].width / files[cell.image].height) < 1e-6);
    for (const [x,y,x2,y2] of printTrimLines(cell)) assert.ok(x >= 0 && x2 <= 210 && y >= 0 && y2 <= 297);
  }
});

test('multi-page print PDF draws each image and cut marks with valid byte offsets', async () => {
  const jpeg = new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
  const images = [{jpeg,width:1440,height:4400,copies:2},{jpeg,width:2800,height:2480,copies:1}];
  const {paper,pages} = planBatchPrint(images,2,8);
  const pdf = createImagePdf(images,pages,paper,{trim:true});
  const data = new TextDecoder('windows-1252').decode(await pdf.arrayBuffer());
  assert.match(data,/\/Type \/Pages \/Kids \[5 0 R 7 0 R\] \/Count 2/);
  assert.equal((data.match(/\/Subtype \/Image/g) || []).length,2);
  assert.equal((data.match(/\/Photo Do/g) || []).length,2);
  assert.equal((data.match(/\/Photo2 Do/g) || []).length,1);
  assert.equal((data.match(/m [\d.]+ [\d.]+ l\n/g) || []).length,24);
  const xref = Number(data.match(/startxref\n(\d+)/)[1]);
  const offsets = data.slice(xref).split('\n').slice(3,11);
  offsets.forEach((line,index) => {
    const offset = Number(line.slice(0,10));
    assert.ok(data.slice(offset).startsWith((index + 1) + ' 0 obj'));
  });
});

test('batch print accepts normal high resolution exports and rejects misleading or extremely large headers', () => {
  const header = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,0,0,0,0,0]);
  const view = new DataView(header.buffer);
  view.setUint32(16,1440);
  view.setUint32(20,4400);
  assert.deepEqual(pngPrintDimensions(header),{width:1440,height:4400});
  view.setUint32(20,100000);
  assert.throws(() => pngPrintDimensions(header),/크기를 줄여/);
  header[0] = 0;
  assert.throws(() => pngPrintDimensions(header),/PNG/);
});
