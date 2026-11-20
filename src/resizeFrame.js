import * as THREE from "three";
import { CORNER_HANDLES } from "./selectionResize.js";

const HANDLE_PX = 11;
const OUTLINE_PX = 1.5;
const BASE_COLOR = 0xffffff;
const HOVER_COLOR = 0x4a90d9;
const UP = new THREE.Vector3(0, 1, 0);
const CHIP_H = 128; // chip canvas height in px; the width follows the text
const CHIP_SCALE_H = 1.15; // chip height as a multiple of the shared label size

function makeHandleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(15, 20, 26, 0.92)";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(6, 6, size - 12, size - 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// World units per screen pixel at a given distance from the camera.
function worldPerPixel(camera, distance, viewportHeight) {
  if (camera.isOrthographicCamera) {
    return ((camera.top - camera.bottom) / camera.zoom) / viewportHeight;
  }
  const fov = THREE.MathUtils.degToRad(camera.fov);
  return (2 * distance * Math.tan(fov / 2)) / viewportHeight;
}

// One dimension readout: a thin rod spanning a single edge plus a label chip at
// its midpoint. The frame owns two of these so width and depth each get their
// own chip on their own edge line instead of sharing one combined label.
function createMeasure() {
  const group = new THREE.Group();
  group.visible = false;

  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
  );
  rod.renderOrder = 990;
  group.add(rod);

  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = CHIP_H;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const chip = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  chip.renderOrder = 996;
  group.add(chip);

  return { group, rod, chip, canvas, ctx, texture, aspect: canvas.width / canvas.height, text: "" };
}

export function createResizeFrame() {
  const texture = makeHandleTexture();
  const group = new THREE.Group();
  group.name = "resize-frame";
  group.visible = false;

  const outlineMat = new THREE.MeshBasicMaterial({ color: BASE_COLOR, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const outline = [];
  for (let i = 0; i < 4; i = i + 1) {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), outlineMat);
    edge.rotation.x = -Math.PI / 2;
    edge.renderOrder = 980;
    group.add(edge);
    outline.push(edge);
  }

  const handles = new Map();
  CORNER_HANDLES.forEach((id) => {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const handle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    handle.rotation.x = -Math.PI / 2;
    handle.renderOrder = 990;
    handle.userData.handle = id;
    group.add(handle);
    handles.set(id, handle);
  });

  const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  top.renderOrder = 995;
  top.userData.handle = "top";
  group.add(top);

  const ruler = new THREE.Group();
  ruler.visible = false;
  const measures = [createMeasure(), createMeasure()];
  measures.forEach((measure) => ruler.add(measure.group));
  group.add(ruler);

  return { group, outline, handles, top, ruler, measures };
}

export function updateResizeFrame(frame, { box, camera, viewportHeight, visible }) {
  const show = visible === true && box && box.isEmpty() === false && viewportHeight > 0;
  frame.group.visible = show;
  if (show === false) {
    frame.ruler.visible = false;
    return;
  }

  const y = box.min.y + 0.02;
  const midX = (box.min.x + box.max.x) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  const width = box.max.x - box.min.x;
  const depth = box.max.z - box.min.z;
  const pxAt = (x, py, z) => worldPerPixel(camera, camera.position.distanceTo(new THREE.Vector3(x, py, z)), viewportHeight);

  const t = OUTLINE_PX * pxAt(midX, y, midZ);
  const edgeDefs = [
    { x: midX, z: box.min.z, len: width, along: true },
    { x: midX, z: box.max.z, len: width, along: true },
    { x: box.min.x, z: midZ, len: depth, along: false },
    { x: box.max.x, z: midZ, len: depth, along: false },
  ];
  edgeDefs.forEach((def, i) => {
    const mesh = frame.outline[i];
    mesh.position.set(def.x, y, def.z);
    if (def.along) mesh.scale.set(Math.max(def.len, t), t, 1);
    else mesh.scale.set(t, Math.max(def.len, t), 1);
  });

  const corners = {
    nw: [box.min.x, box.min.z],
    ne: [box.max.x, box.min.z],
    sw: [box.min.x, box.max.z],
    se: [box.max.x, box.max.z],
  };
  frame.handles.forEach((mesh, id) => {
    const pos = corners[id];
    const size = HANDLE_PX * pxAt(pos[0], y, pos[1]);
    mesh.position.set(pos[0], y + 0.01, pos[1]);
    mesh.scale.set(size, size, 1);
    mesh.userData.size = size;
  });

  const topSize = HANDLE_PX * pxAt(midX, box.max.y, midZ) * 1.2;
  frame.top.position.set(midX, box.max.y + topSize * 0.95, midZ);
  frame.top.scale.set(topSize, topSize, 1);
  frame.top.userData.size = topSize;
}

export function pickResizeHandle(frame, raycaster) {
  if (frame.group.visible === false) return null;
  const targets = [...frame.handles.values(), frame.top];
  const hits = raycaster.intersectObjects(targets, false);
  return hits.length ? hits[0].object.userData.handle : null;
}

export function setHoveredResizeHandle(frame, id) {
  frame.handles.forEach((mesh, key) => mesh.material.color.setHex(key === id ? HOVER_COLOR : BASE_COLOR));
  frame.top.material.color.setHex(id === "top" ? HOVER_COLOR : BASE_COLOR);
}

function roundRect(ctx, x, y, w, h, r) {
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

function drawChip(measure, text) {
  measure.text = text;
  const ctx = measure.ctx;
  const fontFor = (px) => "bold " + px + "px ui-monospace, Menlo, Consolas, monospace";
  let px = 64;
  ctx.font = fontFor(px);
  let textWidth = ctx.measureText(text).width;
  while (textWidth > 460 && px > 20) {
    px -= 4;
    ctx.font = fontFor(px);
    textWidth = ctx.measureText(text).width;
  }
  const w = Math.max(132, Math.ceil(textWidth + 88));
  if (measure.canvas.width !== w) measure.canvas.width = w;
  ctx.font = fontFor(px);
  ctx.clearRect(0, 0, w, CHIP_H);
  ctx.fillStyle = "rgba(20, 24, 28, 0.9)";
  roundRect(ctx, 4, 4, w - 8, CHIP_H - 8, 30);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, CHIP_H / 2 + 2);
  measure.aspect = w / CHIP_H;
  measure.texture.needsUpdate = true;
}

// Screen-space angle of an edge, so each chip can lie along its own dimension
// line. Normalised into +-90 degrees so a label never renders upside-down.
function screenAngle(camera, from, to) {
  if (!camera) return 0;
  const a = from.clone().project(camera);
  const b = to.clone().project(camera);
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return angle;
}

function layoutMeasure(measure, spec, size, camera) {
  const { from, to, offset, text, align } = spec;
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const radius = Math.max(0.02, size * 0.05);
  measure.rod.position.copy(from).addScaledVector(dir, 0.5);
  measure.rod.scale.set(radius, Math.max(len, 1e-4), radius);
  if (len > 1e-5) measure.rod.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  drawChip(measure, text);
  measure.chip.position.copy(from).addScaledVector(dir, 0.5);
  if (offset) measure.chip.position.add(offset);
  measure.chip.scale.set(size * CHIP_SCALE_H * measure.aspect, size * CHIP_SCALE_H, 1);
  measure.chip.material.rotation = align === true ? screenAngle(camera, from, to) : 0;
}

// Draw up to two dimension readouts; unused slots are hidden, so the height
// handle still shows a single box.
export function showResizeMeasures(frame, { measures, size, camera }) {
  frame.ruler.visible = true;
  frame.measures.forEach((measure, i) => {
    const spec = measures[i];
    measure.group.visible = Boolean(spec);
    if (spec) layoutMeasure(measure, spec, size, camera);
  });
}

export function hideResizeMeasures(frame) {
  frame.ruler.visible = false;
}
