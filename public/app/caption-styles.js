(()=>{
'use strict';
const $=s=>document.querySelector(s), dlg=$('#caption-dialog'); if(!dlg)return;
let previewTimer,previewRevision=0;
let presets=[], mine=[], selected='classic', options={}, editing=null, previewUrl=null;
const fields=['font','size','weight','color','highlightColor','outlineColor','outline','shadow','background','position','wordsPerLine','animation','box','upper','karaoke'];
const numeric=new Set(['size','weight','outline','shadow','wordsPerLine']);
const bool=new Set(['box','upper','karaoke']);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const current=()=>presets.find(p=>p.id===selected)||presets[0];
const value=()=>({version:1,preset:selected,options:{...options}});
window.captionSelection=value;
function render(){
 const p=current();if(!p)return;
 $('#captionStyle').value=selected;$('#caption-gallery-open').textContent='Caption styles: '+p.name+' ▾';
 $('#caption-gallery').innerHTML=presets.map(q=>`<button type="button" class="cap-card" data-preset="${esc(q.id)}" aria-pressed="${q.id===selected}"><span style="color:${esc(q.style.color)};background:${q.style.box?esc(q.style.background):'#090811'}"><em style="font-family:${esc(q.style.font)};font-weight:${q.style.weight};text-shadow:0 2px ${q.style.shadow}px ${esc(q.style.outlineColor)}">Make every moment count</em></span><b>${esc(q.name)}</b><small>${esc(q.description)}</small></button>`).join('');
 $('#caption-gallery').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.preset;options={};render();schedulePreview();});
 const style={...p.style,...options};for(const f of fields){const el=$('#cap-'+f);if(el){if(bool.has(f))el.checked=style[f];else el.value=style[f];}}
 $('#cap-mine').innerHTML=mine.map(m=>`<div><button data-load="${esc(m.id)}">${esc(m.name)}${m.is_default?' (default)':''}</button> <button data-default="${esc(m.id)}">Set default</button> <button data-rename="${esc(m.id)}">Rename</button> <button data-delete="${esc(m.id)}">Delete</button></div>`).join('');
 $('#cap-mine').querySelectorAll('[data-load]').forEach(b=>b.onclick=()=>{selected=mine.find(x=>x.id===b.dataset.load).style.preset;options={...mine.find(x=>x.id===b.dataset.load).style.options};render();schedulePreview();});
 $('#cap-mine').querySelectorAll('[data-default]').forEach(b=>b.onclick=()=>change(b.dataset.default,{is_default:true}));
 $('#cap-mine').querySelectorAll('[data-rename]').forEach(b=>{const name=prompt('Style name');if(name)change(b.dataset.rename,{name});});
 $('#cap-mine').querySelectorAll('[data-delete]').forEach(b=>{if(confirm('Delete this saved style?'))remove(b.dataset.delete);});
}
function status(message){$('#cap-status').textContent=message;}
async function reloadMine(){try{mine=(await api('/api/caption-styles/mine')).styles||[];render();}catch(e){status(e.message);}}
async function change(id,body){try{await api('/api/caption-styles/mine/'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});await reloadMine();status('Saved.');}catch(e){status(e.message);}}
async function remove(id){try{await api('/api/caption-styles/mine/'+encodeURIComponent(id),{method:'DELETE'});await reloadMine();status('Deleted.');}catch(e){status(e.message);}}
fields.forEach(f=>$('#cap-'+f)?.addEventListener('change',e=>{options[f]=bool.has(f)?e.target.checked:numeric.has(f)?Number(e.target.value):e.target.value;schedulePreview();}));
$('#cap-reset').onclick=()=>{options={};render();schedulePreview();};
function schedulePreview(){previewRevision++;clearTimeout(previewTimer);if(!editing)return;status('Style changed. Updating video preview…');previewTimer=setTimeout(()=>{if(dlg.open)$('#cap-preview').onclick();},700);}
$('#caption-close').onclick=()=>dlg.close();
function clearPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
dlg.addEventListener('close',()=>{clearTimeout(previewTimer);previewRevision++;clearPreview();});
$('#caption-gallery-open').onclick=()=>{editing=null;$('#caption-video').replaceChildren();dlg.showModal();};
$('#cap-save-preset').onclick=async()=>{const name=prompt('Name this caption style');if(!name)return;try{await api('/api/caption-styles/mine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,style:value()})});await reloadMine();status('Custom style saved.');}catch(e){status(e.message);}};
$('#cap-preview').onclick=async()=>{if(!editing){status('Choose a clip from Your folders first.');return;}const revision=previewRevision,clip=editing.id;const button=$('#cap-preview');button.disabled=true;status('Rendering a three-second preview…');try{const token=await authToken();const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch('/api/clips/'+encodeURIComponent(editing.id)+'/caption-preview',{method:'POST',credentials:'include',headers,body:JSON.stringify({caption:value()})});if(!r.ok){const error=await r.json().catch(()=>({}));throw new Error(error.error||'Preview failed');}const blob=await r.blob();if(revision!==previewRevision||!dlg.open||editing?.id!==clip)return;clearPreview();previewUrl=URL.createObjectURL(blob);$('#caption-video').innerHTML='<video controls autoplay playsinline></video>';$('#caption-video video').src=previewUrl;status('This is a short render of the selected style on your clip. Apply to export the whole clip.');}catch(e){if(revision===previewRevision)status(e.message);}finally{button.disabled=false;}};
$('#cap-apply').onclick=async()=>{if(!editing){status('Choose a clip from Your folders to apply this style.');return;}clearTimeout(previewTimer);previewRevision++;const button=$('#cap-apply');button.disabled=true;status('Rendering your clip…');try{const r=await api('/api/clips/'+encodeURIComponent(editing.id)+'/restyle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({caption:value()})});editing.url=r.url;editing.edit=r.edit;clearTimeout(previewTimer);previewRevision++;clearPreview();$('#caption-video').innerHTML='<video controls playsinline></video>';$('#caption-video video').src=r.url;if(typeof load==='function')await load();status('Rendered. Play the video to review the actual exported captions.');}catch(e){status(e.message);}finally{button.disabled=false;}};
window.openCaptionEditor=clip=>{clearPreview();editing=clip;try{const v=clip.edit?.caption;if(v){selected=v.preset;options={...v.options};}else{selected=clip.edit?.captionStyle||'classic';options={};}}catch{selected='classic';options={};}render();$('#caption-video').innerHTML=clip.url?`<video controls playsinline src="${esc(clip.url)}"></video>`:'';status('The video shows the last export. Apply the new style to see its exact result.');dlg.showModal();};
api('/api/caption-styles').then(r=>{presets=r.presets||[];render();return reloadMine();}).then(()=>{const d=mine.find(x=>x.is_default);if(d&&!editing){selected=d.style.preset;options={...d.style.options};render();}}).catch(e=>status('Caption presets unavailable: '+e.message));
})();
