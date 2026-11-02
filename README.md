# sleek3d

A minimal **Tinkercad-style 3D modelling** app built with plain HTML/CSS/JavaScript, [Three.js](https://threejs.org), and [three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) for boolean (CSG) operations.

## Quick start

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

Production build:

```bash
npm run build
npm run preview
```

## Controls

| Action | Input |
| --- | --- |
| Select a shape | Left-click |
| Multi-select | Shift-click |
| Move a shape (snapped to grid) | Left-drag |
| Rotate the view | Right-drag |
| Pan | Middle-drag |
| Zoom | Scroll |
| Deselect | Escape |
| Delete selected | Del / Delete button |

## Features

- **Primitives** — box, cylinder, sphere, cone, torus (all drop in resting on the grid).
- **Select & move** — click to select, drag on the ground plane with grid snapping (0.5 / 1 / 2 units).
- **Inspector** — rotate (X/Y/Z), uniform scale, color, solid/hole toggle, delete.
- **Booleans** — select two shapes (shift-click) then Union, Subtract, or Intersect.
  - *Subtract* cuts the second shape out of the first.
  - Mark a shape as a **Hole** (rendered translucent red) to use it as a cutter.
- **STL export** — 3D-print-ready ASCII STL of all shapes.
- **Seeded demo** — launches with a box-minus-cylinder (a tunnel) plus a sphere, so booleans are visible immediately.

## Project structure

```
src/
  main.js         bootstrap + render loop + app actions
  scene.js        renderer, camera, lights, ground/grid, OrbitControls
  shapes.js       primitive factories
  booleans.js     CSG wrapper (union / subtract / intersect)
  interaction.js  selection + drag-with-snap
  ui.js           toolbar/panel wiring + STL export
```

## How it works

Each shape is a `THREE.Mesh` with a `userData` flag (`solid`, `shapeType`). Boolean
operations are wrapped in `src/booleans.js`, which converts two meshes into CSG
"brushes" (baking their world transforms), evaluates the operation, re-centers the
result geometry, and returns a fresh mesh. Swapping the CSG backend (e.g. to
[`manifold-3d`](https://www.npmjs.com/package/manifold-3d) for more robust results on
complex geometry) only requires editing that one file.

## Roadmap (not yet implemented)

- Transform gizmos (drag arrows / rotation rings) instead of panel buttons
- Undo / redo (command pattern)
- Grouping, alignment, duplication
- More primitives and parametric shape generators
- Multiple groups / "group selected" like Tinkercad
