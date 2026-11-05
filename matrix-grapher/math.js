/* Matrix Grapher — math layer (no DOM).
 * Expression parser, geometry parser, transformation matrices.
 * Works in the browser (window.MG) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  /* ---------- number formatting ---------- */
  function fmt(n, d) {
    if (d === undefined) d = 3;
    const v = parseFloat(Number(n).toFixed(d));
    return Object.is(v, -0) ? '0' : String(v);
  }

  /* ---------- tiny expression evaluator ---------- */
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, exp: Math.exp,
  };
  const CONSTS = { pi: Math.PI, e: Math.E };
  const NAMES = Object.keys(FUNCS).concat(Object.keys(CONSTS)).sort((a, b) => b.length - a.length);

  function tokenize(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      const rest = s.slice(i);
      let m = /^(\d+\.?\d*|\.\d+)/.exec(rest);
      if (m) { out.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
      if ('+-*/^()'.indexOf(ch) >= 0) { out.push({ t: ch }); i++; continue; }
      if (/[a-z]/i.test(ch)) {
        const low = rest.toLowerCase();
        const name = NAMES.find(n => low.startsWith(n));
        if (name) { out.push({ t: 'id', v: name }); i += name.length; }
        else { out.push({ t: 'id', v: ch.toLowerCase() }); i++; }
        continue;
      }
      throw new Error("Unexpected '" + ch + "'");
    }
    return out;
  }

  /** Evaluate a math expression. vars: optional {x: 1, y: 2}. Supports + - * / ^, implicit multiplication (2x), pi, e, sin, cos, ... */
  function evaluate(str, vars) {
    vars = vars || {};
    const toks = tokenize(str);
    let pos = 0;
    const peek = () => toks[pos];

    function expr() {
      let v = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        const op = toks[pos++].t;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      let v = unary();
      for (;;) {
        const k = peek();
        if (!k) break;
        if (k.t === '*') { pos++; v *= unary(); }
        else if (k.t === '/') { pos++; v /= unary(); }
        else if (k.t === 'num' || k.t === 'id' || k.t === '(') v *= power(); // implicit multiplication
        else break;
      }
      return v;
    }
    function unary() {
      const k = peek();
      if (k && k.t === '-') { pos++; return -unary(); }
      if (k && k.t === '+') { pos++; return unary(); }
      return power();
    }
    function power() {
      const base = atom();
      if (peek() && peek().t === '^') { pos++; return Math.pow(base, unary()); }
      return base;
    }
    function atom() {
      const k = toks[pos++];
      if (!k) throw new Error('Incomplete expression');
      if (k.t === 'num') return k.v;
      if (k.t === '(') {
        const v = expr();
        if (!peek() || peek().t !== ')') throw new Error('Missing )');
        pos++;
        return v;
      }
      if (k.t === 'id') {
        if (FUNCS[k.v]) return FUNCS[k.v](peek() && peek().t === '(' ? atom() : power());
        if (Object.prototype.hasOwnProperty.call(CONSTS, k.v)) return CONSTS[k.v];
        if (Object.prototype.hasOwnProperty.call(vars, k.v)) return vars[k.v];
        throw new Error("Unknown name '" + k.v + "'");
      }
      throw new Error("Unexpected '" + k.t + "'");
    }

    const v = expr();
    if (pos < toks.length) throw new Error("Unexpected '" + toks[pos].t + (toks[pos].v !== undefined ? toks[pos].v : '') + "'");
    if (!isFinite(v)) throw new Error('Not a finite number');
    return v;
  }

  /* ---------- geometry parser ---------- */
  function splitTop(s) {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { depth--; if (depth < 0) throw new Error('Unbalanced brackets'); }
      else if (c === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    if (depth !== 0) throw new Error('Unbalanced brackets');
    parts.push(s.slice(start));
    return parts;
  }

  function parsePoint(s) {
    if (s[0] !== '(' || s[s.length - 1] !== ')') throw new Error('Points look like (2, 3)');
    const parts = splitTop(s.slice(1, -1));
    if (parts.length !== 2) throw new Error('A point needs exactly two numbers, like (2, 3)');
    return [evaluate(parts[0]), evaluate(parts[1])];
  }

  function parseLine(s) {
    const sides = s.split('=');
    if (sides.length !== 2) throw new Error('Use one "=" sign, like y=2x+1');
    const F = (x, y) => evaluate(sides[0], { x, y }) - evaluate(sides[1], { x, y });
    const C = F(0, 0), A = F(1, 0) - C, B = F(0, 1) - C;
    const tol = 1e-7 * (1 + Math.abs(A) + Math.abs(B) + Math.abs(C));
    if (Math.abs(F(2, 3) - (C + 2 * A + 3 * B)) > tol || Math.abs(F(-1.5, 4) - (C - 1.5 * A + 4 * B)) > tol)
      throw new Error('Only straight lines for now, like y=2x+1 or x=3');
    const n2 = A * A + B * B;
    if (n2 < 1e-18) throw new Error('That is not a line');
    return { type: 'line', p: [-A * C / n2, -B * C / n2], d: [-B, A] };
  }

  /** Parse text from an expression row. Returns null (empty), {type:'error',message}, or a geometry:
   *  {type:'point',pts:[p]} | {type:'poly',pts,closed} | {type:'line',p,d} */
  function parseGeometry(text) {
    const s = text.replace(/\s+/g, '');
    if (!s) return null;
    try {
      if (s.indexOf('=') >= 0) return parseLine(s);
      let body = s;
      const m = /^polygon\((.*)\)$/i.exec(s);
      if (m) body = '[' + m[1] + ']';
      if (body[0] === '[') {
        if (body[body.length - 1] !== ']') throw new Error('Missing ]');
        const pts = splitTop(body.slice(1, -1)).map(parsePoint);
        if (pts.length === 1) return { type: 'point', pts };
        return { type: 'poly', pts, closed: pts.length >= 3 };
      }
      if (body[0] === '(') {
        const parts = splitTop(body);
        if (parts.length === 1) return { type: 'point', pts: [parsePoint(body)] };
        const pts = parts.map(parsePoint);
        return { type: 'poly', pts, closed: pts.length >= 3 };
      }
      throw new Error('Try (2,3), [(0,0),(3,0),(0,2)] or y=2x+1');
    } catch (e) {
      return { type: 'error', message: e.message };
    }
  }

  /* ---------- affine matrices: x' = a x + b y + e ; y' = c x + d y + f ---------- */
  const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const det = M => M.a * M.d - M.b * M.c;
  const hasTranslation = M => Math.abs(M.e) > 1e-9 || Math.abs(M.f) > 1e-9;

  /** Linear part L = [[a,b],[c,d]] applied about the point (px,py). */
  function about(a, b, c, d, px, py) {
    return { a, b, c, d, e: px - (a * px + b * py), f: py - (c * px + d * py) };
  }
  const lerpM = (M, t) => ({
    a: 1 + t * (M.a - 1), b: t * M.b, c: t * M.c, d: 1 + t * (M.d - 1), e: t * M.e, f: t * M.f,
  });

  /** Matrix at progress t (0 = nothing yet, 1 = full). Pure rotations turn properly; everything else blends linearly. */
  function interpolate(M, t) {
    if (t >= 1) return M;
    const info = classify(M);
    if (info.kind === 'rotation') return about(Math.cos(info.theta * t), -Math.sin(info.theta * t), Math.sin(info.theta * t), Math.cos(info.theta * t), info.center[0], info.center[1]);
    return lerpM(M, t);
  }

  /* ---------- recognising what a matrix does ---------- */
  const EPS = 1e-9;
  const eq = (x, y) => Math.abs(x - y) < EPS;
  const norm180 = th => { th = th % Math.PI; return th < -EPS ? th + Math.PI : (th > Math.PI - EPS ? 0 : (th < 0 ? 0 : th)); };

  /** Equation text for the line through (x0,y0) at angle th (radians, 0..π). */
  function lineEq(th, x0, y0) {
    if (eq(th, Math.PI / 2)) return eq(x0, 0) ? 'x = 0 (the y-axis)' : 'x = ' + fmt(x0);
    const m = Math.tan(th), b = y0 - m * x0;
    if (eq(m, 0)) return eq(b, 0) ? 'y = 0 (the x-axis)' : 'y = ' + fmt(b);
    const ms = eq(m, 1) ? '' : eq(m, -1) ? '-' : fmt(m);
    return 'y = ' + ms + 'x' + (eq(b, 0) ? '' : (b > 0 ? ' + ' : ' - ') + fmt(Math.abs(b)));
  }
  const degText = rad => fmt(rad * 180 / Math.PI, 2) + '°';

  function classifyLinear(a, b, c, d) {
    const D = a * d - b * c;
    if (eq(a, 0) && eq(b, 0) && eq(c, 0) && eq(d, 0)) return { kind: 'zero', name: 'Collapses everything to the origin' };
    if (Math.abs(D) < EPS) {
      const aa = a * a + b * c, bb = a * b + b * d, cc = c * a + d * c, dd = c * b + d * d;
      if (eq(aa, a) && eq(bb, b) && eq(cc, c) && eq(dd, d)) {
        if (eq(b, c)) {
          const th = norm180(0.5 * Math.atan2(2 * b, a - d));
          return { kind: 'projection', theta: th, name: 'Projection onto the line ' + lineEq(th, 0, 0), mk: (x, y) => 'Projection onto the line ' + lineEq(th, x, y) };
        }
        return { kind: 'oblique', name: 'Oblique projection onto a line' };
      }
      return { kind: 'singular', name: 'Maps the whole plane onto a line' };
    }
    if (eq(a, d) && eq(b, -c)) {                       // rotation (and maybe scaling)
      const r = Math.hypot(a, c), th = Math.atan2(c, a);
      if (eq(th, 0)) return { kind: 'dilation', k: r, name: 'Dilation by ' + fmt(r) };
      if (eq(Math.abs(th), Math.PI)) return { kind: 'dilation', k: -r, name: eq(r, 1) ? 'Rotation by 180° (point reflection)' : 'Dilation by ' + fmt(-r) + ' (also flips through the center)' };
      const rot = 'Rotation by ' + degText(Math.abs(th)) + (th > 0 ? ' counter-clockwise' : ' clockwise');
      if (eq(r, 1)) return { kind: 'rotation', theta: th, name: rot };
      return { kind: 'rotation-dilation', name: rot + ' and dilation by ' + fmt(r) };
    }
    if (eq(a, -d) && eq(b, c)) {                       // reflection (and maybe scaling)
      const r = Math.hypot(a, c), th = norm180(0.5 * Math.atan2(c, a));
      const scale = eq(r, 1) ? '' : ' with scaling by ' + fmt(r);
      return { kind: eq(r, 1) ? 'reflection' : 'reflection-dilation', theta: th, r, name: 'Reflection across the line ' + lineEq(th, 0, 0) + scale, mk: (x, y) => 'Reflection across the line ' + lineEq(th, x, y) + scale };
    }
    if (eq(b, 0) && eq(c, 0)) {                        // stretch along the axes
      const one = (dir, v) => dir + ' ' + (Math.abs(v) < 1 ? 'compression' : 'stretch') + ' by factor ' + fmt(v);
      if (eq(a, 1)) return { kind: 'stretch', name: one('Vertical', d) };
      if (eq(d, 1)) return { kind: 'stretch', name: one('Horizontal', a) };
      return { kind: 'stretch', name: 'Stretch: x by ' + fmt(a) + ', y by ' + fmt(d) };
    }
    if (eq(a, 1) && eq(d, 1) && eq(c, 0)) return { kind: 'shear', name: 'Horizontal shear, k = ' + fmt(b) };
    if (eq(a, 1) && eq(d, 1) && eq(b, 0)) return { kind: 'shear', name: 'Vertical shear, k = ' + fmt(c) };
    return { kind: 'general', name: 'General linear transformation (det = ' + fmt(D) + ')' };
  }

  /** Work out what kind of transformation a matrix is. Returns {kind, name, ...}. */
  function classify(M) {
    const { a, b, c, d, e, f } = M;
    const tr = hasTranslation(M);
    if (eq(a, 1) && eq(b, 0) && eq(c, 0) && eq(d, 1))
      return tr ? { kind: 'translation', name: 'Translation by (' + fmt(e) + ', ' + fmt(f) + ')' } : { kind: 'identity', name: 'Identity (nothing changes)' };
    const res = classifyLinear(a, b, c, d);
    if (res.kind === 'rotation') res.center = [0, 0];
    if (!tr) return res;
    const dd = (1 - a) * (1 - d) - b * c;
    if ((res.kind === 'rotation' || res.kind === 'dilation' || res.kind === 'rotation-dilation') && Math.abs(dd) > EPS) {
      const px = (e * (1 - d) + b * f) / dd, py = ((1 - a) * f + c * e) / dd;
      if (res.kind === 'rotation') res.center = [px, py];
      res.name += ' about (' + fmt(px) + ', ' + fmt(py) + ')';
      return res;
    }
    if ((res.kind === 'reflection' || res.kind === 'projection' || res.kind === 'reflection-dilation') && res.mk) {
      const n = [-Math.sin(res.theta), Math.cos(res.theta)];
      if (Math.abs(e * n[1] - f * n[0]) < 1e-7 * (1 + Math.hypot(e, f))) {
        const s = res.kind === 'projection' ? 1 : 0.5;
        res.name = res.mk(e * s, f * s);
        return res;
      }
    }
    res.name += ' followed by translation (' + fmt(e) + ', ' + fmt(f) + ')';
    return res;
  }

  /* ---------- applying a matrix to geometry ---------- */
  const applyPt = (M, p) => [M.a * p[0] + M.b * p[1] + M.e, M.c * p[0] + M.d * p[1] + M.f];

  function applyToGeom(M, g) {
    if (g.type === 'point' || g.type === 'poly') {
      return Object.assign({}, g, { pts: g.pts.map(p => applyPt(M, p)) });
    }
    if (g.type === 'line') {
      const p = applyPt(M, g.p), d = [M.a * g.d[0] + M.b * g.d[1], M.c * g.d[0] + M.d * g.d[1]];
      if (Math.hypot(d[0], d[1]) < 1e-9) return { type: 'point', pts: [p] }; // line collapsed to a point
      return { type: 'line', p, d };
    }
    return g;
  }

  const api = {
    fmt, evaluate, parseGeometry, IDENTITY, interpolate, classify,
    applyPt, applyToGeom, det, hasTranslation,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MG = api;
})(typeof window !== 'undefined' ? window : globalThis);
