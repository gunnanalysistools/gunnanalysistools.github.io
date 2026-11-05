# Matrix Grapher — Documentation

An interactive, Desmos-style graphing tool for seeing linear and affine transformations: rotations, reflections, dilations, stretches, shears, translations, and projection ("mapping") onto a line.

## Running it

No install or build step. Open `matrix-grapher.html` in a browser. To host it, upload the folder to any static host (e.g. GitHub Pages).

Run the math tests with Node: `node tests/math.test.js`

## Decisions

| Topic | Decision |
|---|---|
| Tech stack | Plain HTML/CSS/JS, no framework or build |
| Making shapes | Typed in rows, Desmos-style, and dragged on the graph. There are **no drawing modes** (point/polygon/line tools were removed in v2) |
| Transformations | Attached to a shape: **+ matrix transformation** under the shape. You type the matrix; the app **recognizes** what it is |
| Mapping to a line | Orthogonal projection, recognized automatically from a rank-1 symmetric idempotent matrix |
| Not included (yet) | Dark mode, share links, undo/redo, click-to-draw |

## Files

| File | Purpose |
|---|---|
| `matrix-grapher.html` | Page layout: sidebar, graph canvas, zoom buttons, help dialog |
| `style.css` | Desmos-like look |
| `math.js` | DOM-free math: expression evaluator, geometry parser, `classify` (what does this matrix do?), `interpolate` (animation), `applyToGeom`. Browser (`window.MG`) and Node |
| `app.js` | UI: rows, transformation cards, canvas drawing, dragging, animation, autosave |
| `tests/math.test.js` | Unit tests for `math.js` (`node tests/math.test.js`) |

## Using the app

### 1. Make a shape (type it in a row)
- Point: `(2, 3)`. Numbers may be expressions: `(pi/2, sqrt(3))`.
- Polygon: `[(0,0),(3,0),(0,2)]` or `polygon((0,0),(3,0),(0,2))`. Two points make a segment.
- Line: `y=2x+1`, `x=3`, `2x+3y=6` (straight lines only).
- Drag points, or a whole polygon, on the graph; the row text updates. **Snap to grid** is bottom-left.

### 2. Transform it
Press **+ matrix transformation** under a shape. A card appears with a 3×3 matrix:

```
| a  b  e |      x' = a·x + b·y + e
| c  d  f |      y' = c·x + d·y + f
| 0  0  1 |
```
`a b c d` are the 2×2 part; `e f` is the shift (translation). Boxes accept expressions (`cos(pi/4)`, `1/2`); a red box means it couldn't be read, and the last good value is used.

- The card works out the **type** of transformation from the numbers. Tick **Show transformation name** to display it on the card and on the graph.
- **Presets…** fills in common matrices. ▶ animates from "nothing" to the full transformation.
- **Dashed paths** draws a line from each point to its image (always on for matrices that flatten onto a line).
- Add several transformations to one shape to **chain** them: each applies to the previous one's result.
- The colored circle hides/shows the original or each image.
- **Colors:** each shape has one color. The original is drawn as a light tint of it, the first transformed image in the full color, and each further chained step a bit darker, so before/after is easy to tell apart. The original is also drawn solid with filled points, and every image dashed with hollow points.
- The empty row at the bottom has no delete button (there is always one empty row ready).

### Navigation
Drag background to pan, scroll to zoom, `+`/`−`/`⌂` on the right.

## How a matrix is recognized (`classify` in `math.js`)

| Matrix looks like | Named |
|---|---|
| identity | Identity |
| identity + shift | Translation by (e, f) |
| `[[c,-s],[s,c]]` with r=1 | Rotation by θ (about a center if a shift is present) |
| `[[k,0],[0,k]]` | Dilation by k (about a center if shifted) |
| rotation × scale | Rotation and dilation |
| `[[c,s],[s,-c]]` (symmetric, det −1) | Reflection across a line (line equation shown) |
| `[[a,0],[0,d]]` | Horizontal / vertical stretch or compression, or both |
| `[[1,k],[0,1]]` / `[[1,0],[k,1]]` | Horizontal / vertical shear |
| symmetric, `M·M = M`, det 0 | Projection onto a line (mapping to a line) |
| `M·M = M`, det 0, not symmetric | Oblique projection |
| other det 0 | Maps the whole plane onto a line |
| anything else | General linear transformation |

A shift on a rotation or dilation is converted into its fixed point ("about (1, 1)"); a shift perpendicular to a reflection/projection line moves the line. Other shifts are reported as "followed by translation".

**Lines** are stored as a point + direction. If a transformation collapses the direction to zero (e.g. a vertical line projected onto the x-axis) the image is a single point.

## Architecture notes

- `state.items` is an ordered list of shape rows: `{text, color, visible, _g (parsed geometry), transforms: [...]}`. A transformation is `{raw (typed strings), M (numbers), color, visible, showName, paths, t, playing}`.
- `compute()` walks each shape's transformations in order, producing `{src, img}` steps; `draw()` repaints the whole canvas (grid → dashed paths → shapes → images/names → hover label) and rebuilds the hit-test handles.
- Editing text/matrix boxes never rebuilds the sidebar (keeps keyboard focus); only add/remove does.
- State autosaves to `localStorage` (key `matrix-grapher-v2`).

### Extending
To recognize a new kind of matrix, add a branch in `classifyLinear` in `math.js` and a test in `tests/math.test.js`. To add a preset, add to `PRESETS` in `app.js`.

## Status and known limitations

- Math layer is unit-tested; the UI was checked by loading it in headless Chrome (graph draws, no console errors). Interactive behaviour (dragging, animation) deserves a manual try.
- v1 had a startup bug that stopped everything from drawing; it was fixed by the v2 rewrite.
- No undo/redo, dark mode, share links, or click-to-draw. Only points, polygons and straight lines.
- No pinch-zoom on touch devices.

## Ideas for next steps
Undo/redo, dark mode, share via URL, draggable basis vectors (î, ĵ), unit-square/grid-warp view, composite matrix of a chain, inverse matrix, vector arrows.
