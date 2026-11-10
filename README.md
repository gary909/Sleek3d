# sleek3d

<img width="600" alt="Sleek3d 3d modeling software" src="https://github.com/user-attachments/assets/ef063c3b-e243-4b45-a883-c5b9a0369a4b" />

TO DO:

Add transparency/solid toggle

Add darker border to grid outline

Add shape icons to shape text

option for reference image?

Zoom In/Out buttons

Toggle to orthographic view (flat view)

initial view reset button

add 3d cube, drag to rotate view

ruler overlay

improve grid...  1cm as 1mm squares etc

front panel designer mode?

Option to add textures to objects? Could have this as a separate page/software?

remove 'tool' text from header and have move, rotate and scale sit on one line

radius/height options...  make as slider, with size mm/cm present 

Export...  opens window with .stl, .obj file export etc. View tri amount, option to decimate

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
| Select a shape | Click |
| Multi-select | Shift-click |
| Move / rotate / scale a shape | Drag the gizmo handles |
| Switch tool | W / E / R keys or panel buttons |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or buttons) |
| Duplicate | Ctrl/Cmd+D (or button) |
| Group / ungroup | Ctrl/Cmd+G / Ctrl/Cmd+Shift+G (or buttons) |
| Select all | Ctrl/Cmd+A |
| Frame selection | F |
| Toggle hole | H |
| Nudge selection | Arrow keys |
| Rotate the view | Right-drag |
| Pan | Middle-drag |
| Zoom | Scroll |
| Deselect | Escape |
| Delete selected | Del / Delete button |

## Features

- **Primitives** — box, cylinder, sphere, cone, torus, wedge, pyramid, hemisphere, prism, star (all drop in resting on the grid).
- **Editable dimensions** — select a shape to tweak its width/height/radius/points in the inspector.
- **Polish** — hover highlighting, image-based studio lighting + filmic tone mapping, and a major/minor grid.
- **Text** — add 3D extruded text (uses a bundled font).
- **Alignment** — align selected shapes to min / center / max on X, Y, and Z.
- **Transform gizmos** — draggable move / rotate / scale handles. Translation snaps to the grid (0.5 / 1 / 2 units), rotation snaps to 15°, and the Y handle lifts shapes vertically.
- **Select** — click to select, shift-click to multi-select.
- **Inspector** — uniform scale, color, solid/hole toggle, delete.
- **Undo / redo** — full history (add, delete, booleans, transforms, color, hole, scale) via Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or the panel buttons.
- **Duplicate / group** — Ctrl/Cmd+D duplicates; group multiple shapes (Ctrl/Cmd+G) and ungroup (Ctrl/Cmd+Shift+G). Booleans can also combine whole groups.
- **Save / load** — your work auto-saves to the browser and restores on reload; use "New" to start empty.
- **Booleans** — select two shapes (shift-click) then Union, Subtract, or Intersect.
  - *Subtract* cuts the second shape out of the first.
  - Mark a shape as a **Hole** (rendered translucent red) to use it as a cutter.
- **STL export** — 3D-print-ready ASCII STL of all shapes.
- **Seeded demo** — launches with a box-minus-cylinder (a tunnel) plus a sphere, so booleans are visible immediately.

## Project structure

```
src/
  main.js         bootstrap + render loop + app actions
  scene.js        renderer, camera, lights, ground/grid, Orbit/Transform controls
  shapes.js       primitive factories
  booleans.js     CSG wrapper (union / subtract / intersect)
  interaction.js  selection + keyboard shortcuts
  ui.js           toolbar/panel wiring + STL export
  history.js      undo/redo stack
  save.js         scene serialization + localStorage persistence
```

## How it works

Each shape is a `THREE.Mesh` with a `userData` flag (`solid`, `shapeType`). Boolean
operations are wrapped in `src/booleans.js`, which converts two meshes into CSG
"brushes" (baking their world transforms), evaluates the operation, re-centers the
result geometry, and returns a fresh mesh. Swapping the CSG backend (e.g. to
[`manifold-3d`](https://www.npmjs.com/package/manifold-3d) for more robust results on
complex geometry) only requires editing that one file.

## Roadmap

The core feature set is complete. Possible future ideas:

- History limits / snapshots
- Binary STL and GLTF export
- Per-face colors / multi-material
- Collaboration and cloud save
