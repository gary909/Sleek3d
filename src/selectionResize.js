import * as THREE from "three";

// Pure geometry helpers for the resize frame: everything here is unit-testable
// without a renderer (box maths, snapping and anchored scaling).

export const CORNER_HANDLES = ["nw", "ne", "sw", "se"];

export function unionBounds(objects) {
  const box = new THREE.Box3();
  objects.forEach((object) => {
    object.updateWorldMatrix(true, false);
    box.expandByObject(object);
  });
  return box;
}

export function snapTo(value, step) {
  const s = Number(step);
  if (!(s > 0)) return value;
  return Math.round(value / s) * s;
}

// World-space positions of the four footprint corners.
export function cornerPoints(box) {
  const y = box.min.y;
  return {
    nw: new THREE.Vector3(box.min.x, y, box.min.z),
    ne: new THREE.Vector3(box.max.x, y, box.min.z),
    sw: new THREE.Vector3(box.min.x, y, box.max.z),
    se: new THREE.Vector3(box.max.x, y, box.max.z),
  };
}

// Dragging a corner keeps the opposite corner fixed; width and depth follow the
// pointer independently. Returns the snapped target size and the anchor point.
export function cornerTarget(box, handle, point, snap = 0, min = 1) {
  const west = handle === "nw" || handle === "sw";
  const north = handle === "nw" || handle === "ne";
  const anchorX = west ? box.max.x : box.min.x;
  const anchorZ = north ? box.max.z : box.min.z;
  const width = Math.max(min, snapTo(west ? anchorX - point.x : point.x - anchorX, snap));
  const depth = Math.max(min, snapTo(north ? anchorZ - point.z : point.z - anchorZ, snap));
  return { width, depth, anchorX, anchorZ };
}

// Height drag is anchored on the bottom face so the object stays on the plane.
export function heightTarget(box, pointY, snap = 0, min = 1) {
  const baseY = box.min.y;
  return { height: Math.max(min, snapTo(pointY - baseY, snap)), baseY };
}

export function applyCornerScale(snapshots, pivot, sx, sz) {
  snapshots.forEach(({ object, position, scale }) => {
    object.position.set(pivot.x + (position.x - pivot.x) * sx, position.y, pivot.z + (position.z - pivot.z) * sz);
    object.scale.set(scale.x * sx, scale.y, scale.z * sz);
  });
}

export function applyHeightScale(snapshots, baseY, sy) {
  snapshots.forEach(({ object, position, scale }) => {
    object.position.set(position.x, baseY + (position.y - baseY) * sy, position.z);
    object.scale.set(scale.x, scale.y * sy, scale.z);
  });
}

export function resetSnapshots(snapshots) {
  snapshots.forEach(({ object, position, scale }) => {
    object.position.copy(position);
    object.scale.copy(scale);
  });
}

export const EDGE_HANDLES = ["n", "e", "s", "w"];

// Midpoints of the four footprint edges: the single-axis resize handles.
export function edgePoints(box) {
  const y = box.min.y;
  const midX = (box.min.x + box.max.x) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  return {
    n: new THREE.Vector3(midX, y, box.min.z),
    s: new THREE.Vector3(midX, y, box.max.z),
    w: new THREE.Vector3(box.min.x, y, midZ),
    e: new THREE.Vector3(box.max.x, y, midZ),
  };
}

// Dragging an edge handle changes one axis only and keeps the opposite side
// fixed. The other axis is left alone by the caller (scale factor 1).
export function edgeTarget(box, handle, point, snap = 0, min = 1) {
  if (handle === "e" || handle === "w") {
    const anchorX = handle === "e" ? box.min.x : box.max.x;
    const width = Math.max(min, snapTo(handle === "e" ? point.x - anchorX : anchorX - point.x, snap));
    return { width, anchorX };
  }
  const anchorZ = handle === "n" ? box.max.z : box.min.z;
  const depth = Math.max(min, snapTo(handle === "n" ? anchorZ - point.z : point.z - anchorZ, snap));
  return { depth, anchorZ };
}
