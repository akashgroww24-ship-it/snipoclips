// Meta OAuth and Graph API calls. Access tokens and app secrets never leave this module's server calls.
const VERSION = process.env.META_GRAPH_VERSION;
const IG_SCOPES = ['instagram_business_basic','instagram_business_content_publish'];
const FB_SCOPES = ['pages_show_list','pages_read_engagement','pages_manage_posts'];

function configured(provider) {
  const id = provider === 'instagram' ? process.env.META_INSTAGRAM_APP_ID : process.env.META_FACEBOOK_APP_ID;
  const secret = provider === 'instagram' ? process.env.META_INSTAGRAM_APP_SECRET : process.env.META_FACEBOOK_APP_SECRET;
  const redirect = provider === 'instagram' ? process.env.META_INSTAGRAM_REDIRECT_URI : process.env.META_FACEBOOK_REDIRECT_URI;
  return !!(id && secret && redirect && /^v\d+\.\d+$/.test(VERSION || '') && /^https:\/\//.test(redirect));
}
function credentials(provider) {
  if (!configured(provider)) throw new Error('Meta connector is not configured');
  return provider === 'instagram'
    ? [process.env.META_INSTAGRAM_APP_ID,process.env.META_INSTAGRAM_APP_SECRET,process.env.META_INSTAGRAM_REDIRECT_URI]
    : [process.env.META_FACEBOOK_APP_ID,process.env.META_FACEBOOK_APP_SECRET,process.env.META_FACEBOOK_REDIRECT_URI];
}
function authUrl(provider,state) {
  const [id,,redirect] = credentials(provider);
  const params = new URLSearchParams({client_id:id,redirect_uri:redirect,response_type:'code',scope:(provider==='instagram'?IG_SCOPES:FB_SCOPES).join(','),state});
  return (provider==='instagram'?'https://www.instagram.com/oauth/authorize':'https://www.facebook.com/'+VERSION+'/dialog/oauth')+'?'+params;
}
async function json(url, options={}) {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000),redirect:'error'});
  let data;
  try{data=await response.json();}catch{throw new Error('META_INVALID_RESPONSE');}
  if(!response.ok||data.error){
    const err=new Error('META_API_ERROR');
    err.status=response.status;err.metaCode=data.error?.code;err.metaSubcode=data.error?.error_subcode;
    throw err;
  }
  return data;
}
function graph(provider,path,token,params={}) {
  const host=provider==='instagram'?'https://graph.instagram.com/':'https://graph.facebook.com/';
  const url=new URL(VERSION+'/'+path.replace(/^\//,''),host);
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  return json(url,{headers:{Authorization:'Bearer '+token}});
}
function postGraph(provider,path,token,params) {
  const host=provider==='instagram'?'https://graph.instagram.com/':'https://graph.facebook.com/';
  return json(new URL(VERSION+'/'+path.replace(/^\//,''),host),{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
}
async function exchange(provider,code) {
  const [id,secret,redirect]=credentials(provider);
  if(provider==='instagram'){
    const short=await json('https://api.instagram.com/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:'authorization_code',redirect_uri:redirect,code})});
    if(!short.access_token)throw new Error('META_MISSING_TOKEN');
    const granted=Array.isArray(short.permissions)?short.permissions:[];
    if(!IG_SCOPES.every(scope=>granted.includes(scope)))throw new Error('META_PUBLISH_PERMISSION_REQUIRED');
    const url=new URL('https://graph.instagram.com/access_token');
    url.search=new URLSearchParams({grant_type:'ig_exchange_token',client_secret:secret,access_token:short.access_token}).toString();
    const long=await json(url);
    return {access_token:long.access_token,expires_in:long.expires_in,scopes:granted};
  }
  const url=new URL('https://graph.facebook.com/'+VERSION+'/oauth/access_token');
  url.search=new URLSearchParams({client_id:id,client_secret:secret,redirect_uri:redirect,code}).toString();
  const short=await json(url);
  const longUrl=new URL('https://graph.facebook.com/'+VERSION+'/oauth/access_token');
  longUrl.search=new URLSearchParams({grant_type:'fb_exchange_token',client_id:id,client_secret:secret,fb_exchange_token:short.access_token}).toString();
  const long=await json(longUrl);
  const permissions=await graph('facebook','me/permissions',long.access_token);
  const granted=(permissions.data||[]).filter(p=>p.status==='granted').map(p=>p.permission);
  if(!FB_SCOPES.every(scope=>granted.includes(scope)))throw new Error('META_PUBLISH_PERMISSION_REQUIRED');
  return {access_token:long.access_token,expires_in:long.expires_in,scopes:granted};
}
async function identities(provider,token) {
  if(provider==='instagram'){
    const profile=await graph('instagram','me',token,{fields:'id,username,account_type'});
    if(!profile.id||!['BUSINESS','MEDIA_CREATOR'].includes(profile.account_type))throw new Error('INSTAGRAM_PROFESSIONAL_REQUIRED');
    return [{id:String(profile.id),name:profile.username||'Instagram account',token}];
  }
  const pages=[];let after;
  for(let i=0;i<10;i++){
    const data=await graph('facebook','me/accounts',token,{fields:'id,name,access_token,tasks',limit:100,...(after?{after}:{})});
    for(const page of data.data||[]){
      if(page.id&&page.access_token&&Array.isArray(page.tasks)&&page.tasks.includes('CREATE_CONTENT'))pages.push({id:String(page.id),name:page.name||'Facebook Page',token:page.access_token});
    }
    const next=data.paging?.cursors?.after;
    if(!data.paging?.next||!next||next===after)break;
    after=next;
  }
  if(!pages.length)throw new Error('FACEBOOK_PAGE_REQUIRED');
  return pages;
}
async function refreshInstagram(token){
  const url=new URL('https://graph.instagram.com/refresh_access_token');
  url.search=new URLSearchParams({grant_type:'ig_refresh_token',access_token:token}).toString();
  return json(url);
}
async function instagramContainer(id,token,videoUrl,caption){return postGraph('instagram',id+'/media',token,{media_type:'REELS',video_url:videoUrl,caption});}
async function instagramStatus(id,token){return graph('instagram',id,token,{fields:'status_code'});}
async function instagramPublish(id,containerId,token){return postGraph('instagram',id+'/media_publish',token,{creation_id:containerId});}
async function instagramPermalink(id,token){return graph('instagram',id,token,{fields:'permalink'});}
async function facebookStart(pageId,token){return postGraph('facebook',pageId+'/video_reels',token,{upload_phase:'start'});}
async function facebookUpload(videoId,token,videoUrl){
  const r=await fetch('https://rupload.facebook.com/video-upload/'+VERSION+'/'+encodeURIComponent(videoId),{method:'POST',headers:{Authorization:'OAuth '+token,file_url:videoUrl},signal:AbortSignal.timeout(120000),redirect:'error'});
  if(!r.ok)throw new Error('META_UPLOAD_ERROR');
  const data=await r.json();
  if(data.success!==true)throw new Error('META_UPLOAD_ERROR');
  return data;
}
async function facebookStatus(videoId,token){return graph('facebook',videoId,token,{fields:'status'});}
async function facebookPublish(pageId,videoId,token,caption){return postGraph('facebook',pageId+'/video_reels',token,{upload_phase:'finish',video_id:videoId,video_state:'PUBLISHED',description:caption});}

module.exports={VERSION,IG_SCOPES,FB_SCOPES,configured,authUrl,exchange,identities,refreshInstagram,
  instagramContainer,instagramStatus,instagramPublish,instagramPermalink,facebookStart,facebookUpload,facebookStatus,facebookPublish};
