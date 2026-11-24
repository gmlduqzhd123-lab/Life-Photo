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
export function makeCutout(source,mask,mw,mh,softness=.5){const w=source.width,h=source.height;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);const pixels=ctx.getImageData(0,0,w,h);let minX=w,minY=h,maxX=0,maxY=0,count=0;const low=.25-softness*.13,high=.72+softness*.13;
for(let y=0;y<h;y++){const fy=(y+.5)*mh/h-.5,y0=Math.max(0,Math.floor(fy)),y1=Math.min(mh-1,y0+1),ty=Math.max(0,fy-y0);for(let x=0;x<w;x++){const fx=(x+.5)*mw/w-.5,x0=Math.max(0,Math.floor(fx)),x1=Math.min(mw-1,x0+1),tx=Math.max(0,fx-x0);const p=(mask[y0*mw+x0]*(1-tx)+mask[y0*mw+x1]*tx)*(1-ty)+(mask[y1*mw+x0]*(1-tx)+mask[y1*mw+x1]*tx)*ty;let a=Math.max(0,Math.min(1,(p-low)/(high-low)));a=a*a*(3-2*a);pixels.data[(y*w+x)*4+3]=Math.round(a*255);if(a>.15){count++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}}
if(count<w*h*.006)throw Error('인물이 잘 보이지 않아요. 밝은 곳에서 가까이 찍거나 원본 사진을 사용해 주세요.');ctx.putImageData(pixels,0,0);const pad=10;minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);maxX=Math.min(w-1,maxX+pad);maxY=Math.min(h-1,maxY+pad);const crop=document.createElement('canvas');crop.width=maxX-minX+1;crop.height=maxY-minY+1;crop.getContext('2d').drawImage(c,minX,minY,crop.width,crop.height,0,0,crop.width,crop.height);c.width=c.height=0;return crop;}
