import test from 'node:test';
import assert from 'node:assert/strict';
import {applySegmentationAlpha,canvasBlob} from '../dist/image-tools.mjs';

function referenceAlpha(width,height,mask,mw,mh,softness) {
  const low = .25 - softness * .13;
  const high = .72 + softness * .16;
  return Array.from({length:width * height},(_,index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    const fx = (x + .5) * mw / width - .5;
    const fy = (y + .5) * mh / height - .5;
    const x0 = Math.max(0,Math.floor(fx));
    const y0 = Math.max(0,Math.floor(fy));
    const x1 = Math.min(mw - 1,x0 + 1);
    const y1 = Math.min(mh - 1,y0 + 1);
    const tx = Math.max(0,fx - x0);
    const ty = Math.max(0,fy - y0);
    const sample = (mask[y0*mw+x0]*(1-tx) + mask[y0*mw+x1]*tx)*(1-ty)
      + (mask[y1*mw+x0]*(1-tx) + mask[y1*mw+x1]*tx)*ty;
    const opacity = Math.max(0,Math.min(1,(sample - low) / (high - low)));
    return Math.round(opacity * opacity * (3 - 2 * opacity) * 255);
  });
}

test('cached coordinates preserve every alpha value at image edges and across softness settings', () => {
  const mask = Float32Array.from({length:63},(_,index) => (index * 11 % 63) / 62);
  for (const [w,h] of [[23,19],[5,7],[1,1]]) for (const softness of [0,.5,1]) {
    const pixels = new Uint8ClampedArray(w * h * 4).fill(175);
    applySegmentationAlpha(pixels,w,h,mask,7,9,softness);
    assert.deepEqual([...pixels].filter((_,index) => index % 4 === 3),referenceAlpha(w,h,mask,7,9,softness));
    assert.ok([...pixels].filter((_,index) => index % 4 !== 3).every(value => value === 175));
  }
});

test('failed canvas encoding rejects and the next call can generate a PNG', async () => {
  const expected = new Blob([new Uint8Array([137,80,78,71,13,10,26,10])],{type:'image/png'});
  let attempts = 0;
  const canvas = {toBlob(callback) { callback(++attempts === 1 ? null : expected); }};
  await assert.rejects(canvasBlob(canvas,'image/png'),/만들지 못했어요/);
  assert.equal(await canvasBlob(canvas,'image/png'),expected);
});
