// Edit a copy of the low-resolution confidence mask. All changes stay in memory.
export function paintMask(mask,width,height,x,y,radius,value){
 const left=Math.max(0,Math.floor(x-radius)),right=Math.min(width-1,Math.ceil(x+radius));
 const top=Math.max(0,Math.floor(y-radius)),bottom=Math.min(height-1,Math.ceil(y+radius));
 for(let j=top;j<=bottom;j++)for(let i=left;i<=right;i++)if((i-x)**2+(j-y)**2<=radius**2)mask[j*width+i]=value;
}
export function paintStroke(mask,width,height,a,b,radius,value){const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(1,Math.ceil(distance/Math.max(1,radius/2)));for(let i=0;i<=steps;i++){const t=i/steps;paintMask(mask,width,height,a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,radius,value);}}
