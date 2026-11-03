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
} from './scene.js';
import { SHAPE_FACTORIES } from './shapes.js';
import { booleanOperation } from './booleans.js';
import { createInteraction } from './interaction.js';
import { createUI } from './ui.js';
import { createHistory } from './history.js';

const container = document.getElementById('app');

const renderer = createRenderer(container);
const scene = createScene();
const camera = createCamera(container);
createLights(scene);
createGround(scene);
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
});

const interaction = createInteraction({
  renderer,
  camera,
  state,
  onSelectionChange: () => {
    ui.refresh();
    syncGizmo();
  },
  onDelete,
  onSetMode,
  onUndo: performUndo,
  onRedo: performRedo,
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});

transformControls.addEventListener('objectChange', () => {
  ui.refresh();
});

transformControls.addEventListener('mouseDown', () => {
  const obj = transformControls.object;
  if (obj) gizmoBefore = captureTransform(obj);
});

transformControls.addEventListener('mouseUp', () => {
  const obj = transformControls.object;
  if (obj && gizmoBefore) {
    const after = captureTransform(obj);
    if (!transformsEqual(gizmoBefore, after)) {
      history.push(commandTransform(obj, gizmoBefore, after));
      updateHistoryUI();
    }
  }
  gizmoBefore = null;
});

// ---- shape management -------------------------------------------------------

function addShape(type) {
  const mesh = SHAPE_FACTORIES[type]();
  scene.add(mesh);
  state.shapes.push(mesh);
  interaction.setSelected([mesh]);
  history.push(commandAdd(mesh));
  updateHistoryUI();
}

function removeShape(mesh) {
  if (transformControls.object === mesh) transformControls.detach();
  scene.remove(mesh);
  state.shapes = state.shapes.filter((m) => m !== mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
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

function updateHistoryUI() {
  ui.setHistoryState(history.canUndo(), history.canRedo());
}

function performUndo() {
  if (!history.canUndo()) return;
  history.undo();
  interaction.setSelected([]);
  updateHistoryUI();
}

function performRedo() {
  if (!history.canRedo()) return;
  history.redo();
  interaction.setSelected([]);
  updateHistoryUI();
}

// ---- inspector actions ------------------------------------------------------

function onScale(value) {
  if (!scaleBefore) {
    scaleBefore = new Map(state.selected.map((m) => [m, m.scale.clone()]));
  }
  state.selected.forEach((m) => m.scale.setScalar(value));
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
  }
}

function onColor(hex) {
  const value = new THREE.Color(hex).getHex();
  if (!colorBefore) {
    colorBefore = new Map(state.selected.map((m) => [m, m.material.color.getHex()]));
  }
  state.selected.forEach((m) => setColor(m, value));
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
  }
}

function onToggleHole(isHole) {
  const meshes = [...state.selected];
  if (!meshes.length) return;
  const before = meshes.map((m) => !m.userData.solid);
  meshes.forEach((m) => setHole(m, isHole));
  history.push(commandHole(meshes, before, meshes.map(() => isHole)));
  updateHistoryUI();
}

function onDelete() {
  const meshes = [...state.selected];
  if (!meshes.length) return;
  meshes.forEach(removeShape);
  interaction.setSelected([]);
  history.push(commandDelete(meshes));
  updateHistoryUI();
}

// ---- booleans ---------------------------------------------------------------

function onBoolean(op) {
  if (state.selected.length !== 2) return;
  const [a, b] = state.selected;
  const result = booleanOperation(a, b, op);
  removeShape(a);
  removeShape(b);
  scene.add(result);
  state.shapes.push(result);
  interaction.setSelected([result]);
  history.push(commandBoolean(a, b, result));
  updateHistoryUI();
}

// ---- export / reset / snap --------------------------------------------------

function onExport() {
  const exporter = new STLExporter();
  const group = new THREE.Group();
  state.shapes.forEach((m) => group.add(m.clone()));
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

seedDemo();
ui.refresh();
updateHistoryUI();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
