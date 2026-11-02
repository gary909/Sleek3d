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

const ui = createUI({
  state,
  onAdd: addShape,
  onScale,
  onColor,
  onToggleHole,
  onDelete,
  onBoolean,
  onExport,
  onReset,
  onSnap,
  onSetMode,
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
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});

transformControls.addEventListener('objectChange', () => {
  ui.refresh();
});

// ---- shape management -------------------------------------------------------

function addShape(type) {
  const mesh = SHAPE_FACTORIES[type]();
  scene.add(mesh);
  state.shapes.push(mesh);
  interaction.setSelected([mesh]);
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

// ---- inspector actions ------------------------------------------------------

function onScale(value) {
  state.selected.forEach((m) => m.scale.setScalar(value));
}

function onColor(hex) {
  state.selected.forEach((m) => {
    m.material.color.set(hex);
    m.userData._prevColor = hex;
  });
}

function onToggleHole(isHole) {
  state.selected.forEach((m) => setHole(m, isHole));
}

function onDelete() {
  [...state.selected].forEach(removeShape);
  interaction.setSelected([]);
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
