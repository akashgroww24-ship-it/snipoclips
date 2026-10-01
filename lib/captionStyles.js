'use strict';
// Version 1: a single allowlisted model for the browser, API and ASS renderer.
const base = { font:'Noto Sans Devanagari', size:74, weight:700, color:'#FFFFFF', highlightColor:'#FFFF00', outlineColor:'#000000', outline:4, shadow:2, background:'#000000', box:false, position:'bottom', wordsPerLine:4, upper:false, animation:'pop', karaoke:true };
const raw = [
 ['classic','Yellow highlight','Familiar bright karaoke captions',{color:'#FFFF00',highlightColor:'#00FF00'}],
 ['white','Clean white','Simple white text',{color:'#FFFFFF',animation:'none',karaoke:false}],
 ['green','Mint','Fresh green speech highlights',{color:'#00FF00'}],
 ['pink','Pink','Playful pink highlights',{color:'#FF69B4'}],
 ['cinematic','Cinematic','Restrained film-style subtitles',{size:60,weight:400,outline:2,shadow:3,position:'bottom',animation:'fade',karaoke:false}],
 ['podcast','Podcast','Readable talk-show captions',{color:'#FFFFFF',highlightColor:'#29C7FF',box:true,background:'#151525',size:68}],
 ['karaoke','Karaoke','Word-by-word color sweep',{color:'#FFFFFF',highlightColor:'#FACC15',karaoke:true,animation:'pop'}],
 ['creator','Bold creator','Large energetic centered text',{size:100,weight:900,upper:true,position:'middle',color:'#FFFFFF',highlightColor:'#FC4DCE'}],
 ['minimal','Minimal','Quiet captions without decoration',{size:55,weight:400,outline:1,shadow:0,animation:'none',karaoke:false}],
 ['boxed','Boxed','Text on a dark panel',{box:true,background:'#111827',size:72,animation:'fade'}],
 ['outline','Outlined','Bold lettering with a thick edge',{outline:7,shadow:0,size:80,animation:'none'}],
 ['shadow','Soft shadow','Floating text with subtle depth',{outline:0,shadow:5,size:70,animation:'fade'}],
 ['gradient','Gradient words','Color shifts from pink to cyan across each caption',{color:'#FF55BB',highlightColor:'#55EAFF',karaoke:false,animation:'fade'}],
 ['duotone','Duotone pop','Alternating vivid highlight colors',{color:'#FF83D0',highlightColor:'#62E7FF',outline:3,animation:'pop'}],
 ['neon','Neon','Glowing cyan lettering',{color:'#22F7F7',highlightColor:'#FF37D4',outlineColor:'#1C174D',outline:5,shadow:4}],
 ['retro','Retro','Warm vintage title cards',{color:'#FFE6A7',highlightColor:'#FF9B54',background:'#38271C',box:true,upper:true,animation:'fade'}],
 ['typewriter','Typewriter','Monospaced text with a gentle reveal',{font:'DejaVu Sans Mono',weight:400,size:60,animation:'fade',karaoke:false}],
 ['comic','Comic','Punchy speech-bubble energy',{color:'#FFE600',highlightColor:'#FF5D5D',outline:6,box:true,background:'#272043',upper:true}],
 ['contrast','High contrast','Bright text on a black panel',{color:'#FFFFFF',highlightColor:'#FFFF00',background:'#000000',box:true,outline:2,animation:'none'}],
 ['amber','Amber','Warm gold and dark borders',{color:'#FFCC55',highlightColor:'#FFFFFF',outline:5,box:true,background:'#302110',position:'middle'}],
 ['ice','Ice','Cool blue highlights',{color:'#D8F5FF',highlightColor:'#54B7FF',outlineColor:'#173550',position:'top',size:64,shadow:4}],
 ['lime','Lime burst','Electric green social captions',{color:'#C6FF35',highlightColor:'#FFFFFF',size:88,upper:true,position:'middle',wordsPerLine:2}],
 ['lavender','Lavender','Soft purple editorial captions',{color:'#E9D5FF',highlightColor:'#FFFFFF',animation:'fade',position:'middle',size:58,weight:400}],
 ['headline','Headline','Top-aligned attention grabber',{position:'top',size:92,upper:true,box:true,background:'#182033'}],
 ['mono','Mono','Monochrome technical captions',{font:'DejaVu Sans Mono',size:62,weight:400,color:'#FFFFFF',highlightColor:'#AAAAAA',animation:'none',box:true,background:'#242424',position:'top'}],
 ['off','Captions off','Export without subtitles',{animation:'none',karaoke:false}]
];
const presets = Object.freeze(raw.map(([id,name,description,values])=>Object.freeze({id,name,description,style:Object.freeze({...base,...values})})));
const byId = new Map(presets.map(p=>[p.id,p]));
const fonts = new Set(['Noto Sans Devanagari','DejaVu Sans','DejaVu Sans Mono']);
const positions = new Set(['bottom','middle','top']);
const animations = new Set(['none','fade','pop']);
const colors = ['color','highlightColor','outlineColor','background'];
function validate(input, fallback='classic') {
  if (typeof input === 'string') input={preset:input};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid caption style');
  if (input.version !== undefined && input.version !== 1) throw new Error('Unsupported caption style version');
  const preset = input.preset || input.captionStyle || fallback;
  if (!byId.has(preset)) throw new Error('Unknown caption preset');
  const patch = input.options || {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid caption options');
  const allowed = new Set(Object.keys(base));
  if (Object.keys(patch).some(k=>!allowed.has(k))) throw new Error('Unknown caption option');
  const style={...byId.get(preset).style,...patch};
  if (!fonts.has(style.font)||!positions.has(style.position)||!animations.has(style.animation)) throw new Error('Invalid caption option');
  for(const k of colors) if(!/^#[0-9A-Fa-f]{6}$/.test(style[k])) throw new Error('Invalid caption color');
  for(const [key,min,max] of [['size',40,140],['weight',400,900],['outline',0,8],['shadow',0,6],['wordsPerLine',1,6]])
    if(!Number.isInteger(style[key])||style[key]<min||style[key]>max) throw new Error('Invalid caption '+key);
  if(![400,700,900].includes(style.weight)||typeof style.box!=='boolean'||typeof style.upper!=='boolean'||typeof style.karaoke!=='boolean') throw new Error('Invalid caption option');
  return {version:1,preset,options:Object.fromEntries(Object.keys(patch).map(k=>[k,style[k]])),resolved:style};
}
function fromLegacy(edit={}) { return validate({preset:byId.has(edit.captionStyle)?edit.captionStyle:'classic',options:{
  ...(fonts.has(edit.font)?{font:edit.font}:{}),...(Number.isInteger(edit.fontSize)&&edit.fontSize>=40&&edit.fontSize<=140?{size:edit.fontSize}:{}),
  ...(positions.has(edit.position)?{position:edit.position}:{}),...(typeof edit.upper==='boolean'?{upper:edit.upper}:{}),
  ...(typeof edit.karaoke==='boolean'?{karaoke:edit.karaoke}:{}),...(typeof edit.animate==='boolean'?{animation:edit.animate?'pop':'none'}:{})
 }}); }
module.exports={presets,validate,fromLegacy};
