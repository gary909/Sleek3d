import * as THREE from "three";
import { CORNER_HANDLES, EDGE_HANDLES } from "./selectionResize.js";

const HANDLE_PX = 11;
const MID_HANDLE_PX = 8; // mid-edge handles are smaller than the corner squares
const OUTLINE_PX = 1.5;
const BASE_COLOR = 0xffffff;
const HOVER_COLOR = 0x4a90d9;
const UP = new THREE.Vector3(0, 1, 0);
const CHIP_H = 128; // chip canvas height in px; the width follows the text
const CHIP_PX_H = 20; // chip box height in screen pixels, constant at any zoom
const CHIP_GAP_PX = 7; // gap between a rod and its chip, in screen pixels
const HEAD_PX = 10; // arrowhead length at each end of a dimension line
const HEAD_RADIUS_PX = 4.5; // arrowhead half-width

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

  const headGeometry = new THREE.ConeGeometry(1, 1, 10);
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
  const heads = [0, 1].map(() => {
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.renderOrder = 991;
    group.add(head);
    return head;
  });

  return { group, rod, chip, heads, canvas, ctx, texture, aspect: canvas.width / canvas.height, text: "" };
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

  EDGE_HANDLES.forEach((id) => {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const handle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    handle.rotation.x = -Math.PI / 2;
    handle.renderOrder = 992;
    handle.userData.handle = id;
    handle.userData.edge = true;
    group.add(handle);
    handles.set(id, handle);
  });

  const top = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  top.renderOrder = 995;
  top.userData.handle = "top";
  group.add(top);

  const ruler = new THREE.Group();
  ruler.visible = false;
  // Two slots for the width/depth/height chips, one for the rotation readout.
  const measures = [createMeasure(), createMeasure(), createMeasure()];
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
  const mids = {
    n: [midX, box.min.z],
    s: [midX, box.max.z],
    w: [box.min.x, midZ],
    e: [box.max.x, midZ],
  };
  frame.handles.forEach((mesh, id) => {
    const isEdge = mesh.userData.edge === true;
    const pos = isEdge ? mids[id] : corners[id];
    const size = (isEdge ? MID_HANDLE_PX : HANDLE_PX) * pxAt(pos[0], y, pos[1]);
    mesh.position.set(pos[0], y + (isEdge ? 0.02 : 0.01), pos[1]);
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
  const base = frame.ink ? frame.ink.base : BASE_COLOR;
  const hover = frame.ink ? frame.ink.hover : HOVER_COLOR;
  frame.handles.forEach((mesh, key) => mesh.material.color.setHex(key === id ? hover : base));
  frame.top.material.color.setHex(id === "top" ? hover : base);
}

// Recolour the frame outlines, the dimension rods and their arrowheads so they stay
// legible whatever the work-plane background is. Handle textures already carry a
// dark border of their own, so they need no change.
export function setResizeFrameInk(frame, ink) {
  frame.ink = ink;
  frame.outline.forEach((edge) => edge.material.color.setHex(ink.base));
  frame.measures.forEach((measure) => {
    measure.rod.material.color.setHex(ink.base);
    measure.heads.forEach((head) => head.material.color.setHex(ink.base));
  });
  setHoveredResizeHandle(frame, null);
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
  if (measure.text === text) return; // unchanged text: reuse the texture
  measure.text = text;
  const ctx = measure.ctx;
  const fontFor = (px) => "bold " + px + "px ui-monospace, Menlo, Consolas, monospace";
  let px = 64;
  ctx.font = fontFor(px);
  const w = measure.canvas.width;
  // Never resize the canvas: that reallocates the texture mid-drag, which froze
  // the rotation readout. Shrink the font to fit instead.
  while (ctx.measureText(text).width > w - 56 && px > 18) {
    px -= 4;
    ctx.font = fontFor(px);
  }
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

// Screen-space perpendicular to the measured edge, pointing away from the
// shape, expressed in world space. Keeps each chip beside its own rod without
// covering the object, whatever the zoom or view angle.
function chipDirection(camera, from, to, mid, centre, viewportWidth, viewportHeight) {
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const a = from.clone().project(camera);
  const b = to.clone().project(camera);
  let px = -(b.y - a.y) * viewportHeight;
  let py = (b.x - a.x) * viewportWidth;
  const len = Math.hypot(px, py);
  if (len < 1e-6) {
    px = 1;
    py = 0;
  } else {
    px /= len;
    py /= len;
  }
  if (centre) {
    const m = mid.clone().project(camera);
    const c = centre.clone().project(camera);
    if (px * (m.x - c.x) + py * (m.y - c.y) < 0) {
      px = -px;
      py = -py;
    }
  }
  return right.multiplyScalar(px).addScaledVector(up, py).normalize();
}

function layoutMeasure(measure, spec, camera, viewportWidth, viewportHeight, centre) {
  const { text, gapAxis, level, outsetPx } = spec;
  const from = spec.from.clone();
  const to = spec.to.clone();
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const startMid = from.clone().add(to).multiplyScalar(0.5);
  const wpp = worldPerPixel(camera, camera.position.distanceTo(startMid), viewportHeight);
  if (outsetPx && len > 1e-5) {
    // Slide the whole line sideways in the work plane, away from the shape, so
    // it clears the frame outline while staying parallel to the edge it measures.
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    if (perp.lengthSq() > 1e-9) {
      perp.normalize();
      if (perp.dot(startMid.clone().sub(centre)) < 0) perp.negate();
      const push = perp.multiplyScalar(outsetPx * wpp);
      from.add(push);
      to.add(push);
    }
  }
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const radius = Math.max(0.6 * wpp, 1e-5); // ~1.2 px thick at any zoom
  measure.rod.position.copy(mid);
  measure.rod.scale.set(radius, Math.max(len, 1e-4), radius);
  if (len > 1e-5) measure.rod.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
  // Arrowheads at both ends of the line, sized in screen pixels like the rod.
  const headLen = HEAD_PX * wpp;
  const headRadius = HEAD_RADIUS_PX * wpp;
  const showHeads = len > 1e-5 && len / wpp > headLen * 2.5;
  measure.heads.forEach((head, i) => {
    head.visible = showHeads;
    if (showHeads === false) return;
    const outward = dir.clone().normalize();
    if (i === 0) outward.negate();
    const tip = i === 0 ? from : to;
    head.scale.set(headRadius, headLen, headRadius);
    head.position.copy(tip).addScaledVector(outward, -headLen / 2);
    head.quaternion.setFromUnitVectors(UP, outward);
  });

  drawChip(measure, text);
  const h = CHIP_PX_H * wpp;
  const w = h * measure.aspect;
  const gap = (gapAxis === "width" ? w : h) / 2 + CHIP_GAP_PX * wpp;
  measure.chip.position.copy(mid).addScaledVector(chipDirection(camera, from, to, mid, centre, viewportWidth, viewportHeight), gap);
  if (level === true) {
    // Keep this chip level with the midpoint of its line: the perpendicular
    // offset can otherwise drop it below the line on steep (depth) edges.
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const chipNdc = measure.chip.position.clone().project(camera);
    const midNdc = mid.clone().project(camera);
    const lift = (midNdc.y - chipNdc.y) * wpp * viewportHeight * 0.5;
    if (lift > 0) measure.chip.position.addScaledVector(up, lift);
  }
  measure.chip.scale.set(w, h, 1);
}

export function showResizeMeasures(frame, { measures, camera, viewportWidth, viewportHeight, centre }) {
  frame.ruler.visible = true;
  frame.measures.forEach((measure, i) => {
    if (i > 1) return; // the rotation readout owns the third chip
    const spec = measures[i];
    measure.group.visible = Boolean(spec);
    if (spec) layoutMeasure(measure, spec, camera, viewportWidth, viewportHeight, centre);
  });
}

export function hideResizeMeasures(frame) {
  frame.ruler.visible = false;
}

// The rotation readout lives in its own chip so it can never be mistaken for a
// width/depth/height label, and it disappears the moment its handle is left.
export function showRotationChip(frame, spec) {
  frame.ruler.visible = true;
  const measure = frame.measures[2];
  measure.group.visible = true;
  layoutMeasure(measure, { ...spec, level: true }, spec.camera, spec.viewportWidth, spec.viewportHeight, spec.centre);
}

export function hideRotationChip(frame) {
  frame.measures[2].group.visible = false;
}
