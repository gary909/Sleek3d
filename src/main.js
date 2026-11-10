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
  GRID_BASE_SIZE,
} from './scene.js';
import { SHAPE_FACTORIES, SHAPE_DEFS, rebuildShapeGeometry, bakeScaleIntoParams } from './shapes.js';
import { booleanOperation, combineGroupToMesh } from './booleans.js';
import { createInteraction } from './interaction.js';
import { createUI, createSettingsPanel } from './ui.js';
import { createHistory } from './history.js';
import { saveProject, loadProject, serializeScene, deserializeScene } from './save.js';
import { createTextMesh } from './text.js';
import { loadSettings, saveSettings, getUnit, formatLength, SNAP_VALUES, snapLabel } from './settings.js';

const container = document.getElementById('app');

const renderer = createRenderer(container);
const scene = createScene();
const camera = createCamera(container);
const lights = createLights(scene);
const { gridGroup } = createGround(scene);
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

// Ruler overlays: a floating readout chip plus mode-specific 3D guides shown
// while a shape is being moved / rotated / scaled.
const rulerGroup = new THREE.Group();
rulerGroup.visible = false;
scene.add(rulerGroup);

const UP = new THREE.Vector3(0, 1, 0);

const rulerMaterial = new THREE.MeshBasicMaterial({ color: 0xffb300, depthTest: false, side: THREE.DoubleSide });

// Move: a rod from the start point to the current position, with tick marks.
const moveGroup = new THREE.Group();
rulerGroup.add(moveGroup);

const rulerMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), rulerMaterial);
rulerMesh.renderOrder = 998;
moveGroup.add(rulerMesh);

// Tick marks (small perpendicular rods along the ruler).
const tickGroup = new THREE.Group();
moveGroup.add(tickGroup);
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

// Rotate: a 3D arc (tube) spanning the swept angle, plus start/end radius lines.
const rotateGroup = new THREE.Group();
rotateGroup.visible = false;
rulerGroup.add(rotateGroup);

const arcMesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 24), rulerMaterial);
arcMesh.renderOrder = 998;
arcMesh.visible = false;
rotateGroup.add(arcMesh);

const arcRodStart = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), rulerMaterial);
arcRodStart.renderOrder = 998;
const arcRodEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), rulerMaterial);
arcRodEnd.renderOrder = 998;
rotateGroup.add(arcRodStart, arcRodEnd);

// Scale: axis-coloured rods for the current size + faint rods for the original size.
const scaleGroup = new THREE.Group();
scaleGroup.visible = false;
rulerGroup.add(scaleGroup);

const SCALE_AXIS_COLORS = [0xe74c3c, 0x2ecc71, 0x3498db]; // X, Y, Z
const scaleCurrent = [];
const scaleOriginal = [];
for (let i = 0; i < 3; i++) {
  const current = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1, 6),
    new THREE.MeshBasicMaterial({ color: SCALE_AXIS_COLORS[i], depthTest: false, side: THREE.DoubleSide })
  );
  current.renderOrder = 998;
  scaleGroup.add(current);
  scaleCurrent.push(current);

  const original = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1, 6),
    new THREE.MeshBasicMaterial({ color: 0x9aa0a6, opacity: 0.55, transparent: true, depthTest: false, side: THREE.DoubleSide })
  );
  original.renderOrder = 998;
  scaleGroup.add(original);
  scaleOriginal.push(original);
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

// Settings (loaded from localStorage and applied to the scene).
const settings = loadSettings();
applySettings(settings);
createSettingsPanel({ settings, onUpdate: updateSetting });

// Help bar toggle (info icon to the right of the settings icon).
const helpBtn = document.getElementById('help-btn');
const helpBar = document.getElementById('help');
helpBtn.addEventListener('click', () => {
  helpBar.hidden = !helpBar.hidden;
  helpBtn.classList.toggle('active', !helpBar.hidden);
});

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
let gesture = null;
let shiftHeld = false;
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
  settings,
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
    gesture = {
      mode: transformControls.mode,
      startPos: obj.position.clone(),
      startQuat: obj.quaternion.clone(),
      startScale: obj.scale.clone(),
      startBox: objectBox(obj).clone(),
      startParams: editableMesh(obj) ? { ...obj.userData.params } : null,
    };
    updateRuler();
  }
});

transformControls.addEventListener('mouseUp', () => {
  const obj = transformControls.object;
  if (obj && gizmoBefore) {
    const after = captureTransform(obj);
    const transformed = !transformsEqual(gizmoBefore, after);

    // On a scale gesture, fold the gizmo scale into the shape's dimensions so the
    // inspector Width/Height/Depth stay in sync, then reset the scale to 1×.
    if (transformed && gesture && gesture.mode === 'scale' && gesture.startParams && bakeScaleIntoParams(obj)) {
      history.push(
        commandScaleBake(
          obj,
          { params: gesture.startParams, transform: gizmoBefore },
          { params: { ...obj.userData.params }, transform: captureTransform(obj) }
        )
      );
      updateHistoryUI();
      scheduleSave();
      ui.refresh();
      updateMeasure();
      updateRuler();
      gizmoBefore = null;
      gesture = null;
      return;
    }

    if (transformed) {
      history.push(commandTransform(obj, gizmoBefore, after));
      updateHistoryUI();
      scheduleSave();
    }
  }
  gizmoBefore = null;
  gesture = null;
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
  updateRotationSnap();
}

// Rotation snapping: free by default, 15deg steps while Shift is held (rotate mode only).
const ROTATION_SNAP_DEG = 15;

function updateRotationSnap() {
  const snapping = shiftHeld && transformControls.mode === 'rotate';
  transformControls.setRotationSnap(snapping ? THREE.MathUtils.degToRad(ROTATION_SNAP_DEG) : null);
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Shift' || shiftHeld) return;
  shiftHeld = true;
  updateRotationSnap();
});

window.addEventListener('keyup', (event) => {
  if (event.key !== 'Shift') return;
  shiftHeld = false;
  updateRotationSnap();
});

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

function commandScaleBake(mesh, before, after) {
  return {
    undo: () => {
      rebuildShapeGeometry(mesh, before.params);
      applyTransform(mesh, before.transform);
    },
    redo: () => {
      rebuildShapeGeometry(mesh, after.params);
      applyTransform(mesh, after.transform);
    },
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
  const fmt = (v) => formatLength(v, settings).padStart(pad) + ' ' + getUnit(settings);
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

// Draw the readout value into the ruler's chip texture.
function drawRulerText(text) {
  const ctx = rulerCtx;
  const w = rulerCanvas.width;
  const h = rulerCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20, 24, 28, 0.9)';
  roundedRect(ctx, 4, 4, w - 8, h - 8, 22);
  ctx.fill();

  // Auto-fit the font so long readouts never overflow the chip.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 56;
  while (size > 22) {
    ctx.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
    if (ctx.measureText(text).width <= w - 28) break;
    size -= 2;
  }

  ctx.fillStyle = '#ffb300';
  ctx.fillText(text, w / 2, h / 2);
  rulerTexture.needsUpdate = true;
}

function setChipSize(worldHeight) {
  rulerSprite.scale.set(worldHeight * (rulerCanvas.width / rulerCanvas.height), worldHeight, 1);
}

// Position a unit-height cylinder (local +Y) so it spans `from` → `to`.
function placeRod(mesh, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  if (len < 1e-6) {
    mesh.visible = false;
    return false;
  }
  mesh.visible = true;
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return true;
}

// Live ruler overlay for the active transform gesture (move / rotate / scale).
function updateRuler() {
  const object = state.selected[0];
  if (!gesture || !object) {
    rulerGroup.visible = false;
    moveGroup.visible = false;
    rotateGroup.visible = false;
    scaleGroup.visible = false;
    return;
  }

  moveGroup.visible = gesture.mode === 'translate';
  rotateGroup.visible = gesture.mode === 'rotate';
  scaleGroup.visible = gesture.mode === 'scale';

  if (gesture.mode === 'translate') updateMoveRuler(object);
  else if (gesture.mode === 'rotate') updateRotateRuler(object);
  else if (gesture.mode === 'scale') updateScaleRuler(object);
}

// Move: a line from the start point to the current position, with a distance chip.
function updateMoveRuler(object) {
  const start = gesture.startPos;
  const end = object.position;
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();

  if (len < 0.001) {
    rulerGroup.visible = false;
    return;
  }

  const d = dir.clone().normalize();
  const tickDir = new THREE.Vector3().crossVectors(d, UP);
  if (tickDir.lengthSq() < 1e-6) tickDir.set(1, 0, 0);
  tickDir.normalize();
  const tickLen = 0.4;

  // Ruler rod from start to end.
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  rulerMesh.position.copy(mid);
  rulerMesh.scale.set(1, len, 1);
  rulerMesh.quaternion.setFromUnitVectors(UP, d);

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
    tick.quaternion.setFromUnitVectors(UP, tickDir);
    tick.scale.set(1, tickLen, 1);
    n += 1;
  }
  for (let i = n; i < ticks.length; i++) ticks[i].visible = false;

  // Distance chip, offset to the side + up so it doesn't crowd the object.
  const chip = mid.clone().addScaledVector(tickDir, 0.9).addScaledVector(UP, 0.4);
  rulerSprite.position.copy(chip);
  setChipSize(0.5);

  drawRulerText(formatLength(len, settings) + ' ' + getUnit(settings));
  rulerGroup.visible = true;
}

// Rotate: a 3D arc from the start orientation to the current orientation, with
// an angle chip. The arc spans the net rotation (axis + angle) of the shape.
function updateRotateRuler(object) {
  const delta = new THREE.Quaternion()
    .copy(object.quaternion)
    .multiply(gesture.startQuat.clone().invert())
    .normalize();
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(delta.w, -1, 1));

  if (angle < 1e-4) {
    rulerGroup.visible = false;
    return;
  }

  const axis = new THREE.Vector3(delta.x, delta.y, delta.z);
  if (axis.lengthSq() < 1e-6) {
    rulerGroup.visible = false;
    return;
  }
  axis.normalize();

  const box = objectBox(object);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius * 1.15, 0.5);
  const center = sphere.center.clone();

  // Stable reference direction perpendicular to the rotation axis.
  const ref = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.dot(ref)) > 0.99) ref.set(0, 1, 0);
  ref.sub(axis.clone().multiplyScalar(axis.dot(ref))).normalize();
  const tangent = new THREE.Vector3().crossVectors(axis, ref);

  // Arc tube spanning the swept angle (rebuild + dispose to avoid leaks).
  const tubularSegments = Math.max(8, Math.round((angle / (Math.PI * 2)) * 64));
  arcMesh.geometry.dispose();
  arcMesh.geometry = new THREE.TorusGeometry(radius, 0.06, 6, tubularSegments, angle);
  arcMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ref, tangent, axis));
  arcMesh.position.copy(center);
  arcMesh.visible = true;

  // Start / end radius lines make the sweep readable.
  const endDir = new THREE.Vector3().copy(ref).applyAxisAngle(axis, angle);
  placeRod(arcRodStart, center, center.clone().addScaledVector(ref, radius));
  placeRod(arcRodEnd, center, center.clone().addScaledVector(endDir, radius));

  const midDir = new THREE.Vector3().copy(ref).applyAxisAngle(axis, angle / 2);
  const chip = center.clone().addScaledVector(midDir, radius + 0.9).addScaledVector(UP, 0.4);
  rulerSprite.position.copy(chip);
  setChipSize(0.5);

  drawRulerText(THREE.MathUtils.radToDeg(angle).toFixed(2) + '\u00b0');
  rulerGroup.visible = true;
}

// Scale: axis rods from the original size to the current size, plus a factor chip.
function updateScaleRuler(object) {
  const current = objectBox(object);
  const original = gesture.startBox;
  if (current.isEmpty() || original.isEmpty()) {
    rulerGroup.visible = false;
    return;
  }

  const axes = ['x', 'y', 'z'];
  const anchor = original.min.clone();
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const dir = new THREE.Vector3();
    dir[a] = 1;

    placeRod(scaleCurrent[i], anchor, anchor.clone().addScaledVector(dir, current.max[a] - current.min[a]));
    placeRod(scaleOriginal[i], anchor, anchor.clone().addScaledVector(dir, original.max[a] - original.min[a]));
  }

  const size = current.getSize(new THREE.Vector3());
  const unit = getUnit(settings);
  const axis = transformControls.axis;

  let text;
  if (axis === 'X') text = `Width ${formatLength(size.x, settings)} ${unit}`;
  else if (axis === 'Y') text = `Height ${formatLength(size.y, settings)} ${unit}`;
  else if (axis === 'Z') text = `Depth ${formatLength(size.z, settings)} ${unit}`;
  else {
    // Uniform (center) or plane handles scale more than one axis: show factor(s).
    const s = object.scale;
    const g = gesture.startScale;
    const uniform = Math.abs(s.x - s.y) < 1e-4 && Math.abs(s.y - s.z) < 1e-4;
    if (uniform) {
      const factor = s.x / Math.max(g.x, 1e-6);
      text = (factor * 100).toFixed(0) + '% · ' + factor.toFixed(2) + '\u00d7';
    } else {
      text = `${(s.x / Math.max(g.x, 1e-6)).toFixed(2)}/${(s.y / Math.max(g.y, 1e-6)).toFixed(2)}/${(s.z / Math.max(g.z, 1e-6)).toFixed(2)}×`;
    }
  }

  // Chip to the side so it doesn't overlap the measurement label above.
  const center = current.getCenter(new THREE.Vector3());
  const chip = center.clone().add(new THREE.Vector3((current.max.x - current.min.x) / 2 + 0.9, 0, 0));
  rulerSprite.position.copy(chip);
  setChipSize(0.5);

  drawRulerText(text);
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

function applySettings(s) {
  scene.background.set(s.background);
  scene.fog.color.set(s.background);
  renderer.shadowMap.enabled = s.shadows;
  lights.sun.castShadow = s.shadows;
  gridGroup.visible = s.grid;
  gridGroup.scale.set(s.gridWidth / GRID_BASE_SIZE, 1, s.gridLength / GRID_BASE_SIZE);
}

function updateSetting(changes) {
  Object.assign(settings, changes);
  applySettings(settings);
  saveSettings(settings);
  updateMeasure();
  updateRuler();
  renderSnapOptions();
  ui.refresh();
}

function renderSnapOptions() {
  const select = document.getElementById('snap');
  if (!select) return;
  select.innerHTML = '';
  SNAP_VALUES.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = snapLabel(v, settings);
    select.appendChild(opt);
  });
  select.value = String(state.snap);
}

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
renderSnapOptions();
ui.refresh();
updateHistoryUI();
ui.setClipboardState(false);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
