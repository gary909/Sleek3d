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
import { saveProject, loadProject } from './save.js';
import { createTextMesh } from './text.js';

const container = document.getElementById('app');

const renderer = createRenderer(container);
const scene = createScene();
const camera = createCamera(container);
createLights(scene);
createGround(scene);
applyEnvironment(renderer, scene);
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
  onAlign,
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
  onDuplicate: duplicateSelected,
  onGroup: groupSelected,
  onUngroup: ungroupSelected,
  onSelectAll: selectAll,
  onNudge,
  onNudgeEnd,
  onToggleHoleKey: toggleHoleShortcut,
  onFocus: focusSelected,
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
      scheduleSave();
    }
  }
  gizmoBefore = null;
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
