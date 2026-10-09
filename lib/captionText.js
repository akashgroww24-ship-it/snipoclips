'use strict';
// Preserve existing word timestamps when possible; redistribute only when count changes.
function visibleWords(original, start, end) {
  return (original || []).filter(w=>w.end > start && w.start < end);
}
function captionWords(original, text, range) {
  if (text === undefined) return original;
  if (typeof text !== 'string' || text.length > 16000) throw new Error('Caption text must be at most 16,000 characters.');
  if(range){
    const visible=visibleWords(original,range.start,range.end);
    const edited=captionWords(visible,text);
    return [...(original||[]).filter(w=>w.end<=range.start),...edited,...(original||[]).filter(w=>w.start>=range.end)];
  }
  const tokens = text.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length || tokens.length > 400 || tokens.some(t => t.length > 200))
    throw new Error('Use 1–400 caption words, with at most 200 characters per word.');
  if (!Array.isArray(original) || !original.length) throw new Error('This clip has no editable transcript.');
  if (tokens.length === original.length) return tokens.map((word,i)=>({word,start:original[i].start,end:original[i].end}));
  const start=Number(original[0].start), end=Number(original[original.length-1].end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw new Error('Caption timing is unavailable.');
  const step=(end-start)/tokens.length;
  return tokens.map((word,i)=>({word,start:+(start+i*step).toFixed(3),end:+(start+(i+1)*step).toFixed(3)}));
}
module.exports={captionWords,visibleWords};
