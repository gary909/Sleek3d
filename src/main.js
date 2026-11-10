import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import {
  createRenderer,
  createScene,
  createCamera,
  createLights,
  createGround,
  createControls,
  createTransformControls,
  handleResize,
  applyEnvironment,
} from './scene.js';
import { SHAPE_FACTORIES, SHAPE_DEFS, rebuildShapeGeometry } from './shapes.js';
import { booleanOperation, combineGroupToMesh } from './booleans.js';
import { createInteraction } from './interaction.js';
import { createUI } from './ui.js';
import { createHistory } from './history.js';
import { saveProject, loadProject, serializeScene, deserializeScene } from './save.js';
import { createTextMesh } from './text.js';

const container = document.getElementById('app');

const renderer = createRenderer(container);
const scene = createScene();
const camera = createCamera(container);
createLights(scene);
createGround(scene);
applyEnvironment(renderer, scene);

// Measurement label: a billboard sprite attached above the selected object.
const measureCanvas = document.createElement('canvas');
measureCanvas.width = 1024;
measureCanvas.height = 150;
const measureCtx = measureCanvas.getContext('2d');
const measureTexture = new THREE.CanvasTexture(measureCanvas);
measureTexture.minFilter = THREE.LinearFilter;
const measureSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: measureTexture, transparent: true, depthTest: false, depthWrite: false })
);
measureSprite.renderOrder = 999;
measureSprite.visible = false;
scene.add(measureSprite);

// Ruler (a line + distance chip shown while moving a shape).
const rulerGroup = new THREE.Group();
rulerGroup.visible = false;
scene.add(rulerGroup);

const rulerMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.06, 0.06, 1, 8),
  new THREE.MeshBasicMaterial({ color: 0xffb300, depthTest: false, side: THREE.DoubleSide })
);
rulerMesh.renderOrder = 998;
rulerGroup.add(rulerMesh);

// Tick marks (small perpendicular rods along the ruler).
const tickGroup = new THREE.Group();
rulerGroup.add(tickGroup);
const tickMaterial = new THREE.MeshBasicMaterial({ color: 0xffb300, depthTest: false, side: THREE.DoubleSide });
const TICK_COUNT = 40;
const ticks = [];
for (let i = 0; i < TICK_COUNT; i++) {
  const tick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6), tickMaterial);
  tick.renderOrder = 998;
  tick.visible = false;
  tickGroup.add(tick);
  ticks.push(tick);
}

const rulerCanvas = document.createElement('canvas');
rulerCanvas.width = 320;
rulerCanvas.height = 96;
const rulerCtx = rulerCanvas.getContext('2d');
const rulerTexture = new THREE.CanvasTexture(rulerCanvas);
rulerTexture.minFilter = THREE.LinearFilter;
const rulerSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: rulerTexture, transparent: true, depthTest: false, depthWrite: false })
);
rulerSprite.renderOrder = 999;
rulerGroup.add(rulerSprite);

const controls = createControls(camera, renderer.domElement);
const transformControls = createTransformControls(camera, renderer.domElement);
scene.add(transformControls.getHelper());
handleResize(renderer, camera, container);

const state = {
  shapes: [],
  selected: [],
  snap: 1,
};

const history = createHistory();

// "Before" snapshots for continuous inputs (scale slider / color picker) so a
// whole gesture collapses into a single undo step.
let scaleBefore = null;
let colorBefore = null;
let gizmoBefore = null;
let resizeGesture = null;
let nudgeGesture = null;
let moveStart = null;
let clipboard = null;

let saveTimer = null;

function getMeshes(object) {
  if (object.isMesh) return [object];
  const meshes = [];
  object.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  return meshes;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(state.shapes), 300);
}

const ui = createUI({
  state,
  onAdd: addShape,
  onScale,
  onScaleCommit,
  onColor,
  onColorCommit,
  onToggleHole,
  onDelete,
  onBoolean,
  onExport,
  onReset,
  onSnap,
  onSetMode,
  onUndo: performUndo,
  onRedo: performRedo,
  onDuplicate: duplicateSelected,
  onGroup: groupSelected,
  onUngroup: ungroupSelected,
  onNew,
  onParamChange,
  onParamCommit,
  onAlign: alignSelection,
  onCopy: copySelected,
  onPaste: pasteClipboard,
});

const interaction = createInteraction({
  renderer,
  camera,
  state,
  onSelectionChange: () => {
    ui.refresh();
    syncGizmo();
    updateMeasure();
  },
  onDelete,
  onSetMode,
  onUndo: performUndo,
  onRedo: performRedo,
  onDuplicate: duplicateSelected,
  onGroup: groupSelected,
  onUngroup: ungroupSelected,
  onSelectAll: selectAll,
  onNudge,
  onNudgeEnd,
  onToggleHoleKey: toggleHoleShortcut,
  onFocus: focusSelected,
  onCopy: copySelected,
  onPaste: pasteClipboard,
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});

transformControls.addEventListener('objectChange', () => {
  ui.refresh();
  updateMeasure();
  updateRuler();
});

transformControls.addEventListener('mouseDown', () => {
  const obj = transformControls.object;
  if (obj) {
    gizmoBefore = captureTransform(obj);
    if (transformControls.mode === 'translate') {
      moveStart = obj.position.clone();
      updateRuler();
    }
  }
});

transformControls.addEventListener('mouseUp', () => {
  const obj = transformControls.object;
  if (obj && gizmoBefore) {
    const after = captureTransform(obj);
    if (!transformsEqual(gizmoBefore, after)) {
      history.push(commandTransform(obj, gizmoBefore, after));
      updateHistoryUI();
      scheduleSave();
    }
  }
  gizmoBefore = null;
  moveStart = null;
  updateMeasure();
  updateRuler();
});

// ---- shape management -------------------------------------------------------

function addShape(type) {
  if (type === 'text') {
    addTextShape();
    return;
  }

  const mesh = SHAPE_FACTORIES[type]();
  scene.add(mesh);
  state.shapes.push(mesh);
  interaction.setSelected([mesh]);
  history.push(commandAdd(mesh));
  updateHistoryUI();
  scheduleSave();
}

async function addTextShape() {
  const text = window.prompt('Text to add', 'Sleek3d');
  if (!text || !text.trim()) return;
  const mesh = await createTextMesh(text.trim());
  scene.add(mesh);
  state.shapes.push(mesh);
  interaction.setSelected([mesh]);
  history.push(commandAdd(mesh));
  updateHistoryUI();
  scheduleSave();
}

function removeShape(object) {
  if (transformControls.object === object) transformControls.detach();
  scene.remove(object);
  state.shapes = state.shapes.filter((o) => o !== object);
  getMeshes(object).forEach((m) => {
    m.geometry.dispose();
    m.material.dispose();
  });
}

function setHole(mesh, isHole) {
  mesh.userData.solid = !isHole;
  if (isHole) {
    if (mesh.userData._prevColor == null) {
      mesh.userData._prevColor = mesh.material.color.getHex();
    }
    mesh.material.transparent = true;
    mesh.material.opacity = 0.35;
    mesh.material.depthWrite = false;
    mesh.material.color.set(0xd64545);
  } else {
    mesh.material.transparent = false;
    mesh.material.opacity = 1;
    mesh.material.depthWrite = true;
    if (mesh.userData._prevColor != null) {
      mesh.material.color.set(mesh.userData._prevColor);
    }
  }
}

// ---- gizmo -------------------------------------------------------------------

function syncGizmo() {
  const target = state.selected[0] ?? null;
  if (target) {
    if (transformControls.object !== target) transformControls.attach(target);
  } else {
    transformControls.detach();
  }
}

function onSetMode(mode) {
  transformControls.setMode(mode);
  ui.setActiveMode(mode);
}

// ---- history & commands -----------------------------------------------------

function captureTransform(mesh) {
  return {
    position: mesh.position.clone(),
    quaternion: mesh.quaternion.clone(),
    scale: mesh.scale.clone(),
  };
}

function applyTransform(mesh, t) {
  mesh.position.copy(t.position);
  mesh.quaternion.copy(t.quaternion);
  mesh.scale.copy(t.scale);
  mesh.rotation.setFromQuaternion(mesh.quaternion);
}

function transformsEqual(a, b) {
  return (
    a.position.equals(b.position) &&
    a.quaternion.equals(b.quaternion) &&
    a.scale.equals(b.scale)
  );
}

function setColor(mesh, hex) {
  mesh.material.color.setHex(hex);
  mesh.userData._prevColor = hex;
}

function commandAdd(mesh) {
  return {
    undo: () => removeShape(mesh),
    redo: () => {
      scene.add(mesh);
      state.shapes.push(mesh);
    },
  };
}

function commandDelete(meshes) {
  return {
    undo: () => {
      meshes.forEach((m) => {
        scene.add(m);
        state.shapes.push(m);
      });
    },
    redo: () => meshes.forEach(removeShape),
  };
}

function commandBoolean(a, b, result) {
  return {
    undo: () => {
      removeShape(result);
      scene.add(a);
      state.shapes.push(a);
      scene.add(b);
      state.shapes.push(b);
    },
    redo: () => {
      removeShape(a);
      removeShape(b);
      scene.add(result);
      state.shapes.push(result);
    },
  };
}

function commandTransform(mesh, before, after) {
  return {
    undo: () => applyTransform(mesh, before),
    redo: () => applyTransform(mesh, after),
  };
}

function commandScale(meshes, before, after) {
  return {
    undo: () => meshes.forEach((m, i) => m.scale.copy(before[i])),
    redo: () => meshes.forEach((m, i) => m.scale.copy(after[i])),
  };
}

function commandColor(meshes, before, after) {
  return {
    undo: () => meshes.forEach((m, i) => setColor(m, before[i])),
    redo: () => meshes.forEach((m, i) => setColor(m, after[i])),
  };
}

function commandHole(meshes, beforeIsHole, afterIsHole) {
  return {
    undo: () => meshes.forEach((m, i) => setHole(m, beforeIsHole[i])),
    redo: () => meshes.forEach((m, i) => setHole(m, afterIsHole[i])),
  };
}

function commandGroup(objects, group) {
  return {
    undo: () => {
      objects.forEach((o) => scene.attach(o));
      scene.remove(group);
      state.shapes = state.shapes.filter((o) => o !== group);
      state.shapes.push(...objects);
    },
    redo: () => {
      state.shapes = state.shapes.filter((o) => !objects.includes(o));
      scene.add(group);
      objects.forEach((o) => group.attach(o));
      state.shapes.push(group);
    },
  };
}

function commandUngroup(entries) {
  return {
    undo: () => {
      entries.forEach(({ group, children }) => {
        state.shapes = state.shapes.filter((o) => !children.includes(o));
        scene.add(group);
        children.forEach((c) => group.attach(c));
        state.shapes.push(group);
      });
    },
    redo: () => {
      entries.forEach(({ group, children }) => {
        children.forEach((c) => scene.attach(c));
        scene.remove(group);
        state.shapes = state.shapes.filter((o) => o !== group);
        state.shapes.push(...children);
      });
    },
  };
}

function commandReshape(mesh, beforeParams, afterParams) {
  return {
    undo: () => rebuildShapeGeometry(mesh, beforeParams),
    redo: () => rebuildShapeGeometry(mesh, afterParams),
  };
}

function updateHistoryUI() {
  ui.setHistoryState(history.canUndo(), history.canRedo());
}

function performUndo() {
  if (!history.canUndo()) return;
  history.undo();
  interaction.setSelected([]);
  updateHistoryUI();
  scheduleSave();
}

function performRedo() {
  if (!history.canRedo()) return;
  history.redo();
  interaction.setSelected([]);
  updateHistoryUI();
  scheduleSave();
}

// ---- inspector actions ------------------------------------------------------

function onScale(value) {
  if (!scaleBefore) {
    scaleBefore = new Map(state.selected.map((m) => [m, m.scale.clone()]));
  }
  state.selected.forEach((m) => m.scale.setScalar(value));
  updateMeasure();
}

function onScaleCommit() {
  if (!scaleBefore) return;
  const meshes = [...scaleBefore.keys()];
  const before = meshes.map((m) => scaleBefore.get(m));
  const after = meshes.map((m) => m.scale.clone());
  scaleBefore = null;

  if (meshes.some((m, i) => !before[i].equals(after[i]))) {
    history.push(commandScale(meshes, before, after));
    updateHistoryUI();
    scheduleSave();
  }
}

function onColor(hex) {
  const value = new THREE.Color(hex).getHex();
  const meshes = state.selected.flatMap(getMeshes);
  if (!colorBefore) {
    colorBefore = new Map(meshes.map((m) => [m, m.material.color.getHex()]));
  }
  meshes.forEach((m) => setColor(m, value));
}

function onColorCommit() {
  if (!colorBefore) return;
  const meshes = [...colorBefore.keys()];
  const before = meshes.map((m) => colorBefore.get(m));
  const after = meshes.map((m) => m.material.color.getHex());
  colorBefore = null;

  if (meshes.some((m, i) => before[i] !== after[i])) {
    history.push(commandColor(meshes, before, after));
    updateHistoryUI();
    scheduleSave();
  }
}

function editableMesh(object) {
  if (!object || !object.isMesh) return null;
  return SHAPE_DEFS[object.userData.shapeType] ? object : null;
}

function onParamChange(params) {
  const mesh = editableMesh(state.selected[0]);
  if (!mesh) return;
  if (!resizeGesture || resizeGesture.mesh !== mesh) {
    resizeGesture = { mesh, beforeParams: { ...mesh.userData.params } };
  }
  rebuildShapeGeometry(mesh, params);
  updateMeasure();
  scheduleSave();
}

function onParamCommit() {
  if (!resizeGesture) return;
  const { mesh, beforeParams } = resizeGesture;
  resizeGesture = null;
  const afterParams = { ...mesh.userData.params };
  if (JSON.stringify(beforeParams) !== JSON.stringify(afterParams)) {
    history.push(commandReshape(mesh, beforeParams, afterParams));
    updateHistoryUI();
  }
}

function onToggleHole(isHole) {
  const meshes = state.selected.flatMap(getMeshes);
  if (!meshes.length) return;
  const before = meshes.map((m) => !m.userData.solid);
  meshes.forEach((m) => setHole(m, isHole));
  history.push(commandHole(meshes, before, meshes.map(() => isHole)));
  updateHistoryUI();
  scheduleSave();
}

function onDelete() {
  const objects = [...state.selected];
  if (!objects.length) return;
  objects.forEach(removeShape);
  interaction.setSelected([]);
  history.push(commandDelete(objects));
  updateHistoryUI();
  scheduleSave();
}

// ---- booleans ---------------------------------------------------------------

function onBoolean(op) {
  if (state.selected.length !== 2) return;
  const [aOrig, bOrig] = state.selected;

  let a = aOrig;
  let b = bOrig;
  if (!a.isMesh) a = combineGroupToMesh(a);
  if (!b.isMesh) b = combineGroupToMesh(b);
  if (!a || !b) return;

  const result = booleanOperation(a, b, op);

  // Free temporary flattened meshes (their geometry is now baked into `result`).
  if (a !== aOrig) {
    a.geometry.dispose();
    a.material.dispose();
  }
  if (b !== bOrig) {
    b.geometry.dispose();
    b.material.dispose();
  }

  removeShape(aOrig);
  removeShape(bOrig);
  scene.add(result);
  state.shapes.push(result);
  interaction.setSelected([result]);
  history.push(commandBoolean(aOrig, bOrig, result));
  updateHistoryUI();
  scheduleSave();
}

// ---- duplicate / group / new -------------------------------------------------

function duplicateSelected() {
  const objects = [...state.selected];
  if (!objects.length) return;
  const clones = objects.map((o) => {
    const c = o.clone(true);
    c.position.x += state.snap;
    c.position.z += state.snap;
    return c;
  });
  clones.forEach((c) => {
    scene.add(c);
    state.shapes.push(c);
  });
  interaction.setSelected(clones);
  history.push(commandDelete(clones));
  updateHistoryUI();
  scheduleSave();
}

function copySelected() {
  if (!state.selected.length) return;
  clipboard = serializeScene(state.selected);
  ui.setClipboardState(true);
}

function pasteClipboard() {
  if (!clipboard) return;
  let objects;
  try {
    objects = deserializeScene(clipboard);
  } catch {
    return;
  }
  if (!objects.length) return;

  objects.forEach((o) => {
    o.position.x += state.snap;
    o.position.z += state.snap;
    scene.add(o);
    state.shapes.push(o);
    getMeshes(o).forEach((m) => {
      if (!m.userData.solid) setHole(m, true);
    });
  });

  interaction.setSelected(objects);
  history.push(commandDelete(objects));
  updateHistoryUI();
  scheduleSave();
}

function groupSelected() {
  const objects = [...state.selected];
  if (objects.length < 2) return;
  const group = new THREE.Group();
  scene.add(group);
  objects.forEach((o) => group.attach(o));
  state.shapes = state.shapes.filter((o) => !objects.includes(o));
  state.shapes.push(group);
  interaction.setSelected([group]);
  history.push(commandGroup(objects, group));
  updateHistoryUI();
  scheduleSave();
}

function ungroupSelected() {
  const groups = state.selected.filter((o) => o.isGroup);
  if (!groups.length) return;
  const entries = groups.map((group) => ({ group, children: [...group.children] }));
  const restored = entries.flatMap((e) => e.children);

  entries.forEach(({ group, children }) => {
    children.forEach((c) => scene.attach(c));
    scene.remove(group);
    state.shapes = state.shapes.filter((o) => o !== group);
  });
  state.shapes.push(...restored);

  interaction.setSelected(restored);
  history.push(commandUngroup(entries));
  updateHistoryUI();
  scheduleSave();
}

function onNew() {
  [...state.shapes].forEach(removeShape);
  interaction.setSelected([]);
  history.clear();
  updateHistoryUI();
  saveProject([]);
}

// ---- polish helpers ----------------------------------------------------------

function selectAll() {
  interaction.setSelected([...state.shapes]);
}

function onNudge(dx, dz) {
  const objects = [...state.selected];
  if (!objects.length) return;
  if (!nudgeGesture) {
    nudgeGesture = new Map(objects.map((o) => [o, captureTransform(o)]));
  }
  objects.forEach((o) => {
    o.position.x += dx;
    o.position.z += dz;
  });
  scheduleSave();
}

function onNudgeEnd() {
  if (!nudgeGesture) return;
  const entries = [...nudgeGesture.entries()];
  nudgeGesture = null;

  const changed = entries.some(([o, before]) => !transformsEqual(before, captureTransform(o)));
  if (!changed) return;

  const objects = entries.map(([o]) => o);
  const before = entries.map(([, b]) => b);
  const after = entries.map(([o]) => captureTransform(o));
  history.push({
    undo: () => objects.forEach((o, i) => applyTransform(o, before[i])),
    redo: () => objects.forEach((o, i) => applyTransform(o, after[i])),
  });
  updateHistoryUI();
}

function toggleHoleShortcut() {
  const meshes = state.selected.flatMap(getMeshes);
  if (!meshes.length) return;
  onToggleHole(meshes[0].userData.solid); // flip to opposite of the primary shape
}

function focusSelected() {
  if (!state.selected.length) return;
  const box = new THREE.Box3();
  state.selected.forEach((o) => {
    o.updateWorldMatrix(true, false);
    getMeshes(o).forEach((m) => box.expandByObject(m));
  });
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = Math.max(radius * 3, 4);

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.update();
}

// ---- alignment ---------------------------------------------------------------

function objectBox(object) {
  object.updateWorldMatrix(true, false);
  const box = new THREE.Box3();
  getMeshes(object).forEach((m) => box.expandByObject(m));
  return box;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Live measurement label, attached above the selected object (billboard sprite).
// Fixed-width fields + a fixed number of lines so the label never changes size.
function updateMeasure() {
  const object = state.selected[0];
  if (!object) {
    measureSprite.visible = false;
    return;
  }
  const box = objectBox(object);
  if (box.isEmpty()) {
    measureSprite.visible = false;
    return;
  }

  const size = box.getSize(new THREE.Vector3());
  const pos = object.position;

  const pad = 6;
  const fmt = (v) => v.toFixed(2).padStart(pad) + ' mm';
  const sep = ' · ';

  const sizeText = `W ${fmt(size.x)}${sep}D ${fmt(size.z)}${sep}H ${fmt(size.y)}`;
  const posText = `X ${fmt(pos.x)}${sep}Y ${fmt(pos.y)}${sep}Z ${fmt(pos.z)}`;

  const lines = [sizeText, posText];

  const font = 'bold 40px ui-monospace, Menlo, Consolas, monospace';
  measureCtx.font = font;
  let textWidth = 0;
  for (const line of lines) textWidth = Math.max(textWidth, measureCtx.measureText(line).width);

  const padX = 36;
  const lineH = 50;
  const padY = 20;
  const w = Math.ceil(textWidth + padX * 2);
  const h = padY * 2 + lines.length * lineH;

  if (measureCanvas.width !== w) measureCanvas.width = w;
  if (measureCanvas.height !== h) measureCanvas.height = h;

  measureCtx.font = font;
  measureCtx.textAlign = 'center';
  measureCtx.textBaseline = 'middle';
  measureCtx.clearRect(0, 0, w, h);
  measureCtx.fillStyle = 'rgba(20, 24, 28, 0.88)';
  roundedRect(measureCtx, 4, 4, w - 8, h - 8, 24);
  measureCtx.fill();
  measureCtx.fillStyle = '#ffffff';
  lines.forEach((line, i) => {
    measureCtx.fillText(line, w / 2, padY + lineH * (i + 0.5));
  });
  measureTexture.needsUpdate = true;

  const center = box.getCenter(new THREE.Vector3());
  measureSprite.position.set(center.x, box.max.y + 0.9, center.z);
  const worldHeight = 0.65;
  measureSprite.scale.set(worldHeight * (w / h), worldHeight, 1);
  measureSprite.visible = true;
}

// Draw the distance value into the ruler's chip texture.
function drawRulerText(text) {
  const ctx = rulerCtx;
  const w = rulerCanvas.width;
  const h = rulerCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20, 24, 28, 0.9)';
  roundedRect(ctx, 4, 4, w - 8, h - 8, 22);
  ctx.fill();
  ctx.fillStyle = '#ffb300';
  ctx.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  rulerTexture.needsUpdate = true;
}

// Live ruler: a line from the move-start point to the current position, with a
// distance chip at the midpoint. Only visible while a shape is being moved.
function updateRuler() {
  const object = state.selected[0];
  if (!moveStart || !object) {
    rulerGroup.visible = false;
    return;
  }
  const start = moveStart;
  const end = object.position;
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();

  if (len < 0.001) {
    rulerGroup.visible = false;
    return;
  }

  const d = dir.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const tickDir = new THREE.Vector3().crossVectors(d, up);
  if (tickDir.lengthSq() < 1e-6) tickDir.set(1, 0, 0);
  tickDir.normalize();
  const tickLen = 0.4;

  // Ruler rod from start to end.
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  rulerMesh.position.copy(mid);
  rulerMesh.scale.set(1, len, 1);
  rulerMesh.quaternion.setFromUnitVectors(up, d);

  // Tick marks: one at each end, plus one per unit along the ruler.
  const steps = [0];
  for (let s = 1; s < len; s += 1) steps.push(s);
  steps.push(len);

  let n = 0;
  for (const s of steps) {
    if (n >= ticks.length) break;
    const p = new THREE.Vector3().addVectors(start, d.clone().multiplyScalar(s));
    const tick = ticks[n];
    tick.visible = true;
    tick.position.copy(p);
    tick.quaternion.setFromUnitVectors(up, tickDir);
    tick.scale.set(1, tickLen, 1);
    n += 1;
  }
  for (let i = n; i < ticks.length; i++) ticks[i].visible = false;

  // Distance chip, offset to the side + up so it doesn't crowd the object.
  const chip = mid.clone().addScaledVector(tickDir, 0.9).addScaledVector(up, 0.4);
  rulerSprite.position.copy(chip);
  const worldHeight = 0.5;
  rulerSprite.scale.set(worldHeight * (rulerCanvas.width / rulerCanvas.height), worldHeight, 1);

  drawRulerText(len.toFixed(2) + ' mm');
  rulerGroup.visible = true;
}

function alignSelection(axis, mode) {
  const objects = [...state.selected];
  if (objects.length < 2) return;

  const combined = new THREE.Box3();
  objects.forEach((o) => combined.union(objectBox(o)));
  if (combined.isEmpty()) return;

  const reference =
    mode === 'min' ? combined.min[axis] :
    mode === 'max' ? combined.max[axis] :
    (combined.min[axis] + combined.max[axis]) / 2;

  const before = objects.map((o) => captureTransform(o));

  objects.forEach((o) => {
    const b = objectBox(o);
    const current =
      mode === 'min' ? b.min[axis] :
      mode === 'max' ? b.max[axis] :
      (b.min[axis] + b.max[axis]) / 2;
    o.position[axis] += reference - current;
  });

  const after = objects.map((o) => captureTransform(o));
  if (objects.some((o, i) => !transformsEqual(before[i], after[i]))) {
    history.push({
      undo: () => objects.forEach((o, i) => applyTransform(o, before[i])),
      redo: () => objects.forEach((o, i) => applyTransform(o, after[i])),
    });
    updateHistoryUI();
  }
  scheduleSave();
}

// ---- export / reset / snap --------------------------------------------------

function onExport() {
  const exporter = new STLExporter();
  const group = new THREE.Group();
  state.shapes.forEach((o) => group.add(o.clone(true)));
  group.updateMatrixWorld(true);
  const data = exporter.parse(group);
  download('sleek3d-model.stl', data);
}

function onReset() {
  [...state.shapes].forEach(removeShape);
  seedDemo();
  interaction.setSelected([]);
  history.clear();
  updateHistoryUI();
  scheduleSave();
}

function onSnap(value) {
  state.snap = value;
  transformControls.setTranslationSnap(value);
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- seeded demo ------------------------------------------------------------

function seedDemo() {
  // A box with a cylindrical tunnel through it (subtraction demo).
  const box = SHAPE_FACTORIES.box({ w: 3, h: 1.5, d: 2 });
  box.position.set(0, 0.75, 0);

  const cutter = SHAPE_FACTORIES.cylinder({ r: 0.6, h: 4 });
  cutter.position.set(0, 0.75, 0);
  cutter.rotation.x = Math.PI / 2; // horizontal, through the box

  scene.add(box, cutter);
  box.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  const result = booleanOperation(box, cutter, 'subtract');
  removeShape(box);
  removeShape(cutter);
  scene.add(result);
  state.shapes.push(result);

  // A free-standing sphere.
  const sphere = SHAPE_FACTORIES.sphere({ r: 0.9 });
  sphere.position.set(2.5, 0.9, 1.5);
  scene.add(sphere);
  state.shapes.push(sphere);
}

// ---- boot -------------------------------------------------------------------

const loaded = loadProject();
if (loaded && loaded.length) {
  loaded.forEach((obj) => {
    scene.add(obj);
    state.shapes.push(obj);
    getMeshes(obj).forEach((m) => {
      if (!m.userData.solid) setHole(m, true);
    });
  });
} else {
  seedDemo();
}
ui.refresh();
updateHistoryUI();
ui.setClipboardState(false);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
