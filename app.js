'use strict';
/* וינה בחג המולד: אפליקציה סטטית, הכל נשמר ב-localStorage */

const LS_PLACES = 'vienna.places.v1';
const LS_META = 'vienna.meta.v1';
const LS_UI = 'vienna.ui.v1';
const LS_WX = 'vienna.weather.v1';

const VIENNA = { name: 'וינה', lat: 48.2082, lng: 16.3738 };
const TZ = 'Europe/Vienna';

const CAT_ORDER = ['shops', 'restaurants', 'cafes', 'museums', 'bars', 'christmas', 'misc'];
const CAT_DEFAULT = {
  restaurants: 'מסעדות', cafes: 'בתי קפה', museums: 'מוזיאונים', shops: 'חנויות',
  bars: 'ברים', christmas: 'חג המולד', misc: 'שונות'
};
const CAT_SHORT = { christmas: 'חג המולד', misc: 'שונות' };
const CAT_ICON = { shops: '🛍️', restaurants: '🍽️', cafes: '☕', museums: '🏛️', bars: '🍷', christmas: '🎄', misc: '✨' };
const CAT_COLOR = {
  shops: '#7b4fa0', restaurants: '#c0392b', cafes: '#8a5a2b', museums: '#2f5f8f',
  bars: '#b8327a', christmas: '#1f7a45', misc: '#c98a1a'
};

let state = {
  trip: { weather_start: '2026-12-20', start: '2026-12-21', end: '2026-12-30', away: ['2026-12-24', '2026-12-25', '2026-12-26'] },
  categories: { ...CAT_DEFAULT },
  places: [],
};
let meta = { mountain: null }; // {name, lat, lng}
let ui = { tab: 'all', origin: 'all', hideVisited: false, q: '' };
let editingId = null;
let pendingImport = null;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lsGet(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('לא הצלחתי לשמור במכשיר'); } }
function savePlaces() { lsSet(LS_PLACES, { trip: state.trip, categories: state.categories, places: state.places }); }
function saveUi() { lsSet(LS_UI, ui); }

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

function mapsUrl(p) {
  if (p.gmaps_url) return p.gmaps_url;
  const q = [p.name, p.address && p.address !== 'Wien' ? p.address : 'Wien'].filter(Boolean).join(' ');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}
const hasGeo = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

/* ---------- load ---------- */
async function loadSeed() {
  const r = await fetch('data.json', { cache: 'no-cache' });
  return r.json();
}
function applyData(d) {
  if (d.trip) state.trip = { ...state.trip, ...d.trip };
  state.categories = { ...CAT_DEFAULT, ...(d.categories || {}) };
  state.places = (d.places || []).map(normalize);
}
function normalize(p) {
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
  return {
    id: p.id ?? null, name: String(p.name || '').trim(), category: CAT_ORDER.includes(p.category) ? p.category : 'misc',
    address: p.address || '', lat: num(p.lat), lng: num(p.lng), hours: p.hours || '',
    christmas_note: p.christmas_note || '', note: p.note || '', source: p.source || 'app',
    gmaps_url: p.gmaps_url || '', visited: !!p.visited, suggested: !!p.suggested, favorite: !!p.favorite,
  };
}
function maxId(list) { return list.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0); }
// מקומות חדשים שנוספו ל-data.json אחרי ההתקנה מתווספים אוטומטית, בלי לגעת בשינויים שלכם
async function syncSeed() {
  let seed; try { seed = await loadSeed(); } catch { return; }
  if (seed.trip) state.trip = { ...state.trip, ...seed.trip };
  const seen = meta.seedMax ?? 122;
  const names = new Set(state.places.map((p) => p.name.trim().toLowerCase()));
  const fresh = (seed.places || []).filter((p) => Number(p.id) > seen && !names.has(String(p.name).trim().toLowerCase())).map(normalize);
  meta.seedMax = Math.max(seen, maxId(seed.places || [])); lsSet(LS_META, meta);
  if (!fresh.length) { savePlaces(); return; }
  const ids = new Set(state.places.map((p) => p.id));
  fresh.forEach((p) => { if (ids.has(p.id)) p.id = nextId(); state.places.push(p); ids.add(p.id); });
  savePlaces(); markersDirty = true; buildTabs(); refreshView();
  toast(`נוספו ${fresh.length} מקומות חדשים לרשימה 🎁`);
}
function nextId() { return state.places.reduce((m, p) => Math.max(m, Number(p.id) || 0), 0) + 1; }

async function init() {
  meta = lsGet(LS_META, meta);
  ui = { ...ui, ...lsGet(LS_UI, {}) };
  const saved = lsGet(LS_PLACES, null);
  if (saved && Array.isArray(saved.places)) applyData(saved);
  else {
    try { const seed = await loadSeed(); applyData(seed); meta.seedMax = maxId(seed.places); lsSet(LS_META, meta); savePlaces(); }
    catch { toast('לא הצלחתי לטעון את הרשימה. נסו שוב כשיש אינטרנט'); }
  }
  buildTabs(); buildCatSelect(); bindUi(); countdown();
  $('#q').value = ui.q; $('#hideVisited').checked = ui.hideVisited;
  setOrigin(ui.origin, false);
  showTab(ui.tab);
  if (saved) syncSeed();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- header ---------- */
function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function todayStr() { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); }
function countdown() {
  const t = todayStr(), { start, end } = state.trip;
  let s;
  const total = dayDiff(start, end) + 1;
  if (t < start) { const n = dayDiff(t, start); s = n === 1 ? 'ממריאים מחר! ✈️' : `עוד ${n} ימים לטיסה · 21-30.12`; }
  else if (t <= end) s = `יום ${dayDiff(start, t) + 1} מתוך ${total} · תהנו! 🎅`;
  else s = 'הטיול הסתיים. היה כיף? ❄️';
  $('#countdown').textContent = s;
}

/* ---------- tabs ---------- */
function tabsDef() {
  return [
    { id: 'all', label: 'הכל', icon: '📋' },
    { id: 'fav', label: 'מועדפים', icon: '❤️' },
    ...CAT_ORDER.map((c) => ({ id: c, label: CAT_SHORT[c] || state.categories[c] || CAT_DEFAULT[c], icon: CAT_ICON[c] })),
    { id: 'map', label: 'מפה', icon: '🗺️' },
    { id: 'weather', label: 'מזג אוויר', icon: '❄️' },
  ];
}
function buildTabs() {
  $('#tabs').innerHTML = tabsDef().map((t) => {
    const n = CAT_ORDER.includes(t.id) ? state.places.filter((p) => p.category === t.id).length : t.id === 'all' ? state.places.length : t.id === 'fav' ? state.places.filter((p) => p.favorite).length : '';
    return `<button class="tab" role="tab" data-tab="${t.id}">${t.icon} ${esc(t.label)}${n !== '' ? `<span class="n">${n}</span>` : ''}</button>`;
  }).join('');
  $('#tabs').querySelectorAll('.tab').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  markTab();
}
function markTab() {
  $('#tabs').querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === ui.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on);
    if (on) b.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });
}
function showTab(id) {
  if (!tabsDef().some((t) => t.id === id)) id = 'all';
  ui.tab = id; saveUi(); markTab();
  $('#view-list').hidden = id === 'map' || id === 'weather';
  $('#view-map').hidden = id !== 'map';
  $('#view-weather').hidden = id !== 'weather';
  $('#btnAdd').hidden = id === 'weather' || id === 'map';
  if (id === 'map') showMap();
  else if (id === 'weather') showWeather();
  else renderList();
  window.scrollTo({ top: 0 });
}

/* ---------- list ---------- */
function filtered() {
  const q = ui.q.trim().toLowerCase();
  return state.places.filter((p) => {
    if (ui.tab === 'fav') { if (!p.favorite) return false; }
    else if (ui.tab !== 'all' && p.category !== ui.tab) return false;
    if (ui.origin === 'mine' && p.suggested) return false;
    if (ui.origin === 'suggested' && !p.suggested) return false;
    if (ui.hideVisited && p.visited) return false;
    if (q && ![p.name, p.address, p.note, p.hours, p.christmas_note].join(' ').toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (a.visited - b.visited) || (a.suggested - b.suggested) || CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
}
function renderList() {
  const list = filtered();
  const visited = list.filter((p) => p.visited).length;
  $('#count').textContent = `${list.length} מקומות${visited ? ` · ${visited} ביקרנו` : ''}`;
  if (!list.length) { $('#cards').innerHTML = `<li class="empty">אין כאן מקומות כרגע 🎁<br>אפשר להוסיף עם כפתור הפלוס</li>`; return; }
  $('#cards').innerHTML = list.map(cardHtml).join('');
}
function cardHtml(p) {
  const catLabel = state.categories[p.category] || CAT_DEFAULT[p.category];
  return `<li class="card ${p.suggested ? 'suggested' : ''} ${p.favorite ? 'favorite' : ''} ${p.visited ? 'visited' : ''}" style="--cat:${CAT_COLOR[p.category]}" data-id="${p.id}">
    <div class="card-head">
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="badges">
          ${ui.tab === 'all' || ui.tab === 'fav' ? `<span class="badge">${CAT_ICON[p.category]} ${esc(catLabel)}</span>` : ''}
          ${p.suggested ? '<span class="badge sug">✨ הצעה</span>' : ''}
          ${!hasGeo(p) ? '<span class="badge nogeo">אין מיקום במפה</span>' : ''}
        </div>
      </div>
      <div class="head-btns"><button class="fav ${p.favorite ? 'on' : ''}" data-act="fav" aria-label="${p.favorite ? 'הסרה ממועדפים' : 'הוספה למועדפים'}">${p.favorite ? '❤️' : '🤍'}</button><button class="edit" data-act="edit" aria-label="עריכה">✏️</button></div>
    </div>
    ${p.address ? `<p class="meta">📍 ${esc(p.address)}</p>` : ''}
    ${p.hours ? `<p class="meta">🕒 ${esc(p.hours)}</p>` : ''}
    ${p.christmas_note ? `<p class="xmas">🎄 ${esc(p.christmas_note)}</p>` : ''}
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
    <div class="card-actions">
      <button class="visit ${p.visited ? 'on' : ''}" data-act="visit">${p.visited ? '✓ ביקרנו' : 'ביקרנו?'}</button>
      <a class="btn small" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">ניווט ב-Google Maps</a>
      ${hasGeo(p) ? '<button class="btn ghost small" data-act="onmap">במפה</button>' : ''}
    </div>
  </li>`;
}
function onCardClick(e) {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  const p = state.places.find((x) => String(x.id) === id); if (!p) return;
  if (btn.dataset.act === 'fav') { p.favorite = !p.favorite; savePlaces(); buildTabs(); renderList(); markersDirty = true; toast(p.favorite ? 'נוסף למועדפים ❤️' : 'הוסר מהמועדפים'); }
  if (btn.dataset.act === 'visit') { p.visited = !p.visited; savePlaces(); renderList(); markersDirty = true; }
  if (btn.dataset.act === 'edit') openEdit(p);
  if (btn.dataset.act === 'onmap') { focusOnMap = p.id; showTab('map'); }
}
function setOrigin(v, render = true) {
  ui.origin = v; saveUi();
  $('#originSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (render) renderList();
}

/* ---------- edit ---------- */
function buildCatSelect() {
  $('#selCat').innerHTML = CAT_ORDER.map((c) => `<option value="${c}">${CAT_ICON[c]} ${esc(state.categories[c] || CAT_DEFAULT[c])}</option>`).join('');
}
function openEdit(p) {
  const f = $('#formEdit'); f.reset(); $('#geoMsg').textContent = '';
  editingId = p ? p.id : null;
  $('#editTitle').textContent = p ? 'עריכת מקום' : 'מקום חדש';
  $('#btnDelete').hidden = !p;
  const v = p || { category: CAT_ORDER.includes(ui.tab) ? ui.tab : 'restaurants', suggested: false, visited: false };
  for (const k of ['name', 'category', 'address', 'lat', 'lng', 'hours', 'christmas_note', 'note', 'gmaps_url']) f.elements[k].value = v[k] ?? '';
  f.elements.suggested.checked = !!v.suggested; f.elements.favorite.checked = !!v.favorite; f.elements.visited.checked = !!v.visited;
  $('#dlgEdit').showModal();
}
function saveEdit(e) {
  e.preventDefault();
  const f = $('#formEdit'), el = f.elements;
  const data = normalize({
    name: el.name.value, category: el.category.value, address: el.address.value.trim(),
    lat: el.lat.value.trim().replace(',', '.'), lng: el.lng.value.trim().replace(',', '.'),
    hours: el.hours.value.trim(), christmas_note: el.christmas_note.value.trim(), note: el.note.value.trim(),
    gmaps_url: el.gmaps_url.value.trim(), suggested: el.suggested.checked, visited: el.visited.checked, favorite: el.favorite.checked,
  });
  if (!data.name) { el.name.focus(); return; }
  if (editingId !== null) {
    const p = state.places.find((x) => x.id === editingId);
    Object.assign(p, { ...data, id: p.id, source: p.source });
    toast('נשמר ✓');
  } else {
    state.places.push({ ...data, id: nextId(), source: 'app' });
    toast('נוסף לרשימה 🎁');
  }
  savePlaces(); markersDirty = true; $('#dlgEdit').close(); buildTabs(); refreshView();
}
function deleteEdit() {
  const btn = $('#btnDelete');
  if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'בטוח? לחצו שוב'; setTimeout(() => { delete btn.dataset.confirm; btn.textContent = 'מחיקה'; }, 3000); return; }
  delete btn.dataset.confirm; btn.textContent = 'מחיקה';
  state.places = state.places.filter((x) => x.id !== editingId);
  savePlaces(); markersDirty = true; $('#dlgEdit').close(); buildTabs(); refreshView(); toast('נמחק');
}
async function geocodeAddress() {
  const el = $('#formEdit').elements;
  const q = [el.name.value, el.address.value].filter(Boolean).join(', ');
  const tryQ = [el.address.value && el.address.value !== 'Wien' ? el.address.value : null, q].filter(Boolean);
  $('#geoMsg').textContent = 'מחפש...';
  for (const query of tryQ) {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=at&q=' + encodeURIComponent(query.includes('Wien') || query.includes('Vienna') ? query : query + ', Wien'));
      const j = await r.json();
      if (j[0]) { el.lat.value = (+j[0].lat).toFixed(5); el.lng.value = (+j[0].lon).toFixed(5); $('#geoMsg').textContent = '✓ נמצא: ' + j[0].display_name.split(',').slice(0, 3).join(','); return; }
    } catch { $('#geoMsg').textContent = 'אין חיבור לאינטרנט'; return; }
  }
  $('#geoMsg').textContent = 'לא נמצא. אפשר להעתיק קואורדינטות מ-Google Maps (לחיצה ארוכה על המקום)';
}
function refreshView() { if (ui.tab === 'map') showMap(); else if (ui.tab !== 'weather') renderList(); }

/* ---------- map ---------- */
let map, markerLayer, markersDirty = true, focusOnMap = null;
let mapHidden = new Set();
function showMap() {
  if (typeof L === 'undefined') { $('#map').innerHTML = '<p class="empty">המפה צריכה חיבור לאינטרנט בפעם הראשונה</p>'; return; }
  if (!map) {
    map = L.map('map', { zoomControl: true }).setView([VIENNA.lat, VIENNA.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    renderLegend();
    if (navigator.geolocation) {
      const loc = L.control({ position: 'topleft' });
      loc.onAdd = () => { const b = L.DomUtil.create('button', 'loc-btn'); b.textContent = '📍 איפה אני';
        b.onclick = (e) => { e.stopPropagation(); navigator.geolocation.getCurrentPosition((pos) => {
          const ll = [pos.coords.latitude, pos.coords.longitude];
          if (map._me) map._me.remove(); map._me = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map); map.setView(ll, 15);
        }, () => toast('אין הרשאת מיקום')); }; return b; };
      loc.addTo(map);
    }
  }
  setTimeout(() => map.invalidateSize(), 50);
  if (markersDirty) drawMarkers();
  if (focusOnMap !== null) {
    const m = markerLayer.getLayers().find((x) => x.options.pid === focusOnMap);
    if (m) setTimeout(() => { map.setView(m.getLatLng(), 16); m.openPopup(); }, 120);
    focusOnMap = null;
  }
}
function drawMarkers() {
  markerLayer.clearLayers(); markersDirty = false;
  const withGeo = state.places.filter(hasGeo);
  withGeo.filter((p) => !mapHidden.has(p.category)).forEach((p) => {
    const icon = L.divIcon({ className: '', html: `<div class="pin ${p.suggested ? 'sug' : ''} ${p.visited ? 'vis' : ''}" style="background:${CAT_COLOR[p.category]}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22] });
    L.marker([p.lat, p.lng], { icon, pid: p.id }).addTo(markerLayer).bindPopup(
      `<b>${CAT_ICON[p.category]} ${esc(p.name)}</b>${p.favorite ? ' ❤️' : ''}${p.suggested ? ' ✨' : ''}${p.visited ? ' ✓' : ''}<br>${esc(p.address)}${p.hours ? `<br>🕒 ${esc(p.hours)}` : ''}${p.christmas_note ? `<br>🎄 ${esc(p.christmas_note)}` : ''}<br><a href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">ניווט ←</a>`
    );
  });
  const missing = state.places.length - withGeo.length;
  $('#mapNote').textContent = `${withGeo.length} מקומות במפה. ${missing ? `ל-${missing} מקומות אין עדיין קואורדינטות (אפשר להוסיף בעריכה). ` : ''}סיכה מקווקוות = הצעה, חיוורת = ביקרנו. לחיצה על המקרא מסתירה קטגוריה.`;
}
function renderLegend() {
  $('#legend').innerHTML = CAT_ORDER.map((c) => `<span data-c="${c}" style="cursor:pointer;${mapHidden.has(c) ? 'opacity:.35' : ''}"><i class="dot" style="background:${CAT_COLOR[c]}"></i>${esc(CAT_SHORT[c] || state.categories[c])}</span>`).join('');
  $('#legend').querySelectorAll('span').forEach((s) => (s.onclick = () => {
    const c = s.dataset.c; mapHidden.has(c) ? mapHidden.delete(c) : mapHidden.add(c); renderLegend(); drawMarkers();
  }));
}

/* ---------- weather ---------- */
const WMO = {
  0: ['☀️', 'בהיר'], 1: ['🌤️', 'כמעט בהיר'], 2: ['⛅', 'מעונן חלקית'], 3: ['☁️', 'מעונן'],
  45: ['🌫️', 'ערפל'], 48: ['🌫️', 'ערפל קפוא'], 51: ['🌦️', 'טפטוף קל'], 53: ['🌦️', 'טפטוף'], 55: ['🌧️', 'טפטוף חזק'],
  56: ['🌧️', 'טפטוף קופא'], 57: ['🌧️', 'טפטוף קופא'], 61: ['🌧️', 'גשם קל'], 63: ['🌧️', 'גשם'], 65: ['🌧️', 'גשם חזק'],
  66: ['🧊', 'גשם קופא'], 67: ['🧊', 'גשם קופא'], 71: ['🌨️', 'שלג קל'], 73: ['🌨️', 'שלג'], 75: ['❄️', 'שלג כבד'],
  77: ['🌨️', 'גרגירי שלג'], 80: ['🌦️', 'ממטרים'], 81: ['🌧️', 'ממטרים'], 82: ['⛈️', 'ממטרים חזקים'],
  85: ['🌨️', 'ממטרי שלג'], 86: ['❄️', 'ממטרי שלג כבדים'], 95: ['⛈️', 'סופת רעמים'], 96: ['⛈️', 'סופה וברד'], 99: ['⛈️', 'סופה וברד'],
};
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max';

function wxStart() { const w = state.trip.weather_start || state.trip.start; return w < state.trip.start ? w : state.trip.start; }
function tripDays() {
  const out = []; let d = new Date(wxStart() + 'T12:00:00Z'); const end = new Date(state.trip.end + 'T12:00:00Z');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
function locFor(day) { return state.trip.away.includes(day) && meta.mountain ? meta.mountain : VIENNA; }
function addDays(s, n) { return new Date(Date.parse(s + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

async function fetchDaily(base, loc, start, end, extra = '') {
  const url = `${base}?latitude=${loc.lat}&longitude=${loc.lng}&daily=${DAILY}${extra}&timezone=${encodeURIComponent(TZ)}&start_date=${start}&end_date=${end}`;
  const r = await fetch(url); if (!r.ok) throw new Error('wx ' + r.status);
  const j = await r.json(); const d = j.daily; const out = {};
  d.time.forEach((t, i) => { out[t] = Object.fromEntries(Object.keys(d).filter((k) => k !== 'time').map((k) => [k, d[k][i]])); });
  return out;
}

async function loadWeather() {
  const days = tripDays(), today = todayStr(), horizon = addDays(today, 15), past = addDays(today, -60);
  const groups = new Map();
  days.forEach((d) => { const l = locFor(d); const k = `${l.lat},${l.lng}`; if (!groups.has(k)) groups.set(k, { loc: l, days: [] }); groups.get(k).days.push(d); });
  const result = {};
  for (const { loc, days: ds } of groups.values()) {
    const fc = ds.filter((d) => d >= past && d <= horizon);
    const rest = ds.filter((d) => !fc.includes(d));
    if (fc.length) {
      const data = await fetchDaily('https://api.open-meteo.com/v1/forecast', loc, fc[0], fc[fc.length - 1], ',precipitation_probability_max');
      fc.forEach((d) => data[d] && (result[d] = { ...data[d], kind: 'forecast', loc: loc.name }));
    }
    if (rest.length) { // עוד אין תחזית: מציגים את אותם תאריכים בשנה שעברה כהערכה
      const shift = (s) => (Number(s.slice(0, 4)) - 1) + s.slice(4);
      const data = await fetchDaily('https://archive-api.open-meteo.com/v1/archive', loc, shift(rest[0]), shift(rest[rest.length - 1]));
      rest.forEach((d) => data[shift(d)] && (result[d] = { ...data[shift(d)], kind: 'lastyear', loc: loc.name }));
    }
  }
  return result;
}

function advice(w) {
  // מותאם למי שקר לו בקלות: מחושב לפי הטמפ' המורגשת, עם מרווח ביטחון של 2 מעלות
  const day = w.apparent_temperature_max, night = w.apparent_temperature_min;
  const eff = (day * 0.6 + night * 0.4) - 2;
  const wind = w.wind_speed_10m_max || 0, gust = w.wind_gusts_10m_max || 0;
  const rain = (w.precipitation_sum || 0) - (w.snowfall_sum || 0) * 0.7;
  const pop = w.precipitation_probability_max;
  const snow = (w.snowfall_sum || 0) > 0.2 || [71, 73, 75, 77, 85, 86].includes(w.weather_code);
  let level, items;
  if (eff >= 10) { level = 'קריר'; items = ['חולצה תרמית דקה (אפשר לוותר)', 'סוודר או פליז', 'מעיל קל או ג׳קט', 'צעיף דק']; }
  else if (eff >= 4) { level = 'קר'; items = ['חולצה תרמית', 'סוודר צמר או פליז', 'מעיל חם', 'צעיף, וכפפות לערב']; }
  else if (eff >= -1) { level = 'קר מאוד'; items = ['תרמי עליון + תחתון', 'שכבת ביניים חמה (צמר/פליז)', 'מעיל פוך', 'כובע צמר, כפפות וצעיף', 'גרבי צמר עבות']; }
  else if (eff >= -6) { level = 'קפוא'; items = ['תרמי עליון + תחתון עבה', 'שתי שכבות ביניים (פליז + סוודר)', 'מעיל פוך ארוך', 'כובע שמכסה אוזניים, כפפות חמות, צעיף/באף', 'גרבי צמר + נעליים חמות', 'מחממי ידיים לכיס']; }
  else { level = 'קפוא מאוד'; items = ['כל השכבות: תרמי כפול אם יש', 'פוך ארוך + באף על הפנים', 'כפפות כפולות (דקות בפנים)', 'שתי שכבות גרביים + מגפיים', 'מחממי ידיים ורגליים', 'לתכנן הפסקות חימום בבתי קפה']; }
  const extra = [];
  if (wind >= 25 || gust >= 45) extra.push(`רוח חזקה (עד ${Math.round(gust || wind)} קמ״ש): שכבה חיצונית אטומה לרוח וכובע שמכסה אוזניים`);
  else if (wind >= 15) extra.push('קצת רוח: צעיף צמוד לצוואר');
  if (snow) extra.push('שלג: נעליים אטומות למים עם סוליה שלא מחליקה');
  if (rain >= 1 || (pop ?? 0) >= 50) extra.push(`סיכוי לגשם${pop != null ? ` ${pop}%` : ''}: מעיל עמיד למים או מטרייה מתקפלת, ונעליים שלא נרטבות`);
  if (night <= day - 4) extra.push(`בערב (שווקי חג המולד) מרגיש כמו ${Math.round(night)}°: להוסיף שכבה או מחממי ידיים`);
  return { level, items, extra };
}
function fmtDay(s) {
  const d = new Date(s + 'T12:00:00Z');
  return new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(d);
}
function renderWeather(data, fetchedAt, stale) {
  const days = tripDays(), today = todayStr();
  const anyLastYear = days.some((d) => data[d]?.kind === 'lastyear');
  const firstForecast = addDays(wxStart(), -15);
  let html = `<div class="wx-head"><h2>❄️ מזג האוויר בטיול</h2><p>${Number(wxStart().slice(8))}-${Number(state.trip.end.slice(8))} בדצמבר · ${meta.mountain ? `24-26.12 ב${esc(meta.mountain.name)}` : 'הכל לפי וינה (אפשר לשנות להרים בהגדרות ⚙️)'}</p>
    ${anyLastYear ? `<p style="margin-top:6px">⏳ תחזית אמיתית זמינה עד 16 יום קדימה (מ-${fmtDay(firstForecast)} לערך). עד אז מוצג מה היה באותם תאריכים בשנה שעברה, כהערכה.</p>` : ''}
    ${stale ? `<p style="margin-top:6px">📴 אין חיבור. מוצגת התחזית האחרונה ששמרתי.</p>` : ''}</div>`;
  for (const d of days) {
    const w = data[d];
    if (!w) { html += `<div class="wx-day"><div class="wx-date">${fmtDay(d)}</div><p class="small">אין נתונים</p></div>`; continue; }
    const [ico, desc] = WMO[w.weather_code] || ['🌡️', ''];
    const a = advice(w);
    html += `<div class="wx-day ${d === today ? 'today' : ''}">
      <div class="wx-top"><div><div class="wx-date">${fmtDay(d)}${d === today ? ' · היום' : ''}</div>
        <div class="wx-loc">📍 ${esc(w.loc)} · ${desc}${w.kind === 'lastyear' ? ' · <b>שנה שעברה</b>' : ''}</div></div><div class="wx-ico">${ico}</div></div>
      <div class="wx-temps"><span><b>${Math.round(w.temperature_2m_max)}°</b> / ${Math.round(w.temperature_2m_min)}°</span>
        <span class="wx-feels">מרגיש כמו ${Math.round(w.apparent_temperature_max)}° / ${Math.round(w.apparent_temperature_min)}°</span>
        <span>💨 ${Math.round(w.wind_speed_10m_max)} קמ״ש</span>
        ${w.precipitation_probability_max != null ? `<span>☔ ${w.precipitation_probability_max}%</span>` : (w.precipitation_sum > 0.2 ? `<span>☔ ${w.precipitation_sum.toFixed(1)} מ״מ</span>` : '')}
        ${w.snowfall_sum > 0.2 ? `<span>❄️ ${w.snowfall_sum.toFixed(1)} ס״מ</span>` : ''}</div>
      <div class="wx-advice"><span class="wx-level">🧣 ${a.level}:</span> מה ללבוש
        <ul>${a.items.map((i) => `<li>${i}</li>`).join('')}${a.extra.map((i) => `<li><b>${i}</b></li>`).join('')}</ul></div>
    </div>`;
  }
  html += `<p class="wx-src">נתונים: Open-Meteo${fetchedAt ? ` · עודכן ${new Date(fetchedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>`;
  $('#weather').innerHTML = html;
}
async function showWeather(force = false) {
  const key = JSON.stringify([state.trip, meta.mountain]);
  const cache = lsGet(LS_WX, null);
  const fresh = cache && cache.key === key && Date.now() - cache.at < 3 * 3600 * 1000;
  if (cache && cache.key === key) renderWeather(cache.data, cache.at, false);
  else $('#weather').innerHTML = '<p class="empty">טוען תחזית... ❄️</p>';
  if (fresh && !force) return;
  try {
    const data = await loadWeather();
    lsSet(LS_WX, { key, at: Date.now(), data });
    if (ui.tab === 'weather') renderWeather(data, Date.now(), false);
  } catch {
    if (cache) { if (ui.tab === 'weather') renderWeather(cache.data, cache.at, true); }
    else $('#weather').innerHTML = '<p class="empty">אין חיבור לאינטרנט, ועוד לא נשמרה תחזית. נסו שוב כשיש רשת.</p>';
  }
}

/* ---------- settings: mountain location ---------- */
function renderMtn() { $('#mtnCurrent').textContent = meta.mountain ? meta.mountain.name : 'וינה (ברירת מחדל)'; }
async function searchMtn() {
  const q = $('#mtnQ').value.trim(); if (!q) return;
  $('#mtnResults').innerHTML = '<li class="small">מחפש...</li>';
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=de&format=json`);
    const j = await r.json();
    const res = (j.results || []);
    $('#mtnResults').innerHTML = res.length ? res.map((x, i) => `<li><button data-i="${i}">${esc(x.name)} · ${esc([x.admin1, x.country].filter(Boolean).join(', '))}${x.elevation ? ` · ${Math.round(x.elevation)} מ׳` : ''}</button></li>`).join('') : '<li class="small">לא נמצא</li>';
    $('#mtnResults').querySelectorAll('button').forEach((b) => (b.onclick = () => {
      const x = res[b.dataset.i]; meta.mountain = { name: x.name, lat: x.latitude, lng: x.longitude }; lsSet(LS_META, meta);
      $('#mtnResults').innerHTML = ''; renderMtn(); toast(`מזג האוויר ל-24-26.12 לפי ${x.name}`);
    }));
  } catch { $('#mtnResults').innerHTML = '<li class="small">אין חיבור לאינטרנט</li>'; }
}

/* ---------- export / import ---------- */
async function exportData() {
  const payload = { app: 'vienna-xmas', exported_at: new Date().toISOString(), trip: state.trip, categories: state.categories, places: state.places };
  const name = `vienna-places-${todayStr()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'המקומות שלנו בווינה' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('הקובץ ירד. אפשר לשלוח אותו בוואטסאפ');
}
function readImport(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const j = JSON.parse(fr.result); const places = Array.isArray(j) ? j : j.places;
      if (!Array.isArray(places)) throw 0;
      pendingImport = { ...j, places: places.map(normalize).filter((p) => p.name) };
      $('#importChoice').hidden = false; $('#importMsg').textContent = `בקובץ ${pendingImport.places.length} מקומות`;
    } catch { $('#importMsg').textContent = 'הקובץ לא תקין'; }
  };
  fr.readAsText(file);
}
function doImport(mode) {
  if (!pendingImport) return;
  let added = 0, updated = 0;
  if (mode === 'replace') {
    applyData({ trip: pendingImport.trip, categories: pendingImport.categories, places: pendingImport.places });
    state.places.forEach((p) => { if (p.id == null) p.id = nextId(); });
    added = state.places.length;
  } else {
    const key = (p) => p.name.trim().toLowerCase();
    for (const inc of pendingImport.places) {
      const ex = state.places.find((p) => (inc.id != null && p.id === inc.id && key(p) === key(inc))) || state.places.find((p) => key(p) === key(inc));
      if (ex) { const next = { ...inc, id: ex.id, visited: ex.visited || inc.visited, favorite: ex.favorite || inc.favorite }; if (JSON.stringify({ ...ex, source: 0 }) !== JSON.stringify({ ...ex, ...next, source: 0 })) updated++; Object.assign(ex, next); }
      else { state.places.push({ ...inc, id: nextId() }); added++; }
    }
  }
  pendingImport = null; $('#importChoice').hidden = true;
  savePlaces(); markersDirty = true; buildTabs(); refreshView();
  $('#importMsg').textContent = mode === 'replace' ? `✓ הוחלף: ${added} מקומות` : `✓ נוספו ${added}, עודכנו ${updated}`;
}
async function resetAll() {
  const b = $('#btnReset');
  if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'בטוח? כל השינויים יימחקו. לחצו שוב'; setTimeout(() => { delete b.dataset.confirm; b.textContent = 'חזרה לרשימה המקורית (מוחק שינויים)'; }, 4000); return; }
  try { const seed = await loadSeed(); applyData(seed); meta.seedMax = maxId(seed.places); lsSet(LS_META, meta); savePlaces(); markersDirty = true; buildTabs(); refreshView(); toast('חזרנו לרשימה המקורית'); $('#dlgSettings').close(); }
  catch { toast('צריך אינטרנט בשביל זה'); }
  delete b.dataset.confirm; b.textContent = 'חזרה לרשימה המקורית (מוחק שינויים)';
}

/* ---------- bindings ---------- */
function bindUi() {
  $('#cards').addEventListener('click', onCardClick);
  $('#q').addEventListener('input', (e) => { ui.q = e.target.value; saveUi(); renderList(); });
  $('#hideVisited').addEventListener('change', (e) => { ui.hideVisited = e.target.checked; saveUi(); renderList(); });
  $('#originSeg').querySelectorAll('button').forEach((b) => (b.onclick = () => setOrigin(b.dataset.v)));
  $('#btnAdd').onclick = () => openEdit(null);
  $('#formEdit').addEventListener('submit', saveEdit);
  $('#btnCancel').onclick = () => $('#dlgEdit').close();
  $('#btnDelete').onclick = deleteEdit;
  $('#btnGeo').onclick = geocodeAddress;
  $('#btnSettings').onclick = () => { renderMtn(); $('#importChoice').hidden = true; $('#importMsg').textContent = ''; $('#dlgSettings').showModal(); };
  $('#btnCloseSettings').onclick = () => $('#dlgSettings').close();
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = (e) => { if (e.target.files[0]) readImport(e.target.files[0]); e.target.value = ''; };
  $('#btnMerge').onclick = () => doImport('merge');
  $('#btnReplace').onclick = () => doImport('replace');
  $('#btnMtn').onclick = searchMtn;
  $('#mtnQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchMtn(); });
  $('#btnMtnReset').onclick = () => { meta.mountain = null; lsSet(LS_META, meta); renderMtn(); toast('מזג האוויר לפי וינה'); };
  $('#btnReset').onclick = resetAll;
  $('#dlgSettings').addEventListener('close', () => { if (ui.tab === 'weather') showWeather(); });
}

init();
