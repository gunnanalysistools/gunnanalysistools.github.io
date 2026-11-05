/* Matrix Grapher — UI layer: expression list, canvas graph, matrix transformations. Depends on math.js (window.MG). */
(function () {
  'use strict';
  const { fmt, evaluate, parseGeometry, interpolate, classify, applyToGeom, det } = window.MG;

  const PALETTE = ['#c74440', '#2d70b3', '#388c46', '#6042a6', '#fa7e19', '#000000'];
  const STORE_KEY = 'matrix-grapher-v2';
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d'), listEl = $('list');

  const state = { items: [], nextId: 1, colorIdx: 0, snap: true, view: { ox: 0, oy: 0, scale: 50 } };
  let W = 0, H = 0;
  let handles = [], hover = null, drag = null, saveTimer = null;
  const rowEls = new Map();

  /* ---------- helpers ---------- */
  const nextColor = () => PALETTE[state.colorIdx++ % PALETTE.length];
  const newId = () => 'i' + state.nextId++;
  const toScreen = (x, y) => [state.view.ox + x * state.view.scale, state.view.oy - y * state.view.scale];
  const toWorld = (sx, sy) => [(sx - state.view.ox) / state.view.scale, (state.view.oy - sy) / state.view.scale];
  const ptText = p => '(' + fmt(p[0], 4) + ', ' + fmt(p[1], 4) + ')';
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const validGeom = g => g && g.type !== 'error';

  /** Mix a #rrggbb color toward white (amount > 0) or black (amount < 0). */
  function shade(hex, amount) {
    const target = amount > 0 ? 255 : 0, k = Math.abs(amount);
    const out = [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - k) + target * k));
    return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // Before = lighter tint of the shape's color; after = the full color, each further step a bit darker.
  const shownColor = it => shade(it.color, 0.45);
  function recolor(it) { it.transforms.forEach((tf, i) => { tf.color = shade(it.color, -0.28 * i); }); }

  function newExpr(text) {
    const it = { id: newId(), kind: 'expr', text: text || '', color: nextColor(), visible: true, transforms: [] };
    it._g = parseGeometry(it.text);
    return it;
  }
  const IDENTITY_RAW = () => ({ a: '1', b: '0', e: '0', c: '0', d: '1', f: '0' });
  function newTransform(raw) {
    const tf = { id: newId(), color: '#000000', visible: true, raw: raw || IDENTITY_RAW(), t: 1, playing: false, showName: false, paths: false };
    readMatrix(tf);
    return tf;
  }
  /** Turn the typed strings into numbers. Keeps the last good value for any box that does not parse. */
  function readMatrix(tf) {
    const M = tf.M || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    tf.bad = {};
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
      try { M[k] = evaluate(String(tf.raw[k])); } catch (err) { tf.bad[k] = true; }
    }
    tf.M = M;
  }
  const geomText = g => g.type === 'point' ? ptText(g.pts[0]) : '[' + g.pts.map(ptText).join(', ') + ']';

  /* ---------- grid / snapping ---------- */
  function gridInfo() {
    const raw = 80 / state.view.scale, pow = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / pow;
    const mant = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    const major = mant * pow;
    return { major, minor: major / (mant === 2 ? 4 : 5), snap: Math.min(1, major / (mant === 2 ? 2 : mant === 5 ? 5 : 1)) };
  }
  function snapPt(w) {
    if (state.snap) { const s = gridInfo().snap; return [Math.round(w[0] / s) * s, Math.round(w[1] / s) * s].map(v => parseFloat(v.toFixed(6))); }
    const d = Math.max(0, Math.ceil(Math.log10(state.view.scale)));
    return w.map(v => parseFloat(v.toFixed(d)));
  }

  /* ---------- computation of everything to draw ---------- */
  const effMatrix = tf => interpolate(tf.M, tf.t);

  function compute() {
    const steps = [];
    for (const it of state.items) {
      if (!validGeom(it._g)) continue;
      let cur = it._g;
      recolor(it);
      for (const tf of it.transforms) {
        const M = effMatrix(tf), img = applyToGeom(M, cur);
        steps.push({ it, tf, src: cur, img });
        cur = img;
      }
    }
    return steps;
  }

  /* ---------- drawing ---------- */
  function resize() {
    const r = $('graph').getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const first = W === 0;
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (first && !state.view.ox) { state.view.ox = W / 2; state.view.oy = H / 2; }
    draw();
  }

  function drawGrid() {
    const v = state.view, g = gridInfo();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(W, H);
    const line = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
    const sweep = (step, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      for (let i = Math.ceil(x0 / step); i * step <= x1; i++) { const sx = Math.round(v.ox + i * step * v.scale) + .5; line(sx, 0, sx, H); }
      for (let i = Math.ceil(y0 / step); i * step <= y1; i++) { const sy = Math.round(v.oy - i * step * v.scale) + .5; line(0, sy, W, sy); }
    };
    sweep(g.minor, '#f0eef6');
    sweep(g.major, '#dcd9e6');
    ctx.strokeStyle = '#59546e'; ctx.lineWidth = 1.5;
    line(0, Math.round(v.oy) + .5, W, Math.round(v.oy) + .5);
    line(Math.round(v.ox) + .5, 0, Math.round(v.ox) + .5, H);
    ctx.font = '600 12px "Helvetica Neue", Helvetica, Arial, sans-serif'; ctx.fillStyle = '#6b6780';
    const ay = Math.min(Math.max(v.oy, 14), H - 20), ax = Math.min(Math.max(v.ox, 34), W - 6);
    const halo = (t, x, y) => { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); };
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = Math.ceil(x0 / g.major); i * g.major <= x1; i++) {
      if (i === 0) continue;
      const val = i * g.major; halo(fmt(val, 6), v.ox + val * v.scale, ay + 4);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = Math.ceil(y0 / g.major); i * g.major <= y1; i++) {
      if (i === 0) continue;
      const val = i * g.major; halo(fmt(val, 6), ax - 6, v.oy - val * v.scale);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'; halo('0', Math.max(v.ox - 5, 14), Math.min(Math.max(v.oy, 14), H - 20) + 4);
  }

  function pathPts(pts, closed) {
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = toScreen(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (closed) ctx.closePath();
  }
  function dot(p, color, r, hollow) {
    const [x, y] = toScreen(p[0], p[1]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = hollow ? '#fff' : color; ctx.fill();
    ctx.lineWidth = hollow ? 2.5 : 1.5; ctx.strokeStyle = hollow ? color : '#fff'; ctx.stroke();
  }
  // Originals are solid with filled points; images are dashed with hollow points.
  function drawGeom(g, color, isImage) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const dash = isImage ? [9, 8] : [];
    if (g.type === 'line') {
      const L = (W + H + Math.hypot(...toScreen(g.p[0], g.p[1]))) / state.view.scale * 3 / Math.hypot(g.d[0], g.d[1]);
      pathPts([[g.p[0] - g.d[0] * L, g.p[1] - g.d[1] * L], [g.p[0] + g.d[0] * L, g.p[1] + g.d[1] * L]], false);
      ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
    } else if (g.type === 'poly') {
      pathPts(g.pts, g.closed);
      if (g.closed) { ctx.fillStyle = color + (isImage ? '1a' : '33'); ctx.fill(); }
      ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
      g.pts.forEach(p => dot(p, color, 5, isImage));
    } else if (g.type === 'point') dot(g.pts[0], color, 6, isImage);
  }
  function anchorOf(g) {
    if (g.pts) return [g.pts.reduce((s, p) => s + p[0], 0) / g.pts.length, g.pts.reduce((s, p) => s + p[1], 0) / g.pts.length];
    return g.p;
  }

  function draw() {
    if (!W) return;
    drawGrid();
    handles = [];
    const steps = compute();
    // dashed paths from each point to its image
    for (const { tf, src, img } of steps) {
      if (!tf.visible || !src.pts || !img.pts) continue;
      if (!tf.paths && Math.abs(det(tf.M)) > 1e-9) continue;
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = tf.color; ctx.globalAlpha = .6; ctx.lineWidth = 1.5;
      src.pts.forEach((p, i) => {
        const q = img.pts[i]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9) return;
        pathPts([p, q], false); ctx.stroke();
      });
      ctx.restore();
    }
    // original shapes (draggable)
    for (const it of state.items) {
      if (!it.visible || !validGeom(it._g)) continue;
      drawGeom(it._g, shownColor(it));
      if (it._g.pts) it._g.pts.forEach((p, idx) => handles.push({ p, item: it, idx, draggable: true }));
    }
    // images, and names if asked for
    for (const { tf, img } of steps) {
      if (!tf.visible) continue;
      drawGeom(img, tf.color, true);
      if (img.pts) img.pts.forEach(p => handles.push({ p, draggable: false }));
      if (tf.showName) {
        const [x, y] = toScreen(...anchorOf(img)), name = classify(tf.M).name;
        ctx.font = '800 14px "Helvetica Neue", Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.strokeText(name, x, y - 12);
        ctx.fillStyle = tf.color; ctx.fillText(name, x, y - 12);
      }
    }
    const h = drag && drag.type === 'handle' ? drag.h : hover;
    if (h) {
      const [x, y] = toScreen(h.p[0], h.p[1]), t = ptText(h.p);
      ctx.font = '13px Helvetica, Arial, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(t).width + 12, bx = Math.min(x + 10, W - w - 4), by = Math.max(y - 26, 4);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#999'; ctx.lineWidth = 1;
      ctx.fillRect(bx, by, w, 22); ctx.strokeRect(bx + .5, by + .5, w, 22);
      ctx.fillStyle = '#222'; ctx.fillText(t, bx + 6, by + 11);
    }
  }

  /* ---------- saving ---------- */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const items = state.items.map(i => ({
          id: i.id, kind: 'expr', text: i.text, color: i.color, visible: i.visible,
          transforms: i.transforms.map(t => ({ id: t.id, visible: t.visible, raw: t.raw, showName: t.showName, paths: t.paths })),
        }));
        localStorage.setItem(STORE_KEY, JSON.stringify({ items, nextId: state.nextId, colorIdx: state.colorIdx, view: state.view, snap: state.snap }));
      } catch (e) { /* storage unavailable: ignore */ }
    }, 250);
  }

  /* ---------- sidebar ---------- */
  function renumber() {
    const last = state.items[state.items.length - 1];
    state.items.forEach((it, i) => {
      const r = rowEls.get(it.id); if (!r) return;
      r.querySelector('.num').textContent = i + 1;
      r.classList.toggle('blank', it === last && !it.text.trim());   // the always-present empty row has nothing to delete
    });
  }

  function infoFor(g) {
    if (!validGeom(g)) return '';
    if (g.type === 'line') return Math.abs(g.d[0]) < 1e-9 ? 'Vertical line' : 'Line · slope ' + fmt(g.d[1] / g.d[0]);
    if (g.type === 'point') return 'Point';
    let per = 0, area = 0;
    const n = g.pts.length, last = g.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = g.pts[i], b = g.pts[(i + 1) % n];
      per += Math.hypot(b[0] - a[0], b[1] - a[1]); area += a[0] * b[1] - b[0] * a[1];
    }
    return g.closed ? 'Polygon · area ' + fmt(Math.abs(area) / 2) + ' · perimeter ' + fmt(per) : 'Segments · length ' + fmt(per);
  }

  function setStatus(it) {
    const r = rowEls.get(it.id); if (!r) return;
    const s = r.querySelector('.status'), g = it._g;
    s.className = 'status' + (g && g.type === 'error' ? ' err' : '');
    s.textContent = g && g.type === 'error' ? g.message : infoFor(g);
    r.querySelector('.addtf').hidden = !validGeom(g);
    r.querySelector('.tfs').hidden = !validGeom(g);
  }

  function dotButton(obj, row, color) {
    const b = el('button', 'dot' + (obj.visible ? '' : ' off'));
    b.style.setProperty('--c', color || obj.color); b.title = 'Show / hide';
    b.onclick = () => { obj.visible = !obj.visible; b.classList.toggle('off', !obj.visible); draw(); scheduleSave(); };
    if (row) row.style.setProperty('--c', color || obj.color);
    return b;
  }

  const PRESETS = [
    ['Rotate 90°', { a: '0', b: '-1', c: '1', d: '0' }],
    ['Rotate 180°', { a: '-1', b: '0', c: '0', d: '-1' }],
    ['Rotate 45°', { a: 'cos(pi/4)', b: '-sin(pi/4)', c: 'sin(pi/4)', d: 'cos(pi/4)' }],
    ['Reflect over x-axis', { a: '1', b: '0', c: '0', d: '-1' }],
    ['Reflect over y-axis', { a: '-1', b: '0', c: '0', d: '1' }],
    ['Reflect over y = x', { a: '0', b: '1', c: '1', d: '0' }],
    ['Dilate ×2', { a: '2', b: '0', c: '0', d: '2' }],
    ['Stretch x ×2', { a: '2', b: '0', c: '0', d: '1' }],
    ['Shear (horizontal)', { a: '1', b: '1', c: '0', d: '1' }],
    ['Project onto x-axis', { a: '1', b: '0', c: '0', d: '0' }],
    ['Project onto y = x', { a: '0.5', b: '0.5', c: '0.5', d: '0.5' }],
    ['Translate (3, 2)', { a: '1', b: '0', c: '0', d: '1', e: '3', f: '2' }],
  ];

  function updateTfInfo(card, tf) {
    const info = classify(tf.M), D = det(tf.M);
    const nm = card.querySelector('.tname');
    nm.hidden = !tf.showName; nm.textContent = info.name;
    card.querySelector('.tdet').hidden = !tf.showName;
    card.querySelector('.tdet').textContent = 'det = ' + fmt(D) + (Math.abs(D) < 1e-9 ? ' · flattens onto a line' : D < 0 ? ' · flips orientation' : '') + ' · area ×' + fmt(Math.abs(D));
    card.querySelectorAll('.mgrid input').forEach(inp => inp.classList.toggle('bad', !!tf.bad[inp.dataset.k]));
  }

  function buildTfCard(it, tf) {
    const card = el('div', 'tfc');
    card.style.setProperty('--c', tf.color);
    const head = el('div', 'tfhead');
    head.append(dotButton(tf, null), el('span', 'tftitle', 'Matrix'));
    const play = el('button', 'play', '▶'); play.title = 'Animate';
    play.onclick = () => {
      tf.playing = !tf.playing; play.classList.toggle('on', tf.playing); play.textContent = tf.playing ? '❚❚' : '▶';
      if (tf.playing) startAnim(); else { tf.t = 1; draw(); }
    };
    const del = el('button', 'tfdel', '×'); del.title = 'Remove this transformation';
    del.onclick = () => { it.transforms = it.transforms.filter(x => x !== tf); renderTfs(it); draw(); scheduleSave(); };
    head.append(play, del);

    const grid = el('div', 'mgrid');
    const keys = ['a', 'b', 'e', 'c', 'd', 'f'];
    keys.forEach(k => {
      const inp = el('input'); inp.value = tf.raw[k]; inp.dataset.k = k; inp.spellcheck = false; inp.autocomplete = 'off';
      inp.title = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'shift x', f: 'shift y' }[k];
      if (k === 'e' || k === 'f') inp.classList.add('shift');
      inp.oninput = () => { tf.raw[k] = inp.value; readMatrix(tf); updateTfInfo(card, tf); draw(); scheduleSave(); };
      grid.append(inp);
    });
    // third row of the homogeneous matrix is always 0 0 1
    ['0', '0', '1'].forEach(t => grid.append(el('span', 'fixed', t)));
    const br = el('div', 'bracket'); br.append(grid);
    const sel = el('select', 'presets');
    sel.append(new Option('Presets…', ''));
    PRESETS.forEach(([label], i) => sel.append(new Option(label, i)));
    sel.onchange = () => {
      if (sel.value === '') return;
      tf.raw = Object.assign(IDENTITY_RAW(), PRESETS[sel.value][1]); sel.value = '';
      readMatrix(tf);
      grid.querySelectorAll('input').forEach(inp => { inp.value = tf.raw[inp.dataset.k]; });
      updateTfInfo(card, tf); draw(); scheduleSave();
    };
    head.insertBefore(sel, play);
    const mrow = el('div', 'mrow'); mrow.append(br);

    const opts = el('div', 'tfopts');
    const mkOpt = (label, key) => {
      const l = el('label'); const c = el('input'); c.type = 'checkbox'; c.checked = tf[key];
      c.onchange = () => { tf[key] = c.checked; updateTfInfo(card, tf); draw(); scheduleSave(); };
      l.append(c, ' ' + label); return l;
    };
    opts.append(mkOpt('Show name', 'showName'), mkOpt('Dashed paths', 'paths'));

    card.append(head, mrow, el('div', 'tname'), el('div', 'tdet'), opts);
    updateTfInfo(card, tf);
    card._play = play; card._tf = tf;
    return card;
  }

  function renderTfs(it) {
    const row = rowEls.get(it.id), box = row.querySelector('.tfs');
    box.innerHTML = ''; recolor(it);
    it.transforms.forEach(tf => box.append(buildTfCard(it, tf)));
  }

  function delButton(it) {
    const d = el('button', 'del', '×'); d.title = 'Delete';
    d.onclick = () => { state.items = state.items.filter(i => i !== it); renderList(); };
    return d;
  }

  function buildRow(it) {
    const row = el('div', 'row expr');
    const gut = el('div', 'gutter'); gut.append(el('span', 'num', ''), dotButton(it, row, shownColor(it)));
    const body = el('div', 'body');
    const inp = el('input', 'expr-input'); inp.spellcheck = false; inp.autocomplete = 'off';
    inp.placeholder = 'Type a shape, e.g. (2,3)';
    inp.value = it.text;
    inp.addEventListener('input', () => {
      it.text = inp.value; it._g = parseGeometry(it.text);
      setStatus(it); draw(); scheduleSave();
      if (state.items[state.items.length - 1] === it && it.text.trim()) addRowAtEnd(newExpr(''));
      renumber();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const nx = row.nextElementSibling; if (nx) nx.querySelector('.expr-input').focus(); }
    });
    const status = el('div', 'status');
    const tfs = el('div', 'tfs');
    const add = el('button', 'addtf', '+ Matrix transformation');
    add.onclick = () => { const tf = newTransform(); it.transforms.push(tf); renderTfs(it); draw(); scheduleSave(); const f = tfs.lastChild.querySelector('input'); if (f) f.select(); };
    body.append(inp, status, tfs, add);
    row.append(gut, body, delButton(it));
    return row;
  }

  function mountRow(it) {
    const row = buildRow(it);
    rowEls.set(it.id, row);
    listEl.append(row);
    renderTfs(it); setStatus(it); renumber();
  }
  function addRowAtEnd(it) { state.items.push(it); mountRow(it); }

  function renderList() {
    listEl.innerHTML = ''; rowEls.clear();
    const last = state.items[state.items.length - 1];
    if (!last || last.text.trim()) state.items.push(newExpr(''));
    state.items.forEach(mountRow);
    draw(); scheduleSave();
  }

  $('addBtn').onclick = () => {
    const last = state.items[state.items.length - 1];
    if (!last || last.text.trim()) { state.items.push(newExpr('')); renderList(); }
    const rows = listEl.querySelectorAll('.expr-input'); rows[rows.length - 1].focus();
  };
  $('helpBtn').onclick = () => $('help').showModal();

  /* ---------- animation ---------- */
  let animOn = false;
  function allTfs() { return state.items.flatMap(i => i.transforms); }
  function startAnim() {
    if (animOn) return; animOn = true;
    const t0 = performance.now();
    const tick = now => {
      const playing = allTfs().filter(t => t.playing);
      if (!playing.length) { animOn = false; return; }
      const phase = ((now - t0) % 3000) / 3000;            // 2s sweep, 1s hold at the end
      playing.forEach(tf => { tf.t = Math.min(1, phase / (2 / 3)); });
      draw(); requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------- pointer interaction: pan, drag points, drag shapes ---------- */
  const posOf = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function hitHandle(sx, sy) {
    let best = null, bd = 11;
    for (const pass of [true, false]) {
      for (let i = handles.length - 1; i >= 0; i--) {
        const h = handles[i]; if (h.draggable !== pass) continue;
        const [x, y] = toScreen(h.p[0], h.p[1]), d = Math.hypot(x - sx, y - sy);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) return best;
    }
    return null;
  }
  function inPoly(pt, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i][1] > pt[1]) !== (pts[j][1] > pt[1]) && pt[0] < (pts[j][0] - pts[i][0]) * (pt[1] - pts[i][1]) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
    }
    return c;
  }
  function hitShape(w) {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const it = state.items[i];
      if (it.visible && it._g && it._g.type === 'poly' && it._g.closed && inPoly(w, it._g.pts)) return it;
    }
    return null;
  }
  function syncText(it) {
    it.text = geomText(it._g);
    rowEls.get(it.id).querySelector('.expr-input').value = it.text;
    setStatus(it);
  }

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const [sx, sy] = posOf(e), w = toWorld(sx, sy);
    const h = hitHandle(sx, sy);
    if (h && h.draggable) drag = { type: 'handle', h, item: h.item };
    else if (!h && hitShape(w)) { const it = hitShape(w); drag = { type: 'shape', item: it, start: snapPt(w), orig: it._g.pts.map(p => p.slice()) }; }
    else drag = { type: 'pan', sx, sy, ox: state.view.ox, oy: state.view.oy };
  });
  cv.addEventListener('pointermove', e => {
    const [sx, sy] = posOf(e), w = toWorld(sx, sy);
    if (drag) {
      if (drag.type === 'pan') { state.view.ox = drag.ox + sx - drag.sx; state.view.oy = drag.oy + sy - drag.sy; }
      else if (drag.type === 'handle') {
        const p = snapPt(w); drag.item._g.pts[drag.h.idx] = p; drag.h.p = p; syncText(drag.item);
      } else if (drag.type === 'shape') {
        const cur = snapPt(w), dx = cur[0] - drag.start[0], dy = cur[1] - drag.start[1];
        drag.item._g.pts = drag.orig.map(p => [parseFloat((p[0] + dx).toFixed(6)), parseFloat((p[1] + dy).toFixed(6))]);
        syncText(drag.item);
      }
    } else {
      hover = hitHandle(sx, sy);
      cv.style.cursor = hover && hover.draggable ? 'grab' : hover ? 'default' : hitShape(w) ? 'move' : 'default';
    }
    draw();
  });
  const endDrag = () => { drag = null; scheduleSave(); draw(); };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { hover = null; draw(); });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const [sx, sy] = posOf(e);
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function zoomAt(sx, sy, k) {
    const v = state.view, ns = Math.min(5000, Math.max(2, v.scale * k)), r = ns / v.scale;
    v.ox = sx - (sx - v.ox) * r; v.oy = sy - (sy - v.oy) * r; v.scale = ns;
    draw(); scheduleSave();
  }
  $('zoomIn').onclick = () => zoomAt(W / 2, H / 2, 1.3);
  $('zoomOut').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.3);
  $('home').onclick = () => { state.view = { ox: W / 2, oy: H / 2, scale: 50 }; draw(); scheduleSave(); };
  $('snap').onchange = e => { state.snap = e.target.checked; scheduleSave(); };

  /* ---------- startup ---------- */
  function loadSaved() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && Array.isArray(s.items) && s.items.length) {
        state.items = s.items.map(i => {
          const it = { id: i.id, kind: 'expr', text: i.text || '', color: i.color, visible: i.visible !== false, transforms: [] };
          it._g = parseGeometry(it.text);
          it.transforms = (i.transforms || []).map(t => {
            const tf = { id: t.id, color: '#000000', visible: t.visible !== false, raw: Object.assign(IDENTITY_RAW(), t.raw), t: 1, playing: false, showName: !!t.showName, paths: !!t.paths };
            readMatrix(tf); return tf;
          });
          return it;
        });
        state.nextId = s.nextId || 100; state.colorIdx = s.colorIdx || 0;
        if (s.view && s.view.scale) state.view = s.view;
        state.snap = s.snap !== false;
        return true;
      }
    } catch (e) { /* ignore corrupt storage */ }
    return false;
  }
  function loadDemo() {
    const tri = newExpr('[(1,1),(4,1),(1,3)]');
    const tf = newTransform({ a: '0', b: '-1', e: '0', c: '1', d: '0', f: '0' });
    tf.showName = true;
    tri.transforms.push(tf);
    state.items = [tri];
  }

  if (!loadSaved()) loadDemo();
  $('snap').checked = state.snap;
  renderList();
  new ResizeObserver(resize).observe($('graph'));
  resize();
})();
