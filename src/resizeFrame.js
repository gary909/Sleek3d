import * as THREE from "three";
import { CORNER_HANDLES } from "./selectionResize.js";

const HANDLE_PX = 11;
const OUTLINE_PX = 1.5;
const BASE_COLOR = 0xffffff;
const HOVER_COLOR = 0x4a90d9;

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
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
  );
  rod.renderOrder = 990;
  ruler.add(rod);

  const chipCanvas = document.createElement("canvas");
  chipCanvas.width = 512;
  chipCanvas.height = 128;
  const chipCtx = chipCanvas.getContext("2d");
  const chipTexture = new THREE.CanvasTexture(chipCanvas);
  chipTexture.minFilter = THREE.LinearFilter;
  const chip = new THREE.Sprite(new THREE.SpriteMaterial({ map: chipTexture, transparent: true, depthTest: false, depthWrite: false }));
  chip.renderOrder = 996;
  ruler.add(chip);
  group.add(ruler);

  return { group, outline, handles, top, ruler, rod, chip, chipCtx, chipCanvas, chipTexture };
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

function drawChip(frame, text) {
  const ctx = frame.chipCtx;
  const w = frame.chipCanvas.width;
  const h = frame.chipCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(20, 24, 28, 0.9)";
  roundRect(ctx, 4, 4, w - 8, h - 8, 26);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 60;
  ctx.font = "bold " + size + "px ui-monospace, Menlo, Consolas, monospace";
  while (ctx.measureText(text).width > w - 48 && size > 20) {
    size -= 4;
    ctx.font = "bold " + size + "px ui-monospace, Menlo, Consolas, monospace";
  }
  ctx.fillText(text, w / 2, h / 2 + 2);
  frame.chipTexture.needsUpdate = true;
}

export function showResizeRuler(frame, { text, from, to, chipOffset, size }) {
  frame.ruler.visible = true;
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const radius = Math.max(0.02, size * 0.05);
  frame.rod.position.copy(from).addScaledVector(dir, 0.5);
  frame.rod.scale.set(radius, Math.max(len, 1e-4), radius);
  if (len > 1e-5) frame.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  drawChip(frame, text);
  frame.chip.position.copy(from).addScaledVector(dir, 0.5).add(chipOffset);
  frame.chip.scale.set(size * 6, size * 1.5, 1);
}

export function hideResizeRuler(frame) {
  frame.ruler.visible = false;
}
