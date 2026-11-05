// Run with: node tests/math.test.js
const assert = require('assert');
const MG = require('../math.js');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);
const closePt = (p, q, msg) => { close(p[0], q[0], msg); close(p[1], q[1], msg); };

// expression evaluator
close(MG.evaluate('2+3*4'), 14);
close(MG.evaluate('2x', { x: 5 }), 10);
close(MG.evaluate('-2^2'), -4);
close(MG.evaluate('pi/2'), Math.PI / 2);
close(MG.evaluate('sin(pi/2)^2'), 1);
close(MG.evaluate('sqrt(16)'), 4);
assert.throws(() => MG.evaluate('2+'));
assert.throws(() => MG.evaluate('q'));
assert.throws(() => MG.evaluate('(1'));

// geometry parser
assert.strictEqual(MG.parseGeometry('   '), null);
assert.deepStrictEqual(MG.parseGeometry('(2, 3)'), { type: 'point', pts: [[2, 3]] });
let g = MG.parseGeometry('[(0,0),(2,0),(1,sqrt(4))]');
assert.strictEqual(g.type, 'poly'); assert.ok(g.closed); assert.strictEqual(g.pts.length, 3);
g = MG.parseGeometry('(0,0),(1,0)');
assert.strictEqual(g.type, 'poly'); assert.ok(!g.closed);
g = MG.parseGeometry('polygon((0,0),(1,0),(1,1))');
assert.strictEqual(g.type, 'poly');
g = MG.parseGeometry('y=2x+1');
assert.strictEqual(g.type, 'line'); closePt(g.p, [-0.4, 0.2]); close(g.d[1] / g.d[0], 2 , 'slope');
g = MG.parseGeometry('x=3');
assert.strictEqual(g.type, 'line'); close(g.p[0], 3); close(g.d[0], 0);
g = MG.parseGeometry('2x+3y=6');
assert.strictEqual(g.type, 'line');
assert.strictEqual(MG.parseGeometry('y=x^2').type, 'error');
assert.strictEqual(MG.parseGeometry('hello').type, 'error');
assert.strictEqual(MG.parseGeometry('(1,2,3)').type, 'error');

// recognising transformations
const M = (a, b, c, d, e = 0, f = 0) => ({ a, b, c, d, e, f });
const kind = m => MG.classify(m).kind;
const name = m => MG.classify(m).name;
const s2 = Math.SQRT1_2;
assert.strictEqual(kind(M(1, 0, 0, 1)), 'identity');
assert.strictEqual(kind(M(1, 0, 0, 1, 3, 2)), 'translation');
assert.strictEqual(name(M(1, 0, 0, 1, 3, 2)), 'Translation by (3, 2)');
assert.strictEqual(name(M(0, -1, 1, 0)), 'Rotation by 90° counter-clockwise');
assert.strictEqual(name(M(0, 1, -1, 0)), 'Rotation by 90° clockwise');
assert.strictEqual(kind(M(-1, 0, 0, -1)), 'dilation');
assert.ok(/180/.test(name(M(-1, 0, 0, -1))));
assert.strictEqual(name(M(2, 0, 0, 2)), 'Dilation by 2');
assert.strictEqual(kind(M(s2, -s2, s2, s2)), 'rotation');
assert.strictEqual(kind(M(2, -2, 2, 2)), 'rotation-dilation');
assert.ok(/x-axis/.test(name(M(1, 0, 0, -1))));
assert.ok(/y-axis/.test(name(M(-1, 0, 0, 1))));
assert.ok(/y = x$/.test(name(M(0, 1, 1, 0))));
assert.ok(/y = -x$/.test(name(M(0, -1, -1, 0))));
assert.strictEqual(name(M(2, 0, 0, 1)), 'Horizontal stretch by factor 2');
assert.strictEqual(name(M(1, 0, 0, 0.5)), 'Vertical compression by factor 0.5');
assert.strictEqual(name(M(2, 0, 0, 3)), 'Stretch: x by 2, y by 3');
assert.strictEqual(name(M(1, 2, 0, 1)), 'Horizontal shear, k = 2');
assert.strictEqual(name(M(1, 0, 3, 1)), 'Vertical shear, k = 3');
assert.ok(/Projection onto the line y = 0/.test(name(M(1, 0, 0, 0))));
assert.ok(/Projection onto the line y = x$/.test(name(M(0.5, 0.5, 0.5, 0.5))));
assert.strictEqual(kind(M(1, 1, 0, 0)), 'oblique');
assert.strictEqual(kind(M(1, 2, 2, 4)), 'singular');
assert.strictEqual(kind(M(0, 0, 0, 0)), 'zero');
assert.strictEqual(kind(M(1, 2, 3, 4)), 'general');
// rotation about a point: 90° about (1,1) is [[0,-1],[1,0]] with t = (2,0)
assert.strictEqual(name(M(0, -1, 1, 0, 2, 0)), 'Rotation by 90° counter-clockwise about (1, 1)');
assert.strictEqual(name(M(2, 0, 0, 2, -1, -1)), 'Dilation by 2 about (1, 1)');
// reflection / projection across a line that misses the origin
assert.strictEqual(name(M(1, 0, 0, -1, 0, 2)), 'Reflection across the line y = 1');
assert.strictEqual(name(M(1, 0, 0, 0, 0, 1)), 'Projection onto the line y = 1');
assert.ok(/followed by translation/.test(name(M(1, 0, 0, -1, 3, 0))));
assert.ok(/followed by translation/.test(name(M(1, 2, 0, 1, 1, 1))));

// interpolation
const R90 = M(0, -1, 1, 0);
closePt(MG.applyPt(MG.interpolate(R90, 0.5), [1, 0]), [s2, s2], 'half rotation');
closePt(MG.applyPt(MG.interpolate(M(1, 0, 0, 1, 4, 2), 0.5), [0, 0]), [2, 1], 'half translation');
const mid = MG.applyPt(MG.interpolate(M(0, -1, 1, 0, 2, 0), 0.5), [2, 1]);
close(Math.hypot(mid[0] - 1, mid[1] - 1), 1, 'stays on circle around (1,1)');

// applying to geometry
const T = MG.applyToGeom;
closePt(T(R90, { type: 'point', pts: [[1, 0]] }).pts[0], [0, 1]);
const proj = M(1, 0, 0, 0);
const collapsed = T(proj, MG.parseGeometry('x=2'));
assert.strictEqual(collapsed.type, 'point'); closePt(collapsed.pts[0], [2, 0]);
assert.strictEqual(T(M(1, 0, 0, 1, 1, 1), MG.parseGeometry('y=x')).type, 'line');
close(MG.det(R90), 1);

console.log('All math tests passed.');
