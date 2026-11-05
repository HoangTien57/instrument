// ================= Instrument =================
const $ = s => document.querySelector(s);
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const BLACK = [1,3,6,8,10];
const toMidi = n => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n || '');
  if (!m) return null;
  return {C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]] + (m[2]==='#'?1:m[2]==='b'?-1:0) + (+m[3]+1)*12;
};
const nm = m => NAMES[m%12] + (Math.floor(m/12)-1);
const hz = m => 440 * 2 ** ((m-69)/12);

// ---------- trạng thái ----------
const S = { inst:'piano', mode:'solo', songs:[], song:null, events:[], pos:0 };

// ---------- bàn phím máy tính -> nốt ----------
// Hàng dưới: Z X C V B N M (phím trắng), S D G H J (phím đen)
// Hàng trên: Q W E R T Y U (phím trắng), 2 3 5 6 7 (phím đen), I = nốt Đô cao
const WHITE = [0,2,4,5,7,9,11];
function buildKeymap(base, withNumbers) {
  const k = {};
  'zxcvbnm'.split('').forEach((c,i) => k[c] = base + WHITE[i]);
  Object.entries({s:1,d:3,g:6,h:8,j:10}).forEach(([c,o]) => k[c] = base + o);
  'qwertyu'.split('').forEach((c,i) => k[c] = base + 12 + WHITE[i]);
  if (withNumbers) Object.entries({2:1,3:3,5:6,6:8,7:10}).forEach(([c,o]) => k[c] = base + 12 + o);
  k['i'] = base + 24;
  return k;
}
const BASE = { piano:60, guitar:48 };        // piano: C4–C6, guitar: C3–C5
let KEYMAP = {};
const keyOf = m => Object.keys(KEYMAP).find(k => KEYMAP[k] === m) || '';

// ---------- âm thanh ----------
let ctx, master;
function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    master = ctx.createGain(); master.gain.value = 0.9;
    master.connect(comp); comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function pianoTone(m, t, v = 0.7) {
  const c = audio(); t = t ?? c.currentTime;
  const f = hz(m), dur = Math.max(0.9, 2.6 - (m-48)/30);
  const g = c.createGain(), lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f*9);
  g.connect(lp); lp.connect(master);
  [[1,'triangle',1],[2,'sine',.35],[3,'sine',.12],[4,'sine',.05]].forEach(([h,type,a]) => {
    const o = c.createOscillator(), og = c.createGain();
    o.type = type; o.frequency.value = f*h; og.gain.value = a;
    o.connect(og); og.connect(g); o.start(t); o.stop(t+dur+.1);
  });
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v*.32, t+.006);
  g.gain.exponentialRampToValueAtTime(v*.12, t+.25);
  g.gain.exponentialRampToValueAtTime(.0005, t+dur);
}
const ksCache = {};
function ksBuffer(m) {               // Karplus-Strong: mô phỏng dây gảy
  if (ksCache[m]) return ksCache[m];
  const c = audio(), sr = c.sampleRate, len = Math.floor(sr*3);
  const buf = c.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const N = Math.max(2, Math.round(sr / hz(m)));
  for (let i = 0; i < N; i++) y[i] = Math.random()*2-1;
  for (let i = 1; i < N; i++) y[i] = .5*(y[i]+y[i-1]);
  const d = m < 52 ? .998 : m < 64 ? .997 : .995;
  for (let i = N; i < len; i++) y[i] = d*.5*(y[i-N] + y[i-N+1]);
  return ksCache[m] = buf;
}
function guitarTone(m, t, v = 0.7) {
  const c = audio(); t = t ?? c.currentTime;
  const src = c.createBufferSource(), g = c.createGain(), lp = c.createBiquadFilter();
  src.buffer = ksBuffer(m); g.gain.value = v*.55;
  lp.type = 'lowpass'; lp.frequency.value = 4200;
  src.connect(lp); lp.connect(g); g.connect(master); src.start(t);
}

// ---------- hợp âm ----------
const QUAL = {
  '':[0,4,7], 'M':[0,4,7], 'maj':[0,4,7], 'm':[0,3,7], 'min':[0,3,7], '5':[0,7],
  '7':[0,4,7,10], 'maj7':[0,4,7,11], 'M7':[0,4,7,11], 'm7':[0,3,7,10], 'mM7':[0,3,7,11],
  'dim':[0,3,6], 'dim7':[0,3,6,9], 'm7b5':[0,3,6,10], 'aug':[0,4,8], '+':[0,4,8],
  'sus4':[0,5,7], 'sus2':[0,2,7], 'sus':[0,5,7], '7sus4':[0,5,7,10],
  '6':[0,4,7,9], 'm6':[0,3,7,9], '9':[0,4,7,10,14], 'm9':[0,3,7,10,14], 'add9':[0,4,7,14], 'maj9':[0,4,7,11,14],
};
function parseChord(name) {
  const m = /^([A-G])([#b]?)([^/]*)/.exec(name || '');
  if (!m) return null;
  const root = ({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[m[1]] + (m[2]==='#'?1:m[2]==='b'?-1:0) + 12) % 12;
  let q = m[3].replace(/[()]/g,'');
  while (q && !(q in QUAL)) q = q.slice(0,-1);   // "m7add11" -> "m7"
  const iv = QUAL[q] || [0,4,7];
  return { root, q, iv, minor: iv.includes(3) && !iv.includes(4) };
}
// Thế bấm guitar: dây 6 (Mi trầm) -> dây 1 (Mi cao), -1 = không gảy
const OPEN = [40,45,50,55,59,64];
const SHAPES = {
  C:[-1,3,2,0,1,0], D:[-1,-1,0,2,3,2], E:[0,2,2,1,0,0], F:[1,3,3,2,1,1], G:[3,2,0,0,0,3], A:[-1,0,2,2,2,0],
  Am:[-1,0,2,2,1,0], Dm:[-1,-1,0,2,3,1], Em:[0,2,2,0,0,0], Bm:[-1,2,4,4,3,2],
  C7:[-1,3,2,3,1,0], D7:[-1,-1,0,2,1,2], E7:[0,2,0,1,0,0], G7:[3,2,0,0,0,1], A7:[-1,0,2,0,2,0], B7:[-1,2,1,2,0,2],
  Am7:[-1,0,2,0,1,0], Dm7:[-1,-1,0,2,1,1], Em7:[0,2,0,0,0,0], Cmaj7:[-1,3,2,0,0,0], Fmaj7:[-1,-1,3,2,1,0],
  Dsus4:[-1,-1,0,2,3,3], Asus4:[-1,0,2,2,3,0], Esus4:[0,2,2,2,0,0], Dsus2:[-1,-1,0,2,3,0], Asus2:[-1,0,2,2,0,0],
};
const E_SHAPE = { maj:[0,2,2,1,0,0], m:[0,2,2,0,0,0], '7':[0,2,0,1,0,0], m7:[0,2,0,0,0,0], maj7:[0,2,1,1,0,0], sus4:[0,2,2,2,0,0] };
const A_SHAPE = { maj:[-1,0,2,2,2,0], m:[-1,0,2,2,1,0], '7':[-1,0,2,0,2,0], m7:[-1,0,2,0,1,0], maj7:[-1,0,2,1,2,0], sus4:[-1,0,2,2,3,0] };
function guitarShape(name) {
  const key = (name || '').split('/')[0];
  if (SHAPES[key]) return SHAPES[key];
  const p = parseChord(key); if (!p) return null;
  const fam = ['m','min'].includes(p.q) ? 'm' : ['7','9'].includes(p.q) ? '7' : ['m7','m9'].includes(p.q) ? 'm7'
            : ['maj7','M7','maj9'].includes(p.q) ? 'maj7' : p.q.startsWith('sus') ? 'sus4' : p.minor ? 'm' : 'maj';
  const fE = (p.root - 4 + 12) % 12, fA = (p.root - 9 + 12) % 12;
  const [base, off] = fE <= fA ? [E_SHAPE, fE] : [A_SHAPE, fA];   // chọn thế chặn ở ngăn thấp hơn
  return base[fam].map(f => f < 0 ? -1 : f + off);
}
function chordMidis(name) {
  if (S.inst === 'guitar') {
    const sh = guitarShape(name); if (!sh) return [];
    return sh.map((f,s) => f < 0 ? null : OPEN[s] + f).filter(x => x != null);
  }
  const p = parseChord(name); if (!p) return [];
  return [48 + p.root, ...p.iv.map(i => 60 + p.root + i)];
}

// ---------- phát ----------
function playNote(m) {
  (S.inst === 'piano' ? pianoTone : guitarTone)(m);
  flash([m]);
}
function playChord(name) {
  const ms = chordMidis(name); if (!ms.length) return;
  const c = audio(), t0 = c.currentTime;
  ms.forEach((m,i) => S.inst === 'piano' ? pianoTone(m, t0 + i*.012, .5) : guitarTone(m, t0 + i*.022, .55));
  flash(ms, name);
  document.querySelectorAll('.pad button').forEach(b => b.classList.toggle('on', b.dataset.chord === name));
  setTimeout(() => document.querySelectorAll('.pad button.on').forEach(b => b.classList.remove('on')), 250);
}

// ---------- vẽ piano ----------
function renderPiano() {
  const W = 40, wrap = document.createElement('div');
  wrap.className = 'piano'; let wi = 0;
  for (let m = 48; m <= 84; m++) {
    const black = BLACK.includes(m % 12), k = document.createElement('div');
    k.className = 'key ' + (black ? 'black' : 'white'); k.dataset.midi = m;
    if (black) k.style.left = (wi*W - 13) + 'px'; else wi++;
    k.innerHTML = `<span class="kb">${keyOf(m)}</span>${m % 12 === 0 ? `<span class="nn">${nm(m)}</span>` : ''}`;
    k.addEventListener('pointerdown', e => { e.preventDefault(); playNote(m); });
    wrap.appendChild(k);
  }
  wrap.style.width = wi*W + 'px';
  $('#stage').replaceChildren(wrap);
}

// ---------- vẽ guitar ----------
const NUT = 90, SCALE = 1060;
const fretX = n => NUT + SCALE * (1 - 2 ** (-n/12));
const stringY = s => 112 + (5 - s) * 12.4;           // dây 1 (Mi cao) ở trên
const dotX = f => f === 0 ? NUT - 16 : (fretX(f-1) + fretX(f)) / 2;
function renderGuitar() {
  let svg = `<svg class="guitar" viewBox="0 0 1000 285" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3a65e"/><stop offset="1" stop-color="#b8743a"/></linearGradient></defs>
  <!-- thân đàn -->
  <g fill="#3a2414"><ellipse cx="712" cy="142" rx="104" ry="96"/><ellipse cx="862" cy="142" rx="128" ry="122"/></g>
  <g fill="url(#wood)"><ellipse cx="712" cy="142" rx="98" ry="90"/><ellipse cx="862" cy="142" rx="122" ry="116"/><rect x="740" y="70" width="60" height="144"/></g>
  <circle cx="745" cy="142" r="50" fill="#5a3a20"/><circle cx="745" cy="142" r="42" fill="#140c06"/>
  <rect x="890" y="100" width="18" height="84" rx="4" fill="#2b1a0e"/>
  <!-- đầu đàn -->
  <path d="M8 96 L${NUT} 104 L${NUT} 180 L8 188 Z" fill="#2b1a0e"/>`;
  [0,1,2].forEach(i => { svg += `<circle cx="${22+i*24}" cy="92" r="7" fill="#c9c2b4"/><circle cx="${22+i*24}" cy="192" r="7" fill="#c9c2b4"/>`; });
  svg += `<!-- cần đàn --><rect x="${NUT}" y="104" width="${fretX(15)-NUT}" height="76" fill="#3b2617"/>
  <rect x="${NUT-4}" y="104" width="6" height="76" fill="#efe8d8"/>`;
  [3,5,7,9].forEach(f => svg += `<circle cx="${dotX(f)}" cy="142" r="5" fill="#d9cdb4"/>`);
  svg += `<circle cx="${dotX(12)}" cy="124" r="5" fill="#d9cdb4"/><circle cx="${dotX(12)}" cy="160" r="5" fill="#d9cdb4"/>`;
  for (let f = 1; f <= 15; f++) svg += `<line x1="${fretX(f)}" y1="104" x2="${fretX(f)}" y2="180" stroke="#b9b3a8" stroke-width="2"/>`;
  for (let f = 1; f <= 12; f++) svg += `<text x="${dotX(f)}" y="200" font-size="10" fill="#8f877a" text-anchor="middle">${f}</text>`;
  for (let s = 0; s < 6; s++) svg += `<line x1="${NUT}" y1="${stringY(s)}" x2="899" y2="${stringY(s)}" stroke="#e8e2d6" stroke-width="${2.4 - s*.3}"/>`;
  ['E','A','D','G','B','e'].forEach((n,s) => svg += `<text x="${NUT-34}" y="${stringY(s)+3.5}" font-size="10" fill="#cfc6b6" text-anchor="middle">${n}</text>`);
  svg += `<g id="gnext"></g><g id="gon"></g></svg>`;
  $('#stage').innerHTML = svg;
}
function guitarPos(m) {             // chọn chỗ bấm có ngăn thấp nhất (ưu tiên dây cao)
  let best = null;
  for (let s = 5; s >= 0; s--) {
    const f = m - OPEN[s];
    if (f >= 0 && f <= 15 && (!best || f < best.f)) best = { s, f };
  }
  return best;
}
function gDots(layer, list, cls) {
  const g = document.getElementById(layer); if (!g) return;
  g.innerHTML = list.map(({s,f,label}) =>
    `<g class="gdot ${cls}"><circle cx="${dotX(f)}" cy="${stringY(s)}" r="9"/><text x="${dotX(f)}" y="${stringY(s)}">${label ?? ''}</text></g>`).join('');
}

// ---------- tô sáng ----------
let flashTimer;
function flash(ms, chordName) {
  clearTimeout(flashTimer);
  if (S.inst === 'piano') {
    document.querySelectorAll('.key.on').forEach(k => k.classList.remove('on'));
    ms.forEach(m => document.querySelector(`.key[data-midi="${m}"]`)?.classList.add('on'));
    flashTimer = setTimeout(() => document.querySelectorAll('.key.on').forEach(k => k.classList.remove('on')), 260);
  } else {
    const pts = chordName ? shapePoints(chordName) : ms.map(m => ({ ...guitarPos(m), label: NAMES[m%12] })).filter(p => p.s != null);
    gDots('gon', pts, 'on');
    flashTimer = setTimeout(() => gDots('gon', [], 'on'), 300);
  }
}
const shapePoints = name => (guitarShape(name) || []).map((f,s) => f < 0 ? null : { s, f, label: NAMES[(OPEN[s]+f)%12] }).filter(Boolean);
function showNext() {
  const ev = S.events[S.pos];
  document.querySelectorAll('.key.next').forEach(k => k.classList.remove('next'));
  if (S.inst === 'guitar') gDots('gnext', [], 'next');
  if (!ev) return;
  if (S.inst === 'piano') {
    (ev.m != null ? [ev.m] : chordMidis(ev.c)).forEach(m => document.querySelector(`.key[data-midi="${m}"]`)?.classList.add('next'));
  } else {
    const pts = ev.m != null ? [{ ...guitarPos(ev.m), label: NAMES[ev.m%12] }].filter(p => p.s != null) : shapePoints(ev.c);
    gDots('gnext', pts, 'next');
  }
}

// ---------- chuỗi phát theo bài ----------
function buildEvents() {
  const s = S.song; if (!s) return [];
  if (S.mode === 'chord') return (s.chords || []).map(c => ({ c }));
  const all = s.melody.flat().map(toMidi).filter(x => x != null).sort((a,b) => a-b);
  if (!all.length) return [];
  const med = all[all.length >> 1], target = S.inst === 'piano' ? 67 : 62;
  const shift = 12 * Math.round((target - med) / 12);   // dời quãng 8 cho vừa tầm đàn
  const ev = [];
  s.melody.forEach((ph, pi) => ph.forEach(n => { const m = toMidi(n); if (m != null) ev.push({ m: m + shift, phrase: pi }); }));
  return ev;
}
function step() {
  const ev = S.events[S.pos]; if (!ev) return;
  ev.m != null ? playNote(ev.m) : playChord(ev.c);
  S.pos++; renderSeq(); showNext();
}
function renderSeq() {
  const box = $('#seq');
  if (!S.song) { box.innerHTML = ''; return; }
  if (!S.events.length) { box.innerHTML = `<div class="end">Bài này chưa có phần ${S.mode === 'solo' ? 'giai điệu' : 'hợp âm'}.</div>`; return; }
  const chip = (txt, i) => `<span class="chip ${i < S.pos ? 'done' : i === S.pos ? 'cur' : ''}" data-i="${i}">${txt}</span>`;
  let html = '';
  if (S.mode === 'solo') {
    let cur = -1, row = '';
    S.events.forEach((e,i) => {
      if (e.phrase !== cur) { if (row) html += `<div class="phrase">${row}</div>`; row = ''; cur = e.phrase; }
      row += chip(nm(e.m), i);
    });
    html += `<div class="phrase">${row}</div>`;
  } else {
    html = `<div class="phrase">${S.events.map((e,i) => chip(e.c, i)).join('')}</div>`;
  }
  if (S.pos >= S.events.length) html += `<div class="end">✓ Hết bài — nhấn Esc để chơi lại</div>`;
  box.innerHTML = html;
  box.querySelector('.chip.cur')?.scrollIntoView({ block:'nearest' });
}
$('#seq').addEventListener('click', e => {
  const i = e.target.dataset?.i; if (i == null) return;
  S.pos = +i; renderSeq(); showNext();
});

// ---------- bảng hợp âm / chú giải phím ----------
const DEFAULT_CHORDS = ['C','G','Am','F','Dm','Em','G7','E7','A'];
function chordList() {
  const src = S.song?.chords?.length ? S.song.chords : DEFAULT_CHORDS;
  return [...new Set(src)].slice(0, 9);
}
function renderPad() {
  const pad = $('#pad');
  if (S.mode === 'chord') {
    pad.className = 'pad';
    pad.innerHTML = chordList().map((c,i) => `<button data-chord="${c}">${c}<small>phím ${i+1}</small></button>`).join('');
    pad.querySelectorAll('button').forEach(b => b.onclick = () => playChord(b.dataset.chord));
  } else if (S.inst === 'guitar') {
    pad.className = 'legend';
    pad.innerHTML = Object.entries(KEYMAP).sort((a,b) => a[1]-b[1]).map(([k,m]) => `<span><b>${k}</b> ${nm(m)}</span>`).join('');
  } else { pad.className = 'pad'; pad.innerHTML = ''; }
}
function renderHowto() {
  const song = S.song
    ? `Nhấn <kbd>Space</kbd> liên tục để phát ${S.mode === 'solo' ? 'từng nốt theo lời' : 'từng hợp âm'} · <kbd>Backspace</kbd> lùi 1 · <kbd>Esc</kbd> về đầu · bấm vào ô để nhảy tới.`
    : 'Chọn một bài ở bên trái để chơi theo bằng phím Space.';
  const free = S.mode === 'solo'
    ? ` Chơi tự do: hàng <kbd>Z</kbd>…<kbd>M</kbd> và <kbd>Q</kbd>…<kbd>I</kbd> là phím trắng, <kbd>S D G H J</kbd> và <kbd>2 3 5 6 7</kbd> là phím đen.`
    : ` Chơi tự do: phím số <kbd>1</kbd>…<kbd>9</kbd> là các hợp âm bên dưới.`;
  $('#howto').innerHTML = song + free;
}

// ---------- làm mới toàn bộ ----------
function refresh(keepPos) {
  KEYMAP = buildKeymap(BASE[S.inst], S.mode === 'solo');
  S.inst === 'piano' ? renderPiano() : renderGuitar();
  S.events = buildEvents();
  if (!keepPos) S.pos = 0;
  $('#songTitle').innerHTML = S.song
    ? `${esc(S.song.title)} <small>— ${esc(S.song.artist || '')}${S.song.key ? ' · giọng ' + esc(S.song.key) : ''}`
      + (S.song.melody_from ? ` · giai điệu: ${esc(S.song.melody_from)} · hợp âm: ${esc(S.song.chords_from || '?')}` : '')
      + (S.song.sources || []).map((u,i) => ` <a href="${esc(u)}" target="_blank" rel="noopener">[nguồn ${i+1}]</a>`).join('') + `</small>`
    : 'Chưa chọn bài — chơi tự do bằng bàn phím';
  renderSeq(); renderPad(); renderHowto(); showNext(); renderList();
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------- danh sách nhạc ----------
function renderList() {
  $('#songList').innerHTML = S.songs.map(s => `
    <li data-id="${s.id}" class="${S.song?.id === s.id ? 'active' : ''}" title="${esc(s.note || '')}">
      <div class="t"><b>${esc(s.title)}</b><small>${esc(s.artist || '')}</small></div>
      ${s.confidence ? `<span class="badge ${/th/.test(s.confidence) && /p/.test(s.confidence) ? 'thap' : ''}">${esc(s.confidence)}</span>` : ''}
      <button class="del" data-del="${s.id}" title="Xoá">×</button>
    </li>`).join('') || '<li><small>Chưa có bài nào.</small></li>';
}
$('#songList').addEventListener('click', async e => {
  const del = e.target.dataset?.del;
  if (del) {
    e.stopPropagation();
    if (!confirm('Xoá bài này khỏi danh sách?')) return;
    await fetch('/api/songs/' + del, { method:'DELETE' });
    if (S.song?.id === del) S.song = null;
    return loadSongs();
  }
  const li = e.target.closest('li[data-id]'); if (!li) return;
  S.song = S.songs.find(s => s.id === li.dataset.id) || null;
  refresh();
});
async function loadSongs() {
  try { S.songs = await (await fetch('/api/songs')).json(); }
  catch { S.songs = []; $('#fStatus').className = 'status err'; $('#fStatus').textContent = 'Không kết nối được server. Hãy mở bằng chay.bat.'; }
  refresh();
}
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const st = $('#fStatus'), btn = $('#fBtn');
  const title = $('#fTitle').value.trim(), artist = $('#fArtist').value.trim();
  btn.disabled = true; st.className = 'status';
  const t0 = Date.now();
  const tick = setInterval(() => st.textContent = `AI đang tìm và phổ nhạc… ${Math.round((Date.now()-t0)/1000)} giây (thường 30–120 giây)`, 500);
  try {
    const r = await (await fetch('/api/songs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, artist }) })).json();
    if (r.error) throw new Error(r.error);
    if (!r.found) { st.className = 'status err'; st.textContent = 'Không phổ được: ' + (r.note || ''); return; }
    st.className = 'status ok';
    st.textContent = `Đã thêm "${r.song.title}" · độ chắc chắn: ${r.song.confidence || '?'}${r.song.note ? '\n' + r.song.note : ''}`;
    $('#fTitle').value = ''; $('#fArtist').value = '';
    S.songs = await (await fetch('/api/songs')).json();
    S.song = S.songs.find(s => s.id === r.song.id) || null;
    refresh();
  } catch (err) { st.className = 'status err'; st.textContent = 'Lỗi: ' + err.message; }
  finally { clearInterval(tick); btn.disabled = false; }
});

// ---------- tab & chế độ ----------
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
  S.inst = b.dataset.inst; refresh();
});
document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  document.querySelectorAll('.mode').forEach(x => x.classList.toggle('active', x === b));
  S.mode = b.dataset.mode; refresh(); b.blur();
});

// ---------- phím ----------
window.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!e.repeat) step(); return; }
  if (e.repeat) return;
  if (k === 'backspace') { e.preventDefault(); S.pos = Math.max(0, S.pos-1); renderSeq(); showNext(); return; }
  if (k === 'escape') { S.pos = 0; renderSeq(); showNext(); return; }
  if (S.mode === 'chord' && /^[1-9]$/.test(k)) { const c = chordList()[+k-1]; if (c) playChord(c); return; }
  if (k in KEYMAP) { playNote(KEYMAP[k]); }
});

// bỏ focus khỏi nút sau khi bấm, để Space không "bấm lại" nút đó
document.addEventListener('click', e => { const b = e.target.closest('button:not([type=submit])'); if (b) b.blur(); });

loadSongs();
