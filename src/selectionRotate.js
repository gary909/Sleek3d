import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);

// Angle of a point around the vertical axis through the pivot, used by the yaw
// handles. Positive turns from +Z towards +X, which matches a positive +Y turn.
export function yawAngle(centre, point) {
  return Math.atan2(point.x - centre.x, point.z - centre.z);
}

// Angle of a point inside the vertical wheel plane perpendicular to `axis`.
export function pitchAngle(centre, point, axis) {
  const normal = new THREE.Vector3().crossVectors(UP, axis).normalize();
  const rel = new THREE.Vector3().subVectors(point, centre);
  return Math.atan2(rel.y, rel.dot(normal));
}

export function snapAngle(angle, step) {
  if (!(step > 0)) return angle;
  return Math.round(angle / step) * step;
}

// Spin every object around the pivot: positions orbit it and orientations are
// premultiplied, so a multi-selection rotates as one rigid piece.
export function applyRotation(snapshots, pivot, axis, angle) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  snapshots.forEach(({ object, position, quaternion }) => {
    const offset = new THREE.Vector3().subVectors(position, pivot).applyQuaternion(q);
    object.position.copy(pivot).add(offset);
    object.quaternion.copy(q).multiply(quaternion);
  });
}

export function restoreRotations(snapshots) {
  snapshots.forEach(({ object, position, quaternion, turnY, turnX, turnZ }) => {
    object.position.copy(position);
    object.quaternion.copy(quaternion);
    if (turnY !== undefined) object.userData.turnY = turnY;
    if (turnX !== undefined) object.userData.turnX = turnX;
    if (turnZ !== undefined) object.userData.turnZ = turnZ;
  });
}
