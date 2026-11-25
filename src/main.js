import { createViewCube } from "./viewcube.js";
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
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
  applyStudioScale,
  applyShadowTint,
  HOME_CAMERA_POSITION,
  HOME_TARGET,
} from './scene.js';
import { SHAPE_FACTORIES, SHAPE_DEFS, rebuildShapeGeometry, bakeScaleIntoParams } from './shapes.js';
import { booleanOperation, combineGroupToMesh } from './booleans.js';
import { createResizeFrame, updateResizeFrame, pickResizeHandle, setHoveredResizeHandle, showResizeMeasures, hideResizeMeasures, showRotationChip, hideRotationChip } from './resizeFrame.js';
import { unionBounds, cornerPoints, cornerTarget, heightTarget, applyCornerScale, applyHeightScale, EDGE_HANDLES, edgeTarget } from './selectionResize.js';
import { createRotationHandles, updateRotationHandles, pickRotationHandle, setHoveredRotationHandle } from './rotationHandles.js';
import { yawAngle, snapAngle, applyRotation, restoreRotations } from './selectionRotate.js';
import { createInteraction } from './interaction.js';
import { createUI, createSettingsPanel, initTooltips } from './ui.js';
import { createHistory } from './history.js';
import { saveProject, loadProject, serializeScene, deserializeScene } from './save.js';
import { createTextMesh } from './text.js';
import { loadImportedFile } from './importer.js';
import { updateGrid, updateGridLod, gridFamily, IMPERIAL_GRID_SIZE } from './grid.js';
import { processImageFile, applyReferenceMaterial } from './reference.js';
import { loadSettings, saveSettings, getUnit, formatLength, SNAP_VALUES, snapLabel } from './settings.js';

const container = document.getElementById('app');

const renderer = createRenderer(container);
const scene = createScene();
let camera = createCamera(container);
const perspectiveCamera = camera;
let orthoCamera = null;
let isOrtho = false;
const lights = createLights(scene);
const { ground, gridGroup } = createGround(scene);

// The default (home) view is derived from the work-area size in applySettings.
const homeView = { position: HOME_CAMERA_POSITION.clone(), target: HOME_TARGET.clone() };
// The gizmo is what the toolbar's three buttons switch: Move = translate arrows,
// Rotate = rotate rings, Scale = scale arrows ending in squares. Pressing the lit
// button again hides it. The on-object squares and the curved arrows are separate
// handles and stay visible whatever the gizmo is doing.
let gizmoMode = "translate";
let gizmoVisible = false;
let homeApplied = false;
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

// Tinkercad-style resize frame drawn around the current selection.
const resizeFrame = createResizeFrame();
scene.add(resizeFrame.group);

// Tinkercad-style rotation arrows: four flat yaw arcs plus one pitch arc on top.
const rotationHandles = createRotationHandles();
scene.add(rotationHandles.group);


// Text labels printed flat on the grid (scale with the grid, hide with it).
const GRID_LABEL_W = 6; // base plane width (world units, before grid scaling)
const UNIT_LABEL_FRAC = 0.12; // unit label width as a fraction of the grid width
const TITLE_LABEL_FRAC = 0.2; // "Sleek3D" — bigger

function createGridLabel(text, { fontPx = 44, weight = 'bold', spacing = 0, aspect = 4, stroke = 0 } = {}) {
  const canvasH = 64;
  const canvasW = Math.round(canvasH * aspect);
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const baseW = GRID_LABEL_W;
  const baseH = baseW / aspect;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(baseW, baseH),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  scene.add(mesh);

  const draw = (txt, color = '#4a525c') => {
    const cx = canvasW / 2;
    const cy = canvasH / 2;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = color;
    ctx.font = `${weight} ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
    if (stroke > 0) {
      ctx.lineWidth = stroke;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.strokeText(txt, cx, cy);
    }
    ctx.fillText(txt, cx, cy);
    texture.needsUpdate = true;
  };

  draw(text);
  return { mesh, draw, baseW, baseH };
}

const unitLabel = createGridLabel('Unit: mm');
const titleLabel = createGridLabel('Sleek 3D', {
  fontPx: 52,
  weight: '900',
  spacing: 2,
  aspect: 5,
  stroke: 3,
});

// Labels sit on the work-plane background, so pick a text colour that stays
// legible whether that background is dark or light.
function gridLabelColor(background) {
  const c = new THREE.Color(background);
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luma > 0.35 ? '#4a525c' : '#c9d2dd';
}

// Lie flat near a corner (cornerX -1 = left / 1 = right, cornerZ 1 = near) at a
// width that's `frac` of the grid, so it scales with the grid.
function layoutGridLabel(label, s, frac, cornerX, cornerZ) {
  const labelW = s.gridWidth * frac;
  const scale = labelW / label.baseW;
  const labelD = label.baseH * scale;
  const inset = 0.5 * scale;
  label.mesh.scale.setScalar(scale);
  label.mesh.position.set(
    cornerX * (s.gridWidth / 2 - labelW / 2 - inset),
    0.03,
    cornerZ * (s.gridLength / 2 - labelD / 2 - inset)
  );
  label.mesh.visible = s.grid;
}

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
controls.maxPolarAngle = Math.PI - 0.02; // allow the nav cube to reach the bottom face
const transformControls = createTransformControls(camera, renderer.domElement);
scene.add(transformControls.getHelper());
handleResize(renderer, () => camera, container);

// Smooth camera transitions for the view buttons (home / fit / zoom).
let viewTween = null;
function flyTo(pos, tgt, ms = 380, zoom = null) {
  viewTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: tgt.clone(), s: performance.now(), ms, z0: camera.zoom, z1: zoom === null ? camera.zoom : zoom };
}
function updateViewTween(now) {
  if (!viewTween) return;
  const v = viewTween;
  const k = Math.min(1, (now - v.s) / v.ms);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  camera.position.lerpVectors(v.p0, v.p1, e);
  controls.target.lerpVectors(v.t0, v.t1, e);
  if (v.z0 !== v.z1) {
    camera.zoom = v.z0 + (v.z1 - v.z0) * e;
    camera.updateProjectionMatrix();
  }
  if (k >= 1) viewTween = null;
}
controls.addEventListener("start", () => { viewTween = null; });

// Zoom in / out buttons (top of the toolbar). factor < 1 moves the camera closer.
function zoomView(factor) {
  if (camera.isOrthographicCamera) {
    const z = Math.max(0.05, Math.min(50, camera.zoom / factor));
    flyTo(camera.position, controls.target, 200, z);
    return;
  }
  const offset = camera.position.clone().sub(controls.target);
  const dist = offset.length() * factor;
  offset.setLength(Math.max(controls.minDistance, Math.min(controls.maxDistance, dist)));
  flyTo(controls.target.clone().add(offset), controls.target, 200);
}
document.getElementById('zoom-in').addEventListener('click', () => zoomView(0.85));
document.getElementById('zoom-out').addEventListener('click', () => zoomView(1 / 0.85));

// Reset the camera to the default ("home") view.
// Frame the whole work area from the default viewing direction.
function computeHomeView(s) {
  const max = Math.max(s.gridWidth, s.gridLength);
  const fov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
  const distance = (max * 0.5 / Math.tan(fov / 2)) * 1.1;
  const dir = HOME_CAMERA_POSITION.clone().sub(HOME_TARGET).normalize();
  homeView.target.set(0, max * 0.02, 0);
  homeView.position.copy(homeView.target).addScaledVector(dir, distance);
}

function resetView() {
  if (camera.isOrthographicCamera) {
    const d = homeView.position.distanceTo(homeView.target);
    const desired = 2 * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2) * d;
    const z = (orthoCamera.top - orthoCamera.bottom) / desired;
    flyTo(homeView.position, homeView.target, 380, z);
  } else {
    flyTo(homeView.position, homeView.target);
  }
}

document.getElementById('home-view').addEventListener('click', resetView);

// Toggle between perspective and orthographic (flat) views.
const projBtn = document.getElementById("projection-view");

function setActiveCamera(cam) {
  camera = cam;
  controls.object = cam;
  transformControls.camera = cam;
  interaction.setCamera(cam);
  cam.updateProjectionMatrix();
  controls.update();
}

function toggleProjection() {
  viewTween = null;
  const target = controls.target.clone();
  const dir = camera.position.clone().sub(target);
  const dist = dir.length() || 1;
  dir.normalize();
  const aspect = container.clientWidth / container.clientHeight;
  if (!isOrtho) {
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2) * dist;
    orthoCamera = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, perspectiveCamera.near, perspectiveCamera.far);
    orthoCamera.position.copy(target).addScaledVector(dir, dist);
    orthoCamera.zoom = 1;
    isOrtho = true;
    setActiveCamera(orthoCamera);
  } else {
    const hEff = (orthoCamera.top - orthoCamera.bottom) / orthoCamera.zoom;
    const d = (hEff / 2) / Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2);
    perspectiveCamera.position.copy(target).addScaledVector(dir, d);
    isOrtho = false;
    setActiveCamera(perspectiveCamera);
  }
  controls.update();
  projBtn.textContent = isOrtho ? "2D" : "3D";
  projBtn.dataset.tip = isOrtho ? "Switch to perspective view" : "Switch to flat (orthographic) view";
  projBtn.classList.toggle("active", isOrtho);
}

projBtn?.addEventListener("click", toggleProjection);

// Drops the selection straight down onto the work plane (y = 0).
const dropBtn = document.getElementById("drop-to-plane");

function updateDropButton() {
  if (dropBtn) dropBtn.disabled = state.selected.length === 0;
}

dropBtn?.addEventListener("click", dropSelection);

// Navigation cube (top-right, left of the inspector).
function viewFromAxis(axis) {
  viewTween = null;
  const target = controls.target.clone();
  const dist = camera.position.distanceTo(target) || 10;
  if (!isOrtho) {
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2) * dist;
    const aspect = container.clientWidth / container.clientHeight;
    orthoCamera = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, perspectiveCamera.near, perspectiveCamera.far);
    orthoCamera.zoom = 1;
    isOrtho = true;
    setActiveCamera(orthoCamera);
    projBtn.textContent = "2D";
    projBtn.dataset.tip = "Switch to perspective view";
    projBtn.classList.add("active");
  }
  const dir = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const pos = target.clone().addScaledVector(dir, dist);
  flyTo(pos, target, 320, camera.zoom);
}

const viewCube = createViewCube({
  mount: document.getElementById("viewcube"),
  getCamera: () => camera,
  controls,
  cancelTween: () => { viewTween = null; },
  onFaceView: viewFromAxis,
});

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

// The drop button starts disabled (markup) and follows the selection state.
updateDropButton();

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
  onToggleTransparent,
  onDelete,
  onToggleLock,
  onBoolean,
  onExport,
  onImport: importModel,
  onReferenceImage,
  onReferenceParam,
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

// Nothing lit at start: the object's own squares and arrows are the default UI.
ui.setGizmoState({ mode: gizmoMode, visible: gizmoVisible });

const interaction = createInteraction({
  renderer,
  camera,
  state,
  onSelectionChange: () => {
    ui.refresh();
    syncGizmo();
    updateMeasure();
    updateDropButton();
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
  onFocus: fitView,
  onZoomIn: () => zoomView(0.85),
  onZoomOut: () => zoomView(1 / 0.85),
  onCopy: copySelected,
  onPaste: pasteClipboard,
  onDrop: dropSelection,
  pickFrameHandle: (raycaster) => {
    if (selectionFrameVisible() === false) return null;
    return pickResizeHandle(resizeFrame, raycaster) ?? pickRotationHandle(rotationHandles, raycaster);
  },
  onFrameHover: frameHandleHover,
  onFrameDragStart: frameDragStart,
  onFrameDragMove: frameDragMove,
  onFrameDragEnd: frameDragEnd,
  onBodyDragStart: beginBodyDrag,
  onBodyDragMove: moveBodyDrag,
  onBodyDragEnd: endBodyDrag,
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
  applyOnTopGhosts();
  interaction.setSelected([mesh]);
  history.push(commandAdd(mesh));
  updateHistoryUI();
  scheduleSave();
}

async function addTextShape() {
  const text = window.prompt('Text to add', 'Sleek3d');
  if (!text || !text.trim()) return;
  const mesh = await createTextMesh(text.trim(), { size: 10, depth: 2 });
  scene.add(mesh);
  state.shapes.push(mesh);
  applyOnTopGhosts();
  interaction.setSelected([mesh]);
  history.push(commandAdd(mesh));
  updateHistoryUI();
  scheduleSave();
}

async function importModel(file) {
  try {
    const wrapper = await loadImportedFile(file);
    scene.add(wrapper);
    state.shapes.push(wrapper);
    interaction.setSelected([wrapper]);
    history.push(commandAdd(wrapper));
    updateHistoryUI();
    frameObjects([wrapper]);
    scheduleSave();
  } catch (error) {
    console.error('Import failed:', error);
    alert(error.message || 'Could not import that file.');
  }
}

function removeShape(object) {
  if (transformControls.object === object) transformControls.detach();
  scene.remove(object);
  state.shapes = state.shapes.filter((o) => o !== object);
  getMeshes(object).forEach((m) => {
    m.geometry.dispose();
    m.material.dispose();
  });
  applyOnTopGhosts();
}

function applyAppearance(mesh) {
  const mat = mesh.material;
  const wasTransparent = mat.transparent;

  if (mesh.userData._prevColor == null) {
    mesh.userData._prevColor = mat.color.getHex();
  }

  const isHole = mesh.userData.solid === false;
  const seeThrough = mesh.userData.transparent === true;

  if (isHole) {
    mat.transparent = true;
    mat.opacity = 0.35;
    mat.depthWrite = false;
    mat.color.set(0xd64545);
  } else if (seeThrough) {
    mat.transparent = true;
    mat.opacity = 0.3;
    mat.depthWrite = false;
    mat.color.set(mesh.userData._prevColor);
  } else {
    mat.transparent = false;
    mat.opacity = 1;
    mat.depthWrite = true;
    mat.color.set(mesh.userData._prevColor);
  }

  // Changing `transparent` on a material that has already rendered needs a
  // program refresh — otherwise the toggle only takes effect on the next reload.
  if (mat.transparent !== wasTransparent) mat.needsUpdate = true;
}

function setHole(mesh, isHole) {
  mesh.userData.solid = !isHole;
  applyAppearance(mesh);
}

// ---- gizmo -------------------------------------------------------------------

// ---- object lock ------------------------------------------------------------

// A locked object cannot be transformed, edited or deleted until it is unlocked.
function lockedSelection() {
  return state.selected.some((object) => object.userData && object.userData.locked === true);
}

function applyLock(objects, locked) {
  objects.forEach((object) => {
    object.userData.locked = locked;
  });
  syncGizmo();
  ui.refresh();
  scheduleSave();
}

function onToggleLock() {
  const objects = [...state.selected];
  if (objects.length === 0) return;
  const wasLocked = objects.every((object) => object.userData.locked === true);
  const next = wasLocked === false;
  const undo = () => applyLock(objects, wasLocked);
  const redo = () => applyLock(objects, next);
  redo();
  history.push({ undo, redo });
  updateHistoryUI();
}

function syncGizmo() {
  const target = state.selected[0] ?? null;
  // All three modes use the gizmo, including scale (its arms end in squares).
  if (gizmoVisible && target && target.userData.locked !== true) {
    if (transformControls.mode !== gizmoMode) transformControls.setMode(gizmoMode);
    if (transformControls.object !== target) transformControls.attach(target);
  } else {
    transformControls.detach();
  }
}

function onSetMode(mode) {
  if (frameDrag || transformControls.dragging) return; // never switch mid-drag
  // Same button twice hides the gizmo; any other button switches its function on.
  if (gizmoVisible && gizmoMode === mode) {
    gizmoVisible = false;
  } else {
    gizmoMode = mode;
    gizmoVisible = true;
  }
  syncGizmo();
  ui.setGizmoState({ mode: gizmoMode, visible: gizmoVisible });
  updateRotationSnap();
}

// Rotation snapping for the gizmo: free by default, 15deg steps while Shift is held.
// The on-object arrows read `shiftHeld` directly in frameDragMove.
const ROTATION_SNAP_DEG = 15;
const PITCH_DEG_PER_PX = 0.75; // vertical drag of the tilt arrow
const ROLL_DEG_PER_PX = 0.75; // horizontal drag of the roll arrow

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
  mesh.userData._prevColor = hex;
  mesh.material.color.setHex(hex);
  applyAppearance(mesh);
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

function commandTransparent(meshes, before, after) {
  return {
    undo: () =>
      meshes.forEach((m, i) => {
        m.userData.transparent = before[i];
        applyAppearance(m);
      }),
    redo: () =>
      meshes.forEach((m, i) => {
        m.userData.transparent = after[i];
        applyAppearance(m);
      }),
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
  applyOnTopGhosts();
  updateHistoryUI();
  scheduleSave();
}

function performRedo() {
  if (!history.canRedo()) return;
  history.redo();
  interaction.setSelected([]);
  applyOnTopGhosts();
  updateHistoryUI();
  scheduleSave();
}

// ---- inspector actions ------------------------------------------------------

function onScale(value) {
  if (lockedSelection()) return;
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
  if (lockedSelection()) return;
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
  if (lockedSelection()) return;
  const mesh = editableMesh(state.selected[0]);
  if (!mesh) return;
  if (!resizeGesture || resizeGesture.mesh !== mesh) {
    resizeGesture = { mesh, beforeParams: { ...mesh.userData.params } };
  }
  const def = SHAPE_DEFS[mesh.userData.shapeType];
  const next = { ...(mesh.userData.params || {}) };
  if (def) {
    def.params.forEach((spec) => {
      if (params[spec.key] !== undefined) next[spec.key] = params[spec.key];
    });
  }
  rebuildShapeGeometry(mesh, next);
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

// ---- reference images -------------------------------------------------------

let referenceGesture = null;

function referenceMesh() {
  const object = state.selected[0];
  return object && object.userData.referenceImage === true ? object : null;
}

function commitReferenceGesture() {
  if (!referenceGesture) return;
  const { mesh, before } = referenceGesture;
  referenceGesture = null;
  const after = { ...mesh.userData.params };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    history.push(commandReshape(mesh, before, after));
    updateHistoryUI();
  }
  ui.refresh();
}

function onReferenceParam(patch, commit = false) {
  if (lockedSelection()) return;
  const mesh = referenceMesh();
  if (!mesh) return;
  if (!referenceGesture || referenceGesture.mesh !== mesh) {
    referenceGesture = { mesh, before: { ...mesh.userData.params } };
  }
  rebuildShapeGeometry(mesh, { ...mesh.userData.params, ...patch });
  if (patch.onTop !== undefined) applyOnTopGhosts();
  updateMeasure();
  scheduleSave();
  if (commit) commitReferenceGesture();
}

async function onReferenceImage(file) {
  if (lockedSelection()) return;
  const mesh = referenceMesh();
  if (!mesh) return;
  const processed = await processImageFile(file);
  const before = { ...mesh.userData.params };
  const params = { ...before, image: processed.dataUrl, ratio: processed.ratio, name: processed.name };
  if (params.aspect !== false) {
    params.w = Math.max(1, Math.min(100, params.w));
    params.h = Math.max(1, Math.min(100, params.w / (processed.ratio || 1)));
  }
  rebuildShapeGeometry(mesh, params);
  updateMeasure();
  history.push(commandReshape(mesh, before, { ...mesh.userData.params }));
  updateHistoryUI();
  scheduleSave();
}

// While Set on top is ticked every other shape fades back so the picture reads
// as sitting at the top of the stack.
function applyOnTopGhosts() {
  const active = state.shapes.some((object) => object.userData && object.userData.referenceImage && object.userData.params && object.userData.params.onTop === true);
  state.shapes.forEach((object) => {
    if (object.userData && object.userData.referenceImage) return;
    getMeshes(object).forEach((mesh) => {
      if (active) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0.2;
        mesh.material.depthWrite = false;
        mesh.material.needsUpdate = true;
        return;
      }
      applyAppearance(mesh);
    });
  });
}

function refreshMeshAppearance(mesh) {
  if (mesh.userData.referenceImage) {
    applyReferenceMaterial(mesh, mesh.userData.params || {});
    return;
  }
  applyAppearance(mesh);
}
function onToggleHole(isHole) {
  if (lockedSelection()) return;
  const meshes = state.selected.flatMap(getMeshes);
  if (!meshes.length) return;
  const before = meshes.map((m) => !m.userData.solid);
  meshes.forEach((m) => setHole(m, isHole));
  history.push(commandHole(meshes, before, meshes.map(() => isHole)));
  updateHistoryUI();
  scheduleSave();
}

function onToggleTransparent(isTransparent) {
  if (lockedSelection()) return;
  const meshes = state.selected.flatMap(getMeshes);
  if (!meshes.length) return;
  const before = meshes.map((m) => m.userData.transparent === true);
  meshes.forEach((m) => {
    m.userData.transparent = isTransparent;
    applyAppearance(m);
  });
  history.push(commandTransparent(meshes, before, meshes.map(() => isTransparent)));
  updateHistoryUI();
  scheduleSave();
}

function onDelete() {
  if (lockedSelection()) return;
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
  if (lockedSelection()) return;
  if (state.selected.length !== 2) return;
  const [aOrig, bOrig] = state.selected;
  if (aOrig.userData.referenceImage || bOrig.userData.referenceImage) return;

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
    c.userData.locked = false;
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
    o.userData.locked = false;
    o.position.x += state.snap;
    o.position.z += state.snap;
    scene.add(o);
    state.shapes.push(o);
    getMeshes(o).forEach(refreshMeshAppearance);
  });

  interaction.setSelected(objects);
  history.push(commandDelete(objects));
  updateHistoryUI();
  scheduleSave();
}

function groupSelected() {
  if (lockedSelection()) return;
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
  if (lockedSelection()) return;
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

// Frame the given objects in view (fit the camera to their combined bounds).
function frameBox(box) {
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
  const direction = camera.position.clone().sub(controls.target).normalize();
  const distance = Math.max(radius * 3, 4);

  if (camera.isOrthographicCamera) {
    const H = camera.top - camera.bottom;
    const aspect = (camera.right - camera.left) / H;
    const pad = 1.2;
    const z = (Math.min(1, aspect) * H) / (2 * Math.max(radius, 0.001) * pad);
    flyTo(center.clone().addScaledVector(direction, distance), center, 380, z);
  } else {
    flyTo(center.clone().addScaledVector(direction, distance), center);
  }
}

function frameObjects(objects) {
  if (!objects.length) return;
  const box = new THREE.Box3();
  objects.forEach((o) => {
    o.updateWorldMatrix(true, false);
    getMeshes(o).forEach((m) => box.expandByObject(m));
  });
  frameBox(box);
}

// Fit-to-view: frame the selection, or the whole work area when the scene is empty.
function fitView() {
  const objects = state.selected.length ? state.selected : state.shapes;
  if (objects.length) {
    frameObjects(objects);
    return;
  }
  const halfW = settings.gridWidth / 2;
  const halfL = settings.gridLength / 2;
  frameBox(new THREE.Box3(new THREE.Vector3(-halfW, 0, -halfL), new THREE.Vector3(halfW, 0, halfL)));
}

document.getElementById("fit-view").addEventListener("click", fitView);

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


// The measurement label and ruler chip scale with the work area so they stay
// legible now that the default bed is 20 cm rather than 40 mm.
function labelWorldHeight() {
  const max = Math.max(settings.gridWidth, settings.gridLength);
  return Math.max(1, max * 0.04);
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
  const worldHeight = labelWorldHeight();
  measureSprite.position.set(center.x, box.max.y + worldHeight * 1.4, center.z);
  measureSprite.scale.set(worldHeight * (w / h), worldHeight, 1);
  measureSprite.visible = true;
}

// ---- resize frame -----------------------------------------------------------

const FRAME_MIN_SIZE = 1;
const RULER_OUTSET_PX = 16; // corner dimension lines sit this far outside the outline
let frameDrag = null;
let activeHandle = null;
let rotationExpandedAxis = null; // "yaw" or "tilt" while that arrow is in use

function selectionFrameVisible() {
  return state.selected.length > 0 && lockedSelection() === false;
}

// How far the selection has turned from its original orientation about one axis
// ("turnY" yaw, "turnX" tilt, "turnZ" roll), plus the in-progress drag so the
// ticks follow the pointer live.
function selectionTurn(key = "turnY") {
  const object = state.selected[0];
  if (!object) return 0;
  const base = object.userData[key] || 0;
  const drag = frameDrag && frameDrag.rotate && frameDrag.rotate.key === key ? frameDrag.rotate.delta || 0 : 0;
  return base + drag;
}

// The userData slot that records a rotate handle's running angle.
function rotationKeyForHandle(id) {
  if (id === "rotX") return "turnX";
  if (id === "rotZ") return "turnZ";
  return "turnY";
}

function updateFrameFromSelection() {
  // Freeze the frame while a rotation drag runs: the world AABB grows as the
  // selection turns, which would make the handles slide under the pointer.
  const box = frameDrag && frameDrag.rotate ? frameDrag.box : state.selected.length ? unionBounds(state.selected) : null;
  const selected = selectionFrameVisible();
  updateResizeFrame(resizeFrame, {
    box,
    camera,
    viewportHeight: renderer.domElement.clientHeight,
    visible: selected,
  });
  updateRotationHandles(rotationHandles, {
    box,
    camera,
    viewportHeight: renderer.domElement.clientHeight,
    visible: selected,
    turn: selectionTurn("turnY"),
    tilt: selectionTurn("turnX"),
    roll: selectionTurn("turnZ"),
    expandedAxis: rotationExpandedAxis,
  });
  if (activeHandle && box && selected) showHandleRuler(activeHandle, box);
  // Always keep the angle chip live while a rotation drag is running.
  if (frameDrag && frameDrag.rotate) showRotationReadout(frameDrag.box);
  if (selected === false) renderer.domElement.style.cursor = "";
}

function showHandleRuler(id, box) {
  if (isRotateHandle(id)) {
    showRotationReadout(box);
    return;
  }
  if (!(frameDrag && frameDrag.rotate)) hideRotationChip(resizeFrame);
  const y = box.min.y + 0.02;
  const fmt = (v) => formatLength(v, settings) + getUnit(settings);
  const centre = box.getCenter(new THREE.Vector3());
  const view = {
    camera,
    viewportWidth: renderer.domElement.clientWidth,
    viewportHeight: renderer.domElement.clientHeight,
    centre,
  };
  if (id === "top") {
    showResizeMeasures(resizeFrame, {
      ...view,
      measures: [
        {
          text: fmt(box.max.y - box.min.y),
          from: new THREE.Vector3(centre.x, box.min.y, centre.z),
          to: new THREE.Vector3(centre.x, box.max.y, centre.z),
          gapAxis: "width",
        },
      ],
    });
    return;
  }
  if (EDGE_HANDLES.includes(id)) {
    // Single-axis handle: show only the dimension being changed, measured along
    // that axis through the middle of the footprint.
    const midX = (box.min.x + box.max.x) / 2;
    const midZ = (box.min.z + box.max.z) / 2;
    const isWidth = id === "e" || id === "w";
    const spec = isWidth
      ? {
          text: fmt(box.max.x - box.min.x),
          from: new THREE.Vector3(box.min.x, y, midZ),
          to: new THREE.Vector3(box.max.x, y, midZ),
        }
      : {
          text: fmt(box.max.z - box.min.z),
          from: new THREE.Vector3(midX, y, box.min.z),
          to: new THREE.Vector3(midX, y, box.max.z),
          level: true,
        };
    showResizeMeasures(resizeFrame, { ...view, measures: [spec] });
    return;
  }
  const point = cornerPoints(box)[id];
  if (!point) return;
  const oppositeX = id === "nw" || id === "sw" ? box.max.x : box.min.x;
  const oppositeZ = id === "nw" || id === "ne" ? box.max.z : box.min.z;
  // One chip per edge line; sizes and gaps are in screen pixels, not world units.
  showResizeMeasures(resizeFrame, {
    ...view,
    measures: [
      {
        text: fmt(box.max.x - box.min.x),
        from: new THREE.Vector3(point.x, y, point.z),
        to: new THREE.Vector3(oppositeX, y, point.z),
        outsetPx: RULER_OUTSET_PX,
      },
      {
        text: fmt(box.max.z - box.min.z),
        from: new THREE.Vector3(point.x, y, point.z),
        to: new THREE.Vector3(point.x, y, oppositeZ),
        level: true,
        outsetPx: RULER_OUTSET_PX,
      },
    ],
  });
}

function frameHandleHover(id) {
  activeHandle = id;
  setHoveredResizeHandle(resizeFrame, id);
  setHoveredRotationHandle(rotationHandles, id);
  if (id && selectionFrameVisible()) {
    const cursor = id === "rotZ"
      ? "ew-resize"
      : isRotateHandle(id)
        ? "grab"
        : id === "top" || id === "n" || id === "s"
          ? "ns-resize"
          : id === "e" || id === "w"
            ? "ew-resize"
            : "nwse-resize";
    renderer.domElement.style.cursor = cursor;
    showHandleRuler(id, unionBounds(state.selected));
  } else {
    renderer.domElement.style.cursor = "";
    hideResizeMeasures(resizeFrame);
  }
}

function dragPointFor(raycaster, box, id) {
  const plane = new THREE.Plane();
  if (id === "top") {
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    normal.y = 0;
    if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
    normal.normalize();
    plane.setFromNormalAndCoplanarPoint(normal, box.getCenter(new THREE.Vector3()));
  } else {
    plane.set(new THREE.Vector3(0, 1, 0), -box.min.y);
  }
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

function isRotateHandle(id) {
  return id === "rotY" || id === "rotX" || id === "rotZ";
}

function rotationPoint(raycaster, centre, axis) {
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, centre);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

// Live angle readout during a rotation drag, drawn with the same chip style.
// World units per screen pixel at a world point (same maths the frame uses).
function pixelsToWorld(point) {
  const vh = renderer.domElement.clientHeight;
  if (camera.isOrthographicCamera) return ((camera.top - camera.bottom) / camera.zoom) / vh;
  return (2 * camera.position.distanceTo(point) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / vh;
}

// Live angle: the tilt delta while tilting, otherwise how far the object has
// turned from its original orientation. Drawn in its own chip.
function showRotationReadout(box) {
  const drag = frameDrag && frameDrag.rotate ? frameDrag.rotate : null;
  const radians = selectionTurn(drag ? drag.key : rotationKeyForHandle(activeHandle));
  // One decimal of precision, trimmed for whole (e.g. Shift-snapped) values.
  const exact = THREE.MathUtils.radToDeg(radians);
  const degrees = Math.abs(exact % 1) < 0.05 ? String(Math.round(exact)) : exact.toFixed(1);
  const centre = box.getCenter(new THREE.Vector3());
  // Bottom of the object, on the side facing the viewer, just past the red tick.
  const outward = camera.getWorldDirection(new THREE.Vector3());
  outward.y = 0;
  if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
  outward.normalize().negate();
  const reach = Math.abs(outward.x) * ((box.max.x - box.min.x) / 2) + Math.abs(outward.z) * ((box.max.z - box.min.z) / 2);
  const base = new THREE.Vector3(centre.x, box.min.y, centre.z).addScaledVector(outward, reach + 60 * pixelsToWorld(centre));
  const along = new THREE.Vector3(-outward.z, 0, outward.x).multiplyScalar(0.4);
  showRotationChip(resizeFrame, {
    camera,
    viewportWidth: renderer.domElement.clientWidth,
    viewportHeight: renderer.domElement.clientHeight,
    centre,
    text: (degrees > 0 ? "+" : "") + degrees + "\u00b0",
    from: base.clone().sub(along),
    to: base.clone().add(along),
  });
}
function restoreRotateStates(states) {
  restoreRotations(states);
  syncGizmo();
  ui.refresh();
  updateMeasure();
  scheduleSave();
}

function frameDragStart(id, raycaster, event) {
  if (selectionFrameVisible() === false) return;
  activeHandle = id;
  const box = unionBounds(state.selected);
  frameDrag = {
    id,
    box,
    snapshots: state.selected.map((object) => ({
      object,
      position: object.position.clone(),
      scale: object.scale.clone(),
      params: object.userData.params ? { ...object.userData.params } : null,
      baseY: new THREE.Box3().setFromObject(object).min.y,
    })),
  };
  if (isRotateHandle(id)) {
    rotationExpandedAxis = id === "rotY" ? "yaw" : id === "rotX" ? "tilt" : "roll";
    const centre = box.getCenter(new THREE.Vector3());
    const axis = id === "rotY" ? new THREE.Vector3(0, 1, 0) : id === "rotX" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const point = raycaster && id === "rotY" ? rotationPoint(raycaster, centre, axis) : null;
    frameDrag.rotate = {
      centre,
      axis,
      key: rotationKeyForHandle(id),
      delta: 0,
      startAngle: point ? yawAngle(centre, point) : 0,
      startY: event ? event.clientY : 0,
      startX: event ? event.clientX : 0,
      snapshots: state.selected.map((object) => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), turnY: object.userData.turnY || 0, turnX: object.userData.turnX || 0, turnZ: object.userData.turnZ || 0 })),
    };
  }
  transformControls.detach();
  showHandleRuler(id, box);
}

// Scaling a rotated object changes the height of its world bounding box, which can
// push it through the bed. Lift such objects back so they keep their original base.
function snapBasesToPlane(snapshots) {
  const box = new THREE.Box3();
  snapshots.forEach((snapshot) => {
    if (snapshot.baseY < -1e-6) return;
    box.setFromObject(snapshot.object);
    if (box.min.y < snapshot.baseY - 1e-6) snapshot.object.position.y += snapshot.baseY - box.min.y;
  });
}

function frameDragMove(raycaster, event) {
  if (frameDrag === null) return;
  if (frameDrag.rotate) {
    const { centre, axis, key, startAngle, startY, startX, snapshots: rotateSnapshots } = frameDrag.rotate;
    let raw = 0;
    if (key === "turnX") {
      // Vertical drag tilts the selection: about PITCH_DEG_PER_PX degrees per pixel.
      // Drag up (forwards) tips the object away from the viewer.
      raw = ((event ? event.clientY : startY) - startY) * THREE.MathUtils.degToRad(PITCH_DEG_PER_PX);
    } else if (key === "turnZ") {
      // Horizontal drag leans the selection: dragging right tips the top towards
      // +X, which is a negative turn about +Z.
      raw = ((event ? event.clientX : startX) - startX) * THREE.MathUtils.degToRad(-ROLL_DEG_PER_PX);
    } else {
      const point = rotationPoint(raycaster, centre, axis);
      if (!point) return;
      raw = yawAngle(centre, point) - startAngle;
    }
    let delta = Math.atan2(Math.sin(raw), Math.cos(raw));
    if (shiftHeld) delta = snapAngle(delta, THREE.MathUtils.degToRad(ROTATION_SNAP_DEG));
    frameDrag.rotate.delta = delta;
    applyRotation(rotateSnapshots, centre, axis, delta);
    showRotationReadout(frameDrag.box);
    updateMeasure();
    return;
  }
  const { box, id, snapshots } = frameDrag;
  const point = dragPointFor(raycaster, box, id);
  if (!point) return;
  if (id === "top") {
    const target = heightTarget(box, point.y, state.snap, FRAME_MIN_SIZE);
    const sy = Math.max(0.001, target.height / Math.max(1e-4, box.max.y - box.min.y));
    applyHeightScale(snapshots, target.baseY, sy);
  } else if (EDGE_HANDLES.includes(id)) {
    const target = edgeTarget(box, id, point, state.snap, FRAME_MIN_SIZE);
    if (id === "e" || id === "w") {
      const sx = Math.max(0.001, target.width / Math.max(1e-4, box.max.x - box.min.x));
      applyCornerScale(snapshots, new THREE.Vector3(target.anchorX, box.min.y, 0), sx, 1);
    } else {
      const sz = Math.max(0.001, target.depth / Math.max(1e-4, box.max.z - box.min.z));
      applyCornerScale(snapshots, new THREE.Vector3(0, box.min.y, target.anchorZ), 1, sz);
    }
    snapBasesToPlane(snapshots);
  } else {
    const target = cornerTarget(box, id, point, state.snap, FRAME_MIN_SIZE);
    const sx = Math.max(0.001, target.width / Math.max(1e-4, box.max.x - box.min.x));
    const sz = Math.max(0.001, target.depth / Math.max(1e-4, box.max.z - box.min.z));
    applyCornerScale(snapshots, new THREE.Vector3(target.anchorX, box.min.y, target.anchorZ), sx, sz);
    snapBasesToPlane(snapshots);
  }
  showHandleRuler(id, unionBounds(state.selected));
  updateMeasure();
}

function restoreFrameStates(states) {
  states.forEach(({ object, position, scale, params }) => {
    if (params && object.userData.params) {
      object.userData.params = { ...params };
      rebuildShapeGeometry(object, object.userData.params);
    }
    object.position.copy(position);
    object.scale.copy(scale);
  });
  syncGizmo();
  ui.refresh();
  updateMeasure();
  scheduleSave();
}

function frameDragEnd() {
  if (frameDrag === null) return;
  if (frameDrag.rotate) {
    rotationExpandedAxis = null;
    const { snapshots: rotateSnapshots, key, delta } = frameDrag.rotate;
    if (delta) {
      rotateSnapshots.forEach(({ object }) => {
        const next = (object.userData[key] || 0) + delta;
        object.userData[key] = Math.atan2(Math.sin(next), Math.cos(next));
      });
    }
    const after = rotateSnapshots.map(({ object }) => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), turnY: object.userData.turnY || 0, turnX: object.userData.turnX || 0, turnZ: object.userData.turnZ || 0 }));
    const turned = rotateSnapshots.some((before, i) => before.position.equals(after[i].position) === false || before.quaternion.equals(after[i].quaternion) === false);
    showRotationReadout(frameDrag.box);
    frameDrag = null;
    if (activeHandle === null) hideResizeMeasures(resizeFrame);
    syncGizmo();
    if (turned) {
      history.push({ undo: () => restoreRotateStates(rotateSnapshots), redo: () => restoreRotateStates(after) });
      updateHistoryUI();
    }
    ui.refresh();
    updateMeasure();
    scheduleSave();
    return;
  }
  const { snapshots } = frameDrag;
  snapshots.forEach(({ object, position }) => {
    const finalPosition = object.position.clone();
    const baseBefore = new THREE.Box3().setFromObject(object).min.y;
    // Bake against the pre-drag position so the lift baked into params matches the original,
    // then restore the position the drag produced and pin the world base exactly.
    object.position.copy(position);
    if (object.userData.params && SHAPE_DEFS[object.userData.shapeType]) bakeScaleIntoParams(object);
    object.position.copy(finalPosition);
    const baseAfter = new THREE.Box3().setFromObject(object).min.y;
    object.position.y += baseBefore - baseAfter;
  });
  const after = snapshots.map(({ object }) => ({
    object,
    position: object.position.clone(),
    scale: object.scale.clone(),
    params: object.userData.params ? { ...object.userData.params } : null,
  }));
  const changed = snapshots.some((before, i) => before.position.equals(after[i].position) === false || before.scale.equals(after[i].scale) === false);
  frameDrag = null;
  hideResizeMeasures(resizeFrame);
  syncGizmo();
  if (changed) {
    history.push({ undo: () => restoreFrameStates(snapshots), redo: () => restoreFrameStates(after) });
    updateHistoryUI();
  }
  ui.refresh();
  updateMeasure();
  scheduleSave();
}


// ---- body drag: press a shape and slide it across the floor ------------------
// Vertical movement is impossible by construction: only x/z are ever written.

let bodyDrag = null;

// Where the pointer ray crosses a horizontal plane at `y`.
function horizontalPoint(raycaster, y) {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}

function beginBodyDrag(object, raycaster, event) {
  if (bodyDrag !== null) endBodyDrag(); // self-healing: never inherit a stale session
  if (frameDrag !== null) return false;
  if (event && event.shiftKey) return false; // Shift builds a selection instead
  if (transformControls.dragging || transformControls.axis) return false; // gizmo wins
  if (object.userData.locked === true) return false;
  if (!raycaster) return false;
  // Grab on a plane through the shape's middle: the delta then reads naturally
  // however high the object sits, and only its x/z are ever used.
  const bounds = new THREE.Box3().setFromObject(object);
  const planeY = (bounds.min.y + bounds.max.y) / 2;
  const start = horizontalPoint(raycaster, planeY);
  if (!start) return false;
  // Grab-and-go: pressing an unselected shape selects it and starts dragging.
  if (state.selected.includes(object) === false) interaction.setSelected([object]);
  if (state.selected.length === 0) return false;
  bodyDrag = {
    planeY,
    start,
    entries: state.selected.map((o) => ({ object: o, before: captureTransform(o) })),
  };
  gesture = { mode: "translate", startPos: bodyDrag.entries[0].before.position.clone() };
  activeHandle = null;
  hideResizeMeasures(resizeFrame);
  hideRotationChip(resizeFrame);
  return true;
}

function moveBodyDrag(raycaster) {
  if (bodyDrag === null) return;
  const point = horizontalPoint(raycaster, bodyDrag.planeY);
  if (!point) return;
  let dx = point.x - bodyDrag.start.x;
  let dz = point.z - bodyDrag.start.z;
  // Snap the movement, not the positions, so a multi-selection keeps its offsets.
  const step = state.snap;
  if (step > 0) {
    dx = Math.round(dx / step) * step;
    dz = Math.round(dz / step) * step;
  }
  bodyDrag.entries.forEach(({ object, before }) => {
    object.position.set(before.position.x + dx, before.position.y, before.position.z + dz);
  });
  updateRuler();
  updateMeasure();
  ui.refresh();
}

function endBodyDrag() {
  if (bodyDrag === null) return;
  const entries = bodyDrag.entries;
  bodyDrag = null;
  gesture = null;
  updateRuler(); // hides the ruler groups
  const objects = entries.map((entry) => entry.object);
  const before = entries.map((entry) => entry.before);
  const moved = objects.some((object, i) => object.position.equals(before[i].position) === false);
  if (moved) {
    const after = objects.map((object) => captureTransform(object));
    history.push({
      undo: () => {
        objects.forEach((object, i) => applyTransform(object, before[i]));
        ui.refresh();
        updateMeasure();
        scheduleSave();
      },
      redo: () => {
        objects.forEach((object, i) => applyTransform(object, after[i]));
        ui.refresh();
        updateMeasure();
        scheduleSave();
      },
    });
    updateHistoryUI();
  }
  ui.refresh();
  updateMeasure();
  scheduleSave();
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
  setChipSize(labelWorldHeight() * 0.75);

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
  setChipSize(labelWorldHeight() * 0.75);

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
  setChipSize(labelWorldHeight() * 0.75);

  drawRulerText(text);
  rulerGroup.visible = true;
}

function alignSelection(axis, mode) {
  if (lockedSelection()) return;
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

// Move each selected object straight down so its lowest point rests on the work plane.
function dropSelection() {
  if (lockedSelection()) return;
  const objects = [...state.selected];
  if (!objects.length) return;

  const before = objects.map(captureTransform);
  objects.forEach((o) => {
    const box = objectBox(o);
    if (!box.isEmpty() && Math.abs(box.min.y) > 1e-6) o.position.y -= box.min.y;
  });
  const after = objects.map(captureTransform);

  if (objects.some((o, i) => !transformsEqual(before[i], after[i]))) {
    history.push({
      undo: () => objects.forEach((o, i) => applyTransform(o, before[i])),
      redo: () => objects.forEach((o, i) => applyTransform(o, after[i])),
    });
    updateHistoryUI();
    scheduleSave();
  }
  ui.refresh();
  updateMeasure();
}

// ---- export -----------------------------------------------------------------

const exportModal = document.getElementById('export-modal');
const exportDialog = document.getElementById('export-dialog');
const exportScopeSelect = document.getElementById('export-scope');
const exportSelectionOption = exportScopeSelect.querySelector('option[value="selection"]');
const exportFormatButtons = [...document.querySelectorAll('#export-dialog [data-format]')];
const exportCounts = document.getElementById('export-counts');
const exportDecimate = document.getElementById('export-decimate');
const exportDecimateValue = document.getElementById('export-decimate-value');
const exportDecimated = document.getElementById('export-decimated');
const exportEmpty = document.getElementById('export-empty');
const exportTrigger = document.getElementById('export');

const MIN_DECIMATE_TRIS = 24;
let exportBusy = false;
let previewTimer = null;
let previewToken = 0;
let decimationCache = null;
let simplifyToolsPromise = null;

function exportObjects() {
  const objects = exportScopeSelect.value === "selection" ? [...state.selected] : [...state.shapes];
  // Reference images are tracing guides, not geometry.
  return objects.filter((object) => !getMeshes(object).every((mesh) => mesh.userData.referenceImage === true));
}

function triCount(geometry) {
  return Math.round((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);
}

const fmt = (n) => n.toLocaleString();

function collectExportStats(objects) {
  let verts = 0;
  let tris = 0;
  objects.forEach((object) => {
    getMeshes(object).forEach((mesh) => {
      if (mesh.userData.referenceImage) return;
      const geometry = mesh.geometry;
      if (!geometry?.attributes?.position) return;
      verts += geometry.attributes.position.count;
      tris += triCount(geometry);
    });
  });
  return { verts, tris };
}

function updateExportState() {
  const objects = exportObjects();
  const stats = collectExportStats(objects);
  exportCounts.textContent = `Vertices ${fmt(stats.verts)} · Triangles ${fmt(stats.tris)}`;

  const empty = objects.length === 0;
  exportEmpty.hidden = !empty;
  exportScopeSelect.disabled = exportBusy;
  exportDecimate.disabled = exportBusy || empty;
  exportFormatButtons.forEach((btn) => { btn.disabled = exportBusy || empty; });
}

function setExportBusy(busy) {
  exportBusy = busy;
  if (busy) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  exportDialog.setAttribute('aria-busy', String(busy));
  updateExportState();
}

// meshoptimizer's WASM is ~55 KB, so only load it when decimation is first used.
function loadSimplifyTools() {
  if (!simplifyToolsPromise) {
    simplifyToolsPromise = Promise.all([
      import('three/addons/modifiers/SimplifyModifier.js'),
      import('three/addons/utils/BufferGeometryUtils.js'),
    ]).then(([modifierModule, utilsModule]) => ({
      modifier: new modifierModule.SimplifyModifier(),
      mergeVertices: utilsModule.mergeVertices,
    })).catch((error) => {
      simplifyToolsPromise = null;
      throw error;
    });
  }
  return simplifyToolsPromise;
}

// Drop the cached decimated group and the geometries we created for it — never
// the scene's shared geometries.
function invalidateDecimation() {
  previewToken += 1;
  clearTimeout(previewTimer);
  previewTimer = null;
  if (decimationCache) {
    decimationCache.owned.forEach((geometry) => geometry.dispose());
    decimationCache = null;
  }
  if (exportDecimated) {
    exportDecimated.textContent = '';
  }
}

function decimationKey() {
  return `${exportScopeSelect.value}:${exportDecimate.value}`;
}

function openExportDialog() {
  const hasSelection = state.selected.length > 0;
  exportSelectionOption.disabled = !hasSelection;
  exportScopeSelect.value = hasSelection ? 'selection' : 'scene';
  exportDecimate.value = '0';
  exportDecimateValue.textContent = '0%';
  invalidateDecimation();
  updateExportState();
  exportModal.hidden = false;
  exportScopeSelect.focus();
}

function closeExportDialog() {
  if (exportBusy) return;
  exportModal.hidden = true;
  invalidateDecimation();
  exportTrigger?.focus();
}

function buildExportGroup() {
  const group = new THREE.Group();
  exportObjects().forEach((o) => group.add(o.clone(true)));
  // Reference planes are guides only; drop them from the export copy.
  const guides = [];
  group.traverse((object) => { if (object.isMesh && object.userData.referenceImage) guides.push(object); });
  guides.forEach((mesh) => { if (mesh.parent) mesh.parent.remove(mesh); });
  group.updateMatrixWorld(true);
  return group;
}

// Simplify one cloned mesh. Its geometry may be shared with the scene, so only
// the new geometries we create are tracked for later disposal.
async function decimateMesh(mesh, reduction, tools, owned) {
  const original = mesh.geometry;
  if (!original?.attributes?.position) return;
  const tris = triCount(original);
  if (tris < MIN_DECIMATE_TRIS) return;

  let temporary = null;
  try {
    // Indexed primitives can contain seam-duplicated vertices (UV/normal/cap
    // seams); weld them first so edges can collapse across those seams.
    temporary = tools.mergeVertices(original);
    const welded = temporary;
    const targetTris = Math.max(MIN_DECIMATE_TRIS, Math.round(tris * (1 - reduction)));
    const remove = Math.round((1 - targetTris / tris) * welded.attributes.position.count);
    if (remove <= 0) return;

    const simplified = await tools.modifier.modify(welded, remove);
    if (simplified?.attributes?.position?.count > 0) {
      mesh.geometry = simplified;
      owned.push(simplified);
    } else {
      simplified?.dispose();
    }
  } catch (error) {
    console.warn('Decimation failed for a mesh; keeping the original.', error);
  } finally {
    temporary?.dispose();
  }
}

async function buildDecimatedGroup(reduction, token) {
  const tools = await loadSimplifyTools();
  if (token !== previewToken) return null;

  const group = buildExportGroup();
  const owned = [];
  try {
    const meshes = [];
    group.traverse((object) => { if (object.isMesh) meshes.push(object); });

    for (const mesh of meshes) {
      if (token !== previewToken) break;
      await decimateMesh(mesh, reduction, tools, owned);
    }
    if (token !== previewToken) {
      owned.forEach((geometry) => geometry.dispose());
      return null;
    }
    return { group, stats: collectExportStats([group]), owned };
  } catch (error) {
    owned.forEach((geometry) => geometry.dispose());
    throw error;
  }
}

async function previewDecimation() {
  const reduction = Number(exportDecimate.value) / 100;
  if (reduction <= 0 || !exportObjects().length) return;

  const token = previewToken;
  exportDecimated.textContent = 'Decimating…';
  try {
    const result = await buildDecimatedGroup(reduction, token);
    if (!result || token !== previewToken) return;
    if (decimationCache) decimationCache.owned.forEach((geometry) => geometry.dispose());
    decimationCache = { key: decimationKey(), ...result };
    exportDecimated.textContent = `Decimated: ${fmt(result.stats.verts)} verts · ${fmt(result.stats.tris)} tris`;
  } catch (error) {
    console.error('Decimation failed:', error);
    if (token === previewToken) exportDecimated.textContent = 'Decimation unavailable.';
  }
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { previewDecimation(); }, 200);
}

async function downloadExport(format) {
  if (exportBusy || !exportObjects().length) return;

  const reduction = Number(exportDecimate.value) / 100;
  setExportBusy(true);

  try {
    let group;
    if (reduction > 0) {
      const key = decimationKey();
      if (!decimationCache || decimationCache.key !== key) {
        const token = ++previewToken;
        exportDecimated.textContent = 'Decimating…';
        const result = await buildDecimatedGroup(reduction, token);
        if (!result) return;
        if (decimationCache) decimationCache.owned.forEach((geometry) => geometry.dispose());
        decimationCache = { key, ...result };
        exportDecimated.textContent = `Decimated: ${fmt(result.stats.verts)} verts · ${fmt(result.stats.tris)} tris`;
      }
      group = decimationCache.group;
    } else {
      group = buildExportGroup();
    }

    const base = exportScopeSelect.value === 'selection' ? 'sleek3d-selection' : 'sleek3d-model';
    if (format === 'stl') {
      download(`${base}.stl`, new STLExporter().parse(group), 'model/stl');
    } else if (format === 'obj') {
      download(`${base}.obj`, new OBJExporter().parse(group), 'text/plain');
    } else if (format === 'glb') {
      const result = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(group, resolve, reject, { binary: true });
      });
      download(`${base}.glb`, result, 'model/gltf-binary');
    }
  } catch (error) {
    console.error('Export failed:', error);
    exportDecimated.textContent = 'Export failed — see console.';
  } finally {
    setExportBusy(false);
    exportScopeSelect.focus();
  }
}

function onExport() {
  openExportDialog();
}

document.getElementById('export-close')?.addEventListener('click', closeExportDialog);
exportModal?.addEventListener('click', (event) => {
  if (event.target === exportModal) closeExportDialog();
});
exportScopeSelect?.addEventListener('change', () => {
  invalidateDecimation();
  updateExportState();
  if (Number(exportDecimate.value) > 0) schedulePreview();
});
exportDecimate?.addEventListener('input', () => {
  exportDecimateValue.textContent = `${exportDecimate.value}%`;
  invalidateDecimation();
  if (Number(exportDecimate.value) > 0) schedulePreview();
});
exportFormatButtons.forEach((btn) => {
  btn.addEventListener('click', () => downloadExport(btn.dataset.format));
});
// Runs after the focused control has handled the key (bubble phase), then keeps
// scene shortcuts (undo, delete, tool keys…) from firing behind the dialog.
exportDialog?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeExportDialog();
  event.stopPropagation();
});

// ---- reset / snap -----------------------------------------------------------

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

function download(filename, data, type = 'application/octet-stream') {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- seeded demo ------------------------------------------------------------

function seedDemo() {
  // A box with a cylindrical tunnel through it (subtraction demo).
  const box = SHAPE_FACTORIES.box({ w: 30, h: 15, d: 20 });
  box.position.set(0, 7.5, 0);

  const cutter = SHAPE_FACTORIES.cylinder({ r: 6, h: 40 });
  cutter.position.set(0, 7.5, 0);
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
  const sphere = SHAPE_FACTORIES.sphere({ r: 9 });
  sphere.position.set(25, 9, 15);
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
  updateGrid(gridGroup, s);
  applyStudioScale(lights, s.gridWidth, s.gridLength);
  applyShadowTint(ground, s.background);

  // Everything camera- and light-related scales with the work area so a 20 cm
  // print bed can be framed and lit the same way the original 40 mm grid was.
  const maxGrid = Math.max(s.gridWidth, s.gridLength);
  scene.fog.near = maxGrid;
  scene.fog.far = maxGrid * 3.5;
  perspectiveCamera.far = Math.min(2000, Math.max(300, maxGrid * 8));
  perspectiveCamera.updateProjectionMatrix();
  if (orthoCamera) {
    orthoCamera.far = perspectiveCamera.far;
    orthoCamera.updateProjectionMatrix();
  }
  controls.minDistance = Math.max(1, maxGrid * 0.01);
  controls.maxDistance = Math.max(80, Math.hypot(s.gridWidth, s.gridLength) * 1.4);

  computeHomeView(s);
  if (homeApplied === false) {
    homeApplied = true;
    camera.position.copy(homeView.position);
    controls.target.copy(homeView.target);
    camera.lookAt(homeView.target);
    controls.update();
  }

  // Grid labels lie flat near the corners and scale with the grid.
  const labelColor = gridLabelColor(s.background);
  unitLabel.draw('Unit: ' + getUnit(s), labelColor);
  titleLabel.draw('Sleek 3D', labelColor);
  layoutGridLabel(unitLabel, s, UNIT_LABEL_FRAC, 1, 1); // lower-right
  layoutGridLabel(titleLabel, s, TITLE_LABEL_FRAC, -1, 1); // lower-left
}

let gridBeforeImperial = null;

// Imperial grids show 1 in squares, which need more room than the 40 mm metric
// default, so the work area grows when switching to imperial and is restored
// when switching back. Sizes the user picked themselves are never overwritten.
function applyUnitGridSize() {
  const imperial = gridFamily(settings) === "imperial";
  const isAuto = Math.abs(settings.gridWidth - IMPERIAL_GRID_SIZE) < 0.01 && Math.abs(settings.gridLength - IMPERIAL_GRID_SIZE) < 0.01;
  if (imperial) {
    const largest = Math.max(settings.gridWidth, settings.gridLength);
    if (largest < IMPERIAL_GRID_SIZE - 0.01) {
      gridBeforeImperial = { gridWidth: settings.gridWidth, gridLength: settings.gridLength };
      settings.gridWidth = IMPERIAL_GRID_SIZE;
      settings.gridLength = IMPERIAL_GRID_SIZE;
    }
    return;
  }
  if (gridBeforeImperial && isAuto) {
    settings.gridWidth = gridBeforeImperial.gridWidth;
    settings.gridLength = gridBeforeImperial.gridLength;
  }
  gridBeforeImperial = null;
}

function updateSetting(changes) {
  const previousFamily = gridFamily(settings);
  Object.assign(settings, changes);
  if (gridFamily(settings) !== previousFamily) applyUnitGridSize();
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
    getMeshes(obj).forEach(refreshMeshAppearance);
  });
  applyOnTopGhosts();
} else {
  seedDemo();
}
renderSnapOptions();
ui.refresh();
updateHistoryUI();
ui.setClipboardState(false);
initTooltips();

function animate() {
  requestAnimationFrame(animate);
  updateViewTween(performance.now());
  controls.update();
  updateGridLod(gridGroup, camera, renderer.domElement.clientHeight);
  updateFrameFromSelection();
  viewCube.update();
  renderer.render(scene, camera);
}
animate();
