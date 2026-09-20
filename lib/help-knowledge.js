'use strict';

// Keep answers tied to features actually implemented in the app. Avoid hardcoded
// prices, unverified account claims and promises about third-party URL imports.
const ARTICLES = [
  { id:'getting-started', title:'Create your first clips',
    phrases:['how to use','getting started','first clip','make a clip','create a clip','generate clips','video to shorts','clip kaise','shuru kaise'],
    keywords:['start','create','make','generate','clips','shorts','begin'],
    answer:'Open the Clips page. Paste a video URL or choose Upload file, then set your clip length, count, aspect ratio and caption style. Press “Get clips in 1 click.” Watch the progress panel; finished clips appear under All projects.', link:'/app' },
  { id:'upload', title:'Upload a video file',
    phrases:['upload a file','upload video','upload my video','file upload','drag and drop','mp4','upload kaise'],
    keywords:['file','upload','browse','drag','mov','webm','gigabyte'],
    answer:'On the Clips page, choose the Upload file tab or drag a video onto the upload area. Select an MP4, MOV or WebM file (up to 1 GB), choose the options you want, and press “Get clips in 1 click.” Videos must fit your plan’s length and monthly-minute limits.', link:'/app' },
  { id:'link-fails', title:'A video link does not import',
    phrases:['youtube error','youtube problem','not a bot','sign in to confirm','link not working','url failed','link failed','download failed','import failed','rate limit','video url error','cannot fetch','cant import','cannot import','yt error'],
    keywords:['youtube','import','link','blocked','url','fetch','rate','bot','failed'],
    answer:'Check that the URL is correct and the video is accessible. Some video sites can reject automated imports, even for public videos. If a link fails, download or obtain the original video you have permission to use, then switch to Upload file. Do not keep retrying a blocked link. If your own file also fails, send a bug report with the error message.', link:'/app' },
  { id:'processing', title:'Processing is slow or fails',
    phrases:['stuck processing','stuck rendering','taking too long','processing failed','job failed','server busy','still rendering','video not processing','stuck at','progress stopped','render error'],
    keywords:['stuck','slow','processing','render','queued','timeout','busy','error','waiting'],
    answer:'Keep the app open while the progress panel updates. Longer videos take more time. If you see “Server busy,” wait briefly before trying again. If a job reports an error or never completes, use Report a problem and include the exact error text; I cannot inspect or restart your job from this chat.', link:'/app' },
  { id:'download', title:'Download your generated clips',
    phrases:['download clips','download my clip','save my clip','where are my clips','export clips','download video','where is my video'],
    keywords:['download','export','save','find','clips','results'],
    answer:'Scroll to All projects on the Clips page. Once a clip is ready, use its Download link. Save a copy promptly: Snipo normally deletes stored clips after its retention period (default 30 days).', link:'/app' },
  { id:'captions', title:'Change captions and editing options',
    phrases:['edit caption','change captions','caption color','caption colour','subtitles','font size','caption position','wrong caption','karaoke caption','change font'],
    keywords:['caption','subtitle','font','karaoke','color','colour','text','position'],
    answer:'Before generating, open Options and choose a caption style or language; AI Captions is also in the tools row. For clips that support editing, use the clip editor to adjust captions and re-render. Older clips without an editable master may need regeneration. Use Report a problem if text or timing is incorrect.', link:'/app' },
  { id:'format', title:'Aspect ratio and clip length',
    phrases:['aspect ratio','vertical video','9:16','1:1','4:5','16:9','clip duration','video length','short medium long'],
    keywords:['aspect','ratio','vertical','length','duration','square','landscape'],
    answer:'Open Options before generating. Choose an aspect ratio (9:16, 1:1, 4:5 or 16:9), a length (Auto, Short, Medium or Long), and a clip count. The available clip count and video length are subject to your plan’s quota.', link:'/app' },
  { id:'quota', title:'Credits, quotas and limits',
    phrases:['out of credits','how many credits','quota left','minutes left','monthly limit','free limit','limit reached','not enough quota','how many clips can i'],
    keywords:['quota','credits','minutes','remaining','limit','allowance','usage'],
    answer:'Your Clips page shows your current plan and remaining video minutes. You can also view the available plans on Pricing. If you see a monthly clip/minute limit error, wait for your plan’s renewal or change plans; the help bot cannot grant credits or change billing.', link:'/pricing' },
  { id:'pricing', title:'Plans and payments',
    phrases:['price plans','upgrade plan','buy subscription','manage subscription','cancel subscription','billing help','payment failed','refund','pricing'],
    keywords:['price','plan','subscribe','billing','payment','upgrade','cancel','refund'],
    answer:'See the Pricing page for current plans and what they include. If a payment fails or your upgraded plan does not appear, avoid paying repeatedly; report the issue with the time and non-sensitive payment details. Never send a card number or password to support chat.', link:'/pricing' },
  { id:'reels', title:'Create a combined reel',
    phrases:['reel composer','combine clips','make a reel','auto director','join clips','combine videos','reel banana'],
    keywords:['reel','composer','combine','join','director','montage'],
    answer:'Generate some clips first. Open AI Reel Composer in the app, choose Auto Director or Manual selection, set the target length, caption and music options, then select Create reel. The completed reel appears alongside your projects.', link:'/app' },
  { id:'music', title:'Add music to a reel',
    phrases:['add music','music library','background music','soundtrack','upload own music','music volume','choose track','copyright music'],
    keywords:['music','song','soundtrack','audio','track','volume','license'],
    answer:'In AI Reel Composer, choose the music source: auto-pick from the licensed library, no music, or upload your own track. Use only music you have rights to include in a video. Spotify playback or a song link does not grant a video soundtrack license.', link:'/app' },
  { id:'publish', title:'Connect YouTube and publish a Short',
    phrases:['connect youtube','publish youtube','upload short','post to youtube','youtube account','youtube oauth'],
    keywords:['publish','short','channel','youtube','post','connect'],
    answer:'To publish a finished clip to YouTube, connect your YouTube account using the channel-connection flow and authorize the requested permissions. Publishing a finished clip is different from importing a YouTube source link; connection alone does not guarantee source download.', link:'/app' },
  { id:'login', title:'Sign-in or account trouble',
    phrases:['cant login','cannot login','sign in failed','forgot password','login problem','session expired','not signed in'],
    keywords:['login','password','account','signin','session','authentication'],
    answer:'Go to the sign-in page and use your account’s available sign-in method. If the app says your session expired, sign in again. Do not share your password or verification codes in chat. If you still cannot access your account, report the error through the support channel.', link:'/login' },
  { id:'privacy', title:'File storage and privacy',
    phrases:['delete my clips','data privacy','how long stored','storage retention','my data','delete video','is it private'],
    keywords:['privacy','delete','retention','stored','storage','private','secure'],
    answer:'Generated clips are normally retained for 30 days before automated cleanup; download anything you need to keep. Content access is tied to the signed-in user. Do not paste secrets into help chat. For account-specific deletion or privacy requests, contact support.', link:'/faq' },
  { id:'support', title:'Report a problem to the team',
    phrases:['report a bug','contact support','human support','talk to human','speak to agent','report problem','send ticket','still broken'],
    keywords:['support','bug','ticket','agent','human','helpdesk','problem'],
    answer:'Click “Report a problem” below this chat. Describe what you tried, what went wrong and the exact error message; do not include passwords, API keys, or payment card details. The report goes to the Snipo admin dashboard.', link:null }
];

const STOP = new Set('a an and are can do does for from how i in is it me my of on or please the to what when where why with you your want need tell show help issue problem app video videos clip clips'.split(' '));
const ALIASES = { downloading:'download',downloaded:'download',saving:'save',exporting:'export',uploads:'upload',uploaded:'upload',uploading:'upload',importing:'import',imported:'import',generating:'generate',generated:'generate',rendering:'render',captions:'caption',subtitles:'subtitle',payments:'payment',prices:'price',failed:'fail',failing:'fail',errors:'error',stopped:'stuck',issues:'error',shorts:'short' };
function normalize(v) { return String(v || '').normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}:]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function words(v) { return [...new Set(normalize(v).split(' ').filter(w=>w.length>1 && !STOP.has(w)).map(w=>ALIASES[w]||w))]; }
function match(question) {
  const q = normalize(question);
  if (!q) return [];
  const tokens = words(q);
  return ARTICLES.map(article => {
    let score = 0;
    for (const phrase of article.phrases) {
      const p = normalize(phrase);
      if (q.includes(p)) score += p.includes(' ') ? 8 : 3;
    }
    const terms = words(article.keywords.join(' '));
    score += tokens.filter(t=>terms.includes(t)).length * 1.7;
    return { article, score };
  }).filter(x=>x.score >= 2).sort((a,b)=>b.score-a.score).slice(0,3);
}
function fallback(question) {
  const hits = match(question);
  if (!hits.length) return {
    reply:'I can help with creating clips, imports, captions, downloads, quotas, reels and music. Could you describe which step you are on and what happened? If something is broken, choose “Report a problem” below.',
    topics: ARTICLES.slice(0,4).map(a=>({ id:a.id, title:a.title }))
  };
  const article = hits[0].article;
  return { reply:article.answer, link:article.link, topics:hits.slice(1).map(x=>({ id:x.article.id, title:x.article.title })) };
}
module.exports = { ARTICLES, match, fallback, normalize };
