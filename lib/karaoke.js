'use strict';
function karaokeWindows(words,start,end){
 const points=[start,end,...words.flatMap(w=>[Math.max(start,Math.min(end,w.start)),Math.max(start,Math.min(end,w.end))])];
 const boundaries=[...new Set(points)].sort((a,b)=>a-b);
 return boundaries.slice(0,-1).map((from,i)=>({start:from,end:boundaries[i+1],active:words.findIndex(w=>(from+boundaries[i+1])/2>=w.start&&(from+boundaries[i+1])/2<w.end)})).filter(w=>w.end>w.start);
}
module.exports={karaokeWindows};
