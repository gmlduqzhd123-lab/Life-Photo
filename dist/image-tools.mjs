async function decodePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('JPEG, PNG, WebP 사진을 골라 주세요.');
  if (file.size > 10 * 1024 * 1024) throw Error('10MB 이하 사진을 골라 주세요.');
  let bitmap;
  try { bitmap = await createImageBitmap(file, {imageOrientation:'from-image'}); }
  catch { throw Error('이 사진을 열 수 없어요. JPEG 또는 PNG로 바꿔 주세요.'); }
  if (Math.max(bitmap.width, bitmap.height) > 4096) {
    bitmap.close();
    throw Error('긴 변 4096px 이하로 줄인 사진을 골라 주세요.');
  }
  return bitmap;
}

export async function inspectPhoto(file) {
  const bitmap = await decodePhoto(file);
  bitmap.close();
}

export async function readPhoto(file) {
  const bitmap = await decodePhoto(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}
export function canvasBlob(canvas,type,quality) {
  return new Promise((resolve,reject) => canvas.toBlob(blob => {
    if (blob) resolve(blob);
    else reject(Error('저장할 이미지를 만들지 못했어요.'));
  },type,quality));
}

export function applySegmentationAlpha(pixels,w,h,mask,mw,mh,softness = .5) {
  const low = .25 - softness * .13;
  const high = .72 + softness * .16;
  // Every image row samples the same horizontal mask coordinates.
  const left = new Uint32Array(w);
  const right = new Uint32Array(w);
  const rightWeight = new Float64Array(w);
  const leftWeight = new Float64Array(w);
  for (let x = 0; x < w; x += 1) {
    const fx = (x + .5) * mw / w - .5;
    left[x] = Math.max(0,Math.floor(fx));
    right[x] = Math.min(mw - 1,left[x] + 1);
    rightWeight[x] = Math.max(0,fx - left[x]);
    leftWeight[x] = 1 - rightWeight[x];
  }

  let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
  for (let y = 0; y < h; y += 1) {
    const fy = (y + .5) * mh / h - .5;
    const upper = Math.max(0,Math.floor(fy));
    const lower = Math.min(mh - 1,upper + 1);
    const lowerWeight = Math.max(0,fy - upper);
    const upperWeight = 1 - lowerWeight;
    const upperRow = upper * mw;
    const lowerRow = lower * mw;
    let alpha = y * w * 4 + 3;
    for (let x = 0; x < w; x += 1) {
      const confidence = (mask[upperRow + left[x]] * leftWeight[x] + mask[upperRow + right[x]] * rightWeight[x]) * upperWeight
        + (mask[lowerRow + left[x]] * leftWeight[x] + mask[lowerRow + right[x]] * rightWeight[x]) * lowerWeight;
      let opacity = Math.max(0,Math.min(1,(confidence - low) / (high - low)));
      opacity = opacity * opacity * (3 - 2 * opacity);
      pixels[alpha] = Math.round(opacity * 255);
      alpha += 4;
      if (opacity > .15) {
        count += 1;
        minX = Math.min(minX,x);
        maxX = Math.max(maxX,x);
        minY = Math.min(minY,y);
        maxY = Math.max(maxY,y);
      }
    }
  }
  return {minX,minY,maxX,maxY,count};
}

export function makeCutout(source,mask,mw,mh,softness = .5) {
  const {width:w,height:h} = source;
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  try {
    const context = full.getContext('2d',{willReadFrequently:true});
    context.drawImage(source,0,0);
    const pixels = context.getImageData(0,0,w,h);
    const bounds = applySegmentationAlpha(pixels.data,w,h,mask,mw,mh,softness);
    if (bounds.count < w * h * .006) {
      throw Error('인물이 잘 보이지 않아요. 밝은 곳에서 가까이 찍거나 원본 사진을 사용해 주세요.');
    }
    context.putImageData(pixels,0,0);
    const x = Math.max(0,bounds.minX - 10);
    const y = Math.max(0,bounds.minY - 10);
    const crop = document.createElement('canvas');
    crop.width = Math.min(w - 1,bounds.maxX + 10) - x + 1;
    crop.height = Math.min(h - 1,bounds.maxY + 10) - y + 1;
    crop.getContext('2d').drawImage(full,x,y,crop.width,crop.height,0,0,crop.width,crop.height);
    return crop;
  } finally {
    full.width = full.height = 0;
  }
}
