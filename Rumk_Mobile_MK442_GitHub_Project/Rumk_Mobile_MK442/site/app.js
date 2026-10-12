'use strict';

const STORE_KEY = 'rumk_mobile_mk442_v1';
const DEFAULTS = {
  source: 'youtube', topic: 'مقاطع قصيرة ترند', apiKey: '', autoplay: true,
  profileName: 'مجد الخميس', profileHandle: '@mk442', likes: {}, saves: {}, follows: {}, userClips: []
};
const SOURCES = {
  youtube: { label: 'YouTube', ar: 'يوتيوب', icon: '▶', color: '#ff355d' },
  tiktok: { label: 'TikTok', ar: 'تيك توك', icon: '♪', color: '#ff4aa6' },
  snapchat: { label: 'Snapchat', ar: 'سناب شات', icon: '👻', color: '#ffe34f' },
  x: { label: 'X', ar: 'إكس', icon: '𝕏', color: '#ffffff' },
  facebook: { label: 'Facebook', ar: 'فيسبوك', icon: 'f', color: '#4b8dff' },
  instagram: { label: 'Instagram', ar: 'إنستغرام', icon: '◎', color: '#f86cae' },
  direct: { label: 'Video', ar: 'رابط فيديو', icon: '▷', color: '#25d9ff' }
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
let state = loadState();
let feedClips = [];
let feedObserver = null;
let activeClipKey = null;
let currentOrder = 'relevance';
let loadSequence = 0;
let toastTimer = null;
let nativeCallId = 0;
const pendingNative = new Map();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return { ...structuredClone(DEFAULTS), ...saved,
      likes: { ...DEFAULTS.likes, ...(saved.likes || {}) },
      saves: { ...DEFAULTS.saves, ...(saved.saves || {}) },
      follows: { ...DEFAULTS.follows, ...(saved.follows || {}) },
      userClips: Array.isArray(saved.userClips) ? saved.userClips : [] };
  } catch (_) { return structuredClone(DEFAULTS); }
}
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (_) { toast('مساحة التخزين ممتلئة. احذف بعض الروابط المحفوظة.'); }
}
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2300);
}
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function openUrl(url) {
  if (window.RumkNative && typeof window.RumkNative.openExternal === 'function') {
    window.RumkNative.openExternal(String(url)); return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
function setScreen(name) {
  const ids = { feed: 'feedScreen', search: 'searchScreen', saved: 'savedScreen', profile: 'profileScreen' };
  Object.entries(ids).forEach(([key, id]) => $('#' + id).classList.toggle('hidden', key !== name));
  $$('.nav-button').forEach(btn => btn.classList.toggle('active', btn.dataset.screen === name));
  if (name === 'saved') renderSaved();
  if (name === 'profile') refreshProfile();
  if (name === 'feed') setTimeout(() => feedObserver?.takeRecords(), 0);
}
function showDialog(id) { const d = $('#' + id); if (!d.open) d.showModal(); }
function closeDialog(id) { const d = $('#' + id); if (d.open) d.close(); }
function sourceSearchUrl(source, topic) {
  const q = encodeURIComponent(topic.trim() || 'trending videos');
  const map = {
    youtube: `https://www.youtube.com/results?search_query=${q}`,
    tiktok: `https://www.tiktok.com/search?q=${q}`,
    snapchat: 'https://www.snapchat.com/spotlight',
    x: `https://x.com/search?q=${q}%20filter%3Avideos&src=typed_query`,
    facebook: `https://www.facebook.com/search/videos/?q=${q}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${q}`
  };
  return map[source] || map.youtube;
}
function showStateCard({ icon = '▶', title, message, primary = null, secondary = null, loading = false }) {
  $('#feed').innerHTML = '';
  const card = document.createElement('div'); card.className = 'state-card' + (loading ? ' state-loading' : '');
  if (loading) {
    const loader = document.createElement('div'); loader.className = 'loader'; card.appendChild(loader);
  } else {
    const orb = document.createElement('div'); orb.className = 'empty-orb'; orb.textContent = icon; card.appendChild(orb);
  }
  const h = document.createElement('h2'); h.textContent = title; card.appendChild(h);
  const p = document.createElement('p'); p.textContent = message; card.appendChild(p);
  if (primary || secondary) {
    const actions = document.createElement('div'); actions.className = 'state-actions';
    if (primary) { const b = document.createElement('button'); b.className = 'primary-btn'; b.textContent = primary.label; b.onclick = primary.onClick; actions.appendChild(b); }
    if (secondary) { const b = document.createElement('button'); b.className = 'secondary-btn'; b.textContent = secondary.label; b.onclick = secondary.onClick; actions.appendChild(b); }
    card.appendChild(actions);
  }
  $('#feed').appendChild(card);
}
function nativeYoutubeSearch(query) {
  return new Promise(resolve => {
    if (!window.RumkNative || typeof window.RumkNative.searchYouTubeRss !== 'function') return resolve(null);
    const id = String(++nativeCallId); pendingNative.set(id, resolve);
    window.RumkNative.searchYouTubeRss(query, currentOrder, id);
    setTimeout(() => { if (pendingNative.has(id)) { pendingNative.delete(id); resolve(null); } }, 15000);
  });
}
window.__rumkNativeResult = function (id, jsonText) {
  const resolve = pendingNative.get(String(id));
  if (!resolve) return;
  pendingNative.delete(String(id));
  try { resolve(JSON.parse(jsonText)); } catch (_) { resolve(null); }
};
function parseYoutubeRss(xmlText) {
  const parsed = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (parsed.querySelector('parsererror')) throw new Error('تعذّر قراءة نتائج البحث.');
  return $$('entry', parsed).map(entry => {
    const id = entry.getElementsByTagNameNS('*', 'videoId')[0]?.textContent?.trim();
    const title = entry.querySelector('title')?.textContent?.trim() || 'مقطع YouTube';
    const author = entry.querySelector('author name')?.textContent?.trim() || 'YouTube creator';
    const published = entry.querySelector('published')?.textContent?.trim() || '';
    if (!id) return null;
    return { key: 'yt-' + id, source: 'youtube', id, title, author, published,
      description: '', url: 'https://www.youtube.com/watch?v=' + id,
      thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', isUser: false };
  }).filter(Boolean);
}
async function searchYoutube(topic, order = 'relevance') {
  const nativeResult = await nativeYoutubeSearch(topic);
  if (Array.isArray(nativeResult) && nativeResult.length) return nativeResult.map(normalizeNativeClip);
  if (state.apiKey.trim()) {
    const params = new URLSearchParams({ part: 'snippet', q: topic, type: 'video', maxResults: '20', order,
      regionCode: 'SA', relevanceLanguage: 'ar', safeSearch: 'moderate', key: state.apiKey.trim() });
    const response = await fetch('https://www.googleapis.com/youtube/v3/search?' + params.toString());
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'تعذر البحث عبر YouTube API. تأكد من المفتاح والإعدادات.');
    return (data.items || []).filter(item => item.id?.videoId).map(item => {
      const s = item.snippet || {}, id = item.id.videoId;
      return { key: 'yt-' + id, source: 'youtube', id, title: s.title || 'مقطع YouTube', author: s.channelTitle || 'YouTube creator',
        published: s.publishedAt || '', description: s.description || '', url: 'https://www.youtube.com/watch?v=' + id,
        thumbnail: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || ('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'), isUser: false };
    });
  }
  if (Array.isArray(nativeResult)) return [];
  // The public YouTube search feed works in Android's native bridge without a browser CORS restriction.
  // In regular browsers, try it directly; if CORS is blocked, ask for an official API key.
  const rssUrl = 'https://www.youtube.com/feeds/videos.xml?search_query=' + encodeURIComponent(topic);
  const response = await fetch(rssUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('تعذر تحميل نتائج يوتيوب من اتصالك الحالي.');
  return parseYoutubeRss(await response.text());
}
function normalizeNativeClip(item) {
  const id = item.id || item.videoId;
  return { key: 'yt-' + id, source: 'youtube', id,
    title: item.title || 'مقطع YouTube', author: item.author || item.channelTitle || 'YouTube creator',
    published: item.published || '', description: item.description || '', url: item.url || ('https://www.youtube.com/watch?v=' + id),
    thumbnail: item.thumbnail || ('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'), isUser: false };
}
function detectClipSource(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error('اكتب رابطًا كاملًا يبدأ بـ https://'); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    let id = u.searchParams.get('v');
    if (!id && host === 'youtu.be') id = u.pathname.split('/').filter(Boolean)[0];
    if (!id) id = u.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1];
    if (id) return { source: 'youtube', id };
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const id = u.pathname.match(/\/video\/(\d+)/)?.[1]; return { source: 'tiktok', id: id || '' };
  }
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const match = u.pathname.match(/\/(reel|p|tv)\/([^/?]+)/); return { source: 'instagram', id: match?.[2] || '', itemType: match?.[1] || 'reel' };
  }
  if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com')) {
    return { source: 'x', id: u.pathname.match(/\/status\/(\d+)/)?.[1] || '' };
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch') return { source: 'facebook', id: '' };
  if (host === 'snapchat.com' || host.endsWith('.snapchat.com')) return { source: 'snapchat', id: '' };
  if (/\.(mp4|webm|ogg)(?:$|\?)/i.test(u.href) || /\.(mp4|webm|ogg)$/i.test(u.pathname)) return { source: 'direct', id: '' };
  return { source: 'direct', id: '' };
}
function makeUserClip(url, caption = '') {
  const parsed = detectClipSource(url);
  const key = 'link-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  let title = caption.trim();
  if (!title) title = ({ youtube: 'مقطع من YouTube', tiktok: 'مقطع من TikTok', snapchat: 'مقطع من Snapchat', x: 'منشور من X', facebook: 'مقطع من Facebook', instagram: 'مقطع من Instagram', direct: 'مقطع مضاف' })[parsed.source];
  return { key, source: parsed.source, id: parsed.id || '', itemType: parsed.itemType || '', title, author: state.profileHandle || '@mk442', description: 'أضيف يدويًا إلى خلاصة Rumk', url, thumbnail: parsed.source === 'youtube' && parsed.id ? `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg` : '', isUser: true };
}
function sourceName(source) { return (SOURCES[source] || SOURCES.direct).label; }
function getClipThumb(clip) { return clip.thumbnail || (clip.source === 'youtube' && clip.id ? `https://i.ytimg.com/vi/${clip.id}/hqdefault.jpg` : 'assets/rumk.svg'); }
function buildPlayer(clip, host) {
  host.innerHTML = '';
  const addFrame = (src, title) => {
    const frame = document.createElement('iframe'); frame.className = 'embed-frame'; frame.src = src; frame.title = title || sourceName(clip.source) + ' player';
    frame.loading = 'lazy'; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true; host.appendChild(frame);
  };
  if (clip.source === 'youtube' && clip.id) {
    const autoplay = state.autoplay ? '1' : '0';
    addFrame(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(clip.id)}?playsinline=1&autoplay=${autoplay}&mute=1&rel=0&modestbranding=1&controls=1`, clip.title);
    return;
  }
  if (clip.source === 'tiktok' && clip.id) {
    addFrame(`https://www.tiktok.com/embed/v2/${encodeURIComponent(clip.id)}`, clip.title); return;
  }
  if (clip.source === 'instagram' && clip.id) {
    const kind = clip.itemType === 'p' ? 'p' : 'reel';
    addFrame(`https://www.instagram.com/${kind}/${encodeURIComponent(clip.id)}/embed/`, clip.title); return;
  }
  if (clip.source === 'x' && clip.id) {
    addFrame(`https://platform.twitter.com/embed/Tweet.html?id=${encodeURIComponent(clip.id)}&theme=dark`, clip.title); return;
  }
  if (clip.source === 'facebook' && clip.url) {
    addFrame(`https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(clip.url)}&show_text=false&width=420`, clip.title); return;
  }
  if (clip.source === 'direct' && /\.(mp4|webm|ogg)(?:$|\?)/i.test(clip.url)) {
    const video = document.createElement('video'); video.src = clip.url; video.controls = true; video.playsInline = true; video.loop = true; video.preload = 'metadata'; video.autoplay = !!state.autoplay; video.muted = true; host.appendChild(video); return;
  }
  const fallback = document.createElement('div'); fallback.className = 'link-fallback';
  const orb = document.createElement('div'); orb.className = 'platform-orb'; orb.textContent = (SOURCES[clip.source] || SOURCES.direct).icon;
  const heading = document.createElement('h3'); heading.textContent = clip.source === 'snapchat' ? 'قد لا يقبل سناب التضمين داخل التطبيقات' : 'المقطع محفوظ في خلاصة Rumk';
  const message = document.createElement('p');
  message.textContent = clip.source === 'snapchat'
    ? 'بعض روابط Spotlight لا توفر مشغّل ويب قابلًا للتضمين. افتحه من الرابط الأصلي للمشاهدة.'
    : 'إذا لم يظهر مشغّل المنصة، استخدم زر فتح المصدر. Rumk لا ينزّل المقطع ولا يتجاوز قيود الموقع.';
  const link = document.createElement('a'); link.href = clip.url; link.textContent = 'مشاهدة المقطع الأصلي ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.onclick = event => { event.preventDefault(); openUrl(clip.url); };
  fallback.append(orb, heading, message, link); host.appendChild(fallback);
}
function addLazyLoading() {
  feedObserver?.disconnect();
  feedObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const card = entry.target;
      const clip = feedClips.find(c => c.key === card.dataset.clipKey);
      if (!clip) return;
      if (entry.isIntersecting && entry.intersectionRatio >= .52) {
        activeClipKey = clip.key;
        if (card.dataset.loaded !== '1') {
          buildPlayer(clip, $('.player-host', card)); card.dataset.loaded = '1';
        }
      } else if (!entry.isIntersecting && card.dataset.loaded === '1') {
        const stage = $('.player-host', card);
        stage.innerHTML = '';
        card.dataset.loaded = '0';
      }
    });
  }, { root: $('#feed'), threshold: [0, .52, .85] });
  $$('.clip-card', $('#feed')).forEach(card => feedObserver.observe(card));
}
function cardElement(clip) {
  const node = $('#clipTemplate').content.firstElementChild.cloneNode(true);
  node.dataset.clipKey = clip.key; node.dataset.loaded = '0';
  const platform = SOURCES[clip.source] || SOURCES.direct;
  $('.platform-label', node).textContent = platform.label;
  $('.creator-img', node).src = getClipThumb(clip);
  $('.creator-img', node).onerror = e => { e.currentTarget.src = 'assets/rumk.svg'; };
  $('.creator-name', node).textContent = clip.author || sourceName(clip.source);
  $('.creator-meta', node).textContent = clip.isUser ? 'رابط أُضيف إلى Rumk' : (clip.published ? shortDate(clip.published) : 'مقترح لك');
  $('.clip-title', node).textContent = clip.title || 'مقطع بدون عنوان';
  $('.clip-description', node).textContent = clip.description || ('من ' + sourceName(clip.source) + ' · ' + (state.topic || 'مقاطع قصيرة'));
  const like = $('.like-action', node), save = $('.save-action', node), follow = $('.follow-pill', node);
  like.classList.toggle('liked', !!state.likes[clip.key]); like.querySelector('small').textContent = state.likes[clip.key] ? 'أعجبني' : 'إعجاب';
  save.classList.toggle('saved', !!state.saves[clip.key]); save.querySelector('small').textContent = state.saves[clip.key] ? 'محفوظ' : 'حفظ';
  follow.classList.toggle('active', !!state.follows[clip.author]); follow.textContent = state.follows[clip.author] ? 'تتابع' : 'متابعة';
  like.onclick = () => { state.likes[clip.key] = !state.likes[clip.key]; if (!state.likes[clip.key]) delete state.likes[clip.key]; persist(); like.classList.toggle('liked', !!state.likes[clip.key]); like.querySelector('small').textContent = state.likes[clip.key] ? 'أعجبني' : 'إعجاب'; };
  save.onclick = () => {
    if (state.saves[clip.key]) { delete state.saves[clip.key]; toast('أُزيل من المحفوظات'); }
    else { state.saves[clip.key] = clip; toast('تم حفظ المقطع على جهازك'); }
    persist(); save.classList.toggle('saved', !!state.saves[clip.key]); save.querySelector('small').textContent = state.saves[clip.key] ? 'محفوظ' : 'حفظ';
  };
  follow.onclick = () => { state.follows[clip.author] = !state.follows[clip.author]; if (!state.follows[clip.author]) delete state.follows[clip.author]; persist(); follow.classList.toggle('active', !!state.follows[clip.author]); follow.textContent = state.follows[clip.author] ? 'تتابع' : 'متابعة'; toast('المتابعة محفوظة محليًا على هذا الجهاز'); };
  $('.share-action', node).onclick = async () => {
    const shareData = { title: 'Rumk · ' + clip.title, text: clip.title, url: clip.url };
    try { if (navigator.share) await navigator.share(shareData); else if (navigator.clipboard) { await navigator.clipboard.writeText(clip.url); toast('تم نسخ رابط المقطع'); } else openUrl(clip.url); }
    catch (err) { if (err?.name !== 'AbortError') toast('تعذر المشاركة من هذا الجهاز'); }
  };
  $('.open-original', node).onclick = () => openUrl(clip.url);
  return node;
}
function shortDate(date) {
  try { const d = new Date(date); if (Number.isNaN(+d)) return 'مقطع عام'; return new Intl.DateTimeFormat('ar-SA', { year: undefined, month: 'short', day: 'numeric' }).format(d); }
  catch (_) { return 'مقطع عام'; }
}
function clipsForCurrentSource() {
  const source = state.source;
  const local = state.userClips.filter(c => c.source === source).slice().reverse();
  if (source === 'youtube') return [...local, ...feedClips.filter(c => !c.isUser)];
  return local;
}
function renderFeed(clips) {
  feedClips = clips.slice();
  const feed = $('#feed'); feed.innerHTML = '';
  if (!feedClips.length) return false;
  feedClips.forEach(clip => feed.appendChild(cardElement(clip)));
  addLazyLoading();
  return true;
}
async function loadFeed({ quiet = false, order = currentOrder } = {}) {
  const requestSequence = ++loadSequence;
  currentOrder = order;
  $$('.feed-tab').forEach(button => button.classList.toggle('active', (button.dataset.feed === 'latest') === (order === 'date')));
  state.topic = ($('#topicInput')?.value || state.topic || DEFAULTS.topic).trim() || DEFAULTS.topic;
  $('#sourceBadge').textContent = sourceName(state.source);
  $('#topicLabel').textContent = state.topic;
  persist();
  if (state.source !== 'youtube') {
    const localClips = state.userClips.filter(c => c.source === state.source || c.source === 'direct').slice().reverse();
    if (localClips.length) { renderFeed(localClips); return; }
    showStateCard({ icon: (SOURCES[state.source] || SOURCES.direct).icon,
      title: 'خلّ مقاطع ' + sourceName(state.source) + ' تظهر هنا',
      message: 'ابحث عن فكرتك من الزر أدناه، ثم انسخ رابط مقطع عام وأضفه بزر ＋. بعض المنصات لا تسمح بالبحث العام أو التضمين التلقائي دون حساب مطوّر أو موافقة.',
      primary: { label: 'بحث في ' + sourceName(state.source) + ' ↗', onClick: () => openUrl(sourceSearchUrl(state.source, state.topic)) },
      secondary: { label: 'إضافة رابط مقطع ＋', onClick: () => showDialog('addDialog') } });
    return;
  }
  if (!quiet) showStateCard({ title: 'نبحث لك في YouTube…', message: 'نحمّل مقاطع مرتبطة بـ «' + state.topic + '».', loading: true });
  try {
    const results = await searchYoutube(state.topic, order);
    if (requestSequence !== loadSequence) return;
    if (!results.length) {
      showStateCard({ icon: '⌕', title: 'ما حصلنا مقاطع لهذا البحث', message: 'جرّب موضوعًا آخر أو أضف رابط مقطع بنفسك.',
        primary: { label: 'تغيير البحث', onClick: () => { $('#topicInput').value = state.topic; setScreen('search'); $('#topicInput').focus(); } },
        secondary: { label: 'إضافة رابط ＋', onClick: () => showDialog('addDialog') } });
      return;
    }
    const custom = state.userClips.filter(c => c.source === 'youtube' || c.source === 'direct').slice().reverse();
    renderFeed(order === 'date' ? [...custom, ...results] : [...custom, ...results]);
  } catch (err) {
    if (requestSequence !== loadSequence) return;
    const detail = err?.message || 'تحقق من اتصال الإنترنت وحاول مرة أخرى.';
    showStateCard({ icon: '⌁', title: 'تعذر جلب مقاطع YouTube', message: detail + (window.RumkNative ? '' : ' في المتصفح قد تحتاج إلى مفتاح YouTube API في الإعدادات بسبب قيود الاتصال بين المواقع.'),
      primary: { label: 'إعادة المحاولة', onClick: () => loadFeed() },
      secondary: { label: 'الإعدادات', onClick: () => showDialog('settingsDialog') } });
  }
}
function renderSaved() {
  const list = $('#savedList'); list.innerHTML = '';
  const saved = Object.values(state.saves).filter(v => v && typeof v === 'object').reverse();
  if (!saved.length) {
    list.innerHTML = '<div class="state-card" style="position:relative;inset:auto;min-height:235px"><div class="empty-orb">♡</div><h2>لسه ما حفظت مقاطع</h2><p>اضغط على علامة الحفظ في أي مقطع عشان يطلع هنا.</p></div>'; return;
  }
  saved.forEach(clip => {
    const row = document.createElement('div'); row.className = 'saved-item';
    const img = document.createElement('img'); img.className = 'saved-thumb'; img.src = getClipThumb(clip); img.alt = ''; img.onerror = () => { img.src = 'assets/rumk.svg'; };
    const meta = document.createElement('div'); const b = document.createElement('b'); b.textContent = clip.title || 'مقطع محفوظ'; const s = document.createElement('small'); s.textContent = sourceName(clip.source) + ' · ' + (clip.author || 'Rumk'); meta.append(b, s);
    const open = document.createElement('button'); open.textContent = 'فتح ↗'; open.onclick = () => openUrl(clip.url);
    const del = document.createElement('button'); del.textContent = 'حذف'; del.onclick = () => { delete state.saves[clip.key]; persist(); renderSaved(); toast('تم حذف المقطع من المحفوظات'); };
    row.append(img, meta, open, del); list.appendChild(row);
  });
}
function refreshProfile() { $('#profileNameLabel').textContent = state.profileName; }
function syncSettingsUI() {
  $('#settingsSource').value = state.source; $('#sourceSelect').value = state.source;
  $('#settingsTopic').value = state.topic; $('#topicInput').value = state.topic;
  $('#apiKey').value = state.apiKey; $('#autoplaySetting').checked = !!state.autoplay;
  $('#sourceBadge').textContent = sourceName(state.source); $('#topicLabel').textContent = state.topic;
}
function chooseSource(value, doLoad = false) {
  state.source = SOURCES[value] ? value : 'youtube'; persist();
  $('#sourceSelect').value = state.source; $('#settingsSource').value = state.source;
  $('#sourceBadge').textContent = sourceName(state.source);
  if (doLoad) { setScreen('feed'); loadFeed(); }
}
function renderSourceGrid() {
  $('#sourceGrid').innerHTML = '';
  Object.entries(SOURCES).filter(([key]) => key !== 'direct').forEach(([key, info]) => {
    const button = document.createElement('button'); button.className = 'source-tile';
    const icon = document.createElement('span'); icon.className = 'source-icon'; icon.textContent = info.icon; icon.style.color = info.color;
    const content = document.createElement('div'); const name = document.createElement('b'); name.textContent = info.ar; const note = document.createElement('small'); note.textContent = key === 'youtube' ? 'بحث تلقائي داخل Rumk' : 'ابحث ثم أضف رابط المقطع'; content.append(name, note); button.append(icon, content);
    button.onclick = () => { chooseSource(key); setScreen('search'); $('#sourceSelect').value = key; $('#topicInput').value = state.topic; toast('اختر الموضوع ثم اضغط بحث'); };
    $('#sourceGrid').appendChild(button);
  });
}
function addClipFromForm(event) {
  event.preventDefault();
  const url = $('#clipUrl').value.trim(), caption = $('#clipCaption').value.trim();
  try {
    const clip = makeUserClip(url, caption);
    state.userClips = state.userClips.filter(c => c.url !== clip.url);
    state.userClips.push(clip); state.source = clip.source === 'direct' ? state.source : clip.source;
    persist(); closeDialog('addDialog'); $('#clipUrl').value = ''; $('#clipCaption').value = '';
    syncSettingsUI(); setScreen('feed'); loadFeed(); toast('تمت إضافة الرابط إلى Rumk');
  } catch (err) { toast(err.message || 'تحقق من رابط المقطع'); }
}
function saveSettings(event) {
  event.preventDefault();
  state.source = $('#settingsSource').value; state.topic = $('#settingsTopic').value.trim() || DEFAULTS.topic;
  state.apiKey = $('#apiKey').value.trim(); state.autoplay = $('#autoplaySetting').checked;
  persist(); syncSettingsUI(); closeDialog('settingsDialog'); setScreen('feed'); loadFeed(); toast('تم حفظ الإعدادات');
}
function init() {
  syncSettingsUI(); renderSourceGrid(); $('#yearLabel').textContent = new Date().getFullYear();
  $('#homeBtn').onclick = () => { setScreen('feed'); loadFeed(); };
  $$('.feed-tab').forEach(button => button.addEventListener('click', () => { currentOrder = button.dataset.feed === 'latest' ? 'date' : 'relevance'; setScreen('feed'); loadFeed({ order: currentOrder }); }));
  $('#settingsBtn').onclick = () => { syncSettingsUI(); showDialog('settingsDialog'); };
  $('#aboutSettingsBtn').onclick = () => showDialog('settingsDialog');
  $('#topicButton').onclick = () => { setScreen('search'); $('#topicInput').value = state.topic; setTimeout(() => $('#topicInput').focus(), 80); };
  $('#searchForm').addEventListener('submit', event => {
    event.preventDefault(); const source = $('#sourceSelect').value, topic = $('#topicInput').value.trim() || DEFAULTS.topic;
    state.topic = topic; currentOrder = 'relevance'; chooseSource(source); persist();
    setScreen('feed'); loadFeed({ order: currentOrder });
  });
  $('#openSourceSearch').onclick = () => {
    state.topic = $('#topicInput').value.trim() || state.topic; state.source = $('#sourceSelect').value; persist();
    openUrl(sourceSearchUrl(state.source, state.topic));
    toast('بعد اختيار مقطع، انسخ رابطه وأضفه من زر ＋ في Rumk');
  };
  $('#sourceSelect').onchange = () => { chooseSource($('#sourceSelect').value); };
  $('#settingsForm').addEventListener('submit', saveSettings);
  $('#addLinkBtn').onclick = () => showDialog('addDialog'); $('#addForm').addEventListener('submit', addClipFromForm);
  $('#profileForm').addEventListener('submit', event => { event.preventDefault(); state.profileName = $('#profileNameInput').value.trim() || 'مجد الخميس'; state.profileHandle = $('#profileHandleInput').value.trim() || '@mk442'; persist(); closeDialog('editProfileDialog'); refreshProfile(); toast('تم حفظ بيانات الحساب محليًا'); });
  $('#editProfileBtn').onclick = () => { $('#profileNameInput').value = state.profileName; $('#profileHandleInput').value = state.profileHandle; showDialog('editProfileDialog'); };
  $('#copyCodeBtn').onclick = async () => { try { await navigator.clipboard.writeText('MK442'); toast('تم نسخ كود المبدع MK442'); } catch (_) { toast('كود المبدع: MK442'); } };
  $$('.nav-button').forEach(button => button.addEventListener('click', () => setScreen(button.dataset.screen)));
  $$('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
  $('#settingsSource').onchange = () => { $('#sourceBadge').textContent = sourceName($('#settingsSource').value); };
  $('#topicInput').value = state.topic; $('#profileNameInput').value = state.profileName; $('#profileHandleInput').value = state.profileHandle;
  loadFeed();
}
init();
