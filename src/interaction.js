import * as THREE from 'three';

const HIGHLIGHT_HEX = 0x555555;

export function createInteraction({ renderer, camera, state, onSelectionChange, onDelete }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const grabOffset = new THREE.Vector3();

  let dragging = false;
  let dragMesh = null;

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pick(event) {
    updatePointer(event);
    const hits = raycaster.intersectObjects(state.shapes, false);
    return hits.length ? hits[0].object : null;
  }

  function applyHighlight() {
    state.shapes.forEach((mesh) => {
      mesh.material.emissive.setHex(state.selected.includes(mesh) ? HIGHLIGHT_HEX : 0x000000);
    });
  }

  function setSelected(meshes) {
    state.selected = meshes;
    applyHighlight();
    onSelectionChange?.();
  }

  function select(mesh, additive) {
    if (!additive) {
      setSelected(mesh ? [mesh] : []);
    } else if (mesh) {
      const next = state.selected.includes(mesh)
        ? state.selected.filter((m) => m !== mesh)
        : [...state.selected, mesh];
      setSelected(next);
    }
  }

  function snapToGrid(value) {
    return Math.round(value / state.snap) * state.snap;
  }

  function onPointerDown(event) {
    if (event.button !== 0) return; // left button only
    const mesh = pick(event);
    select(mesh, event.shiftKey);

    if (mesh) {
      dragging = true;
      dragMesh = mesh;
      // Drag on the horizontal plane through the mesh's pivot (keeps it grounded).
      dragPlane.constant = -mesh.position.y;
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        grabOffset.copy(mesh.position).sub(hitPoint);
      } else {
        grabOffset.set(0, 0, 0);
      }
    }
  }

  function onPointerMove(event) {
    if (!dragging || !dragMesh) return;
    updatePointer(event);
    if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
      const x = snapToGrid(hitPoint.x + grabOffset.x);
      const z = snapToGrid(hitPoint.z + grabOffset.z);
      dragMesh.position.set(x, dragMesh.position.y, z);
    }
  }

  function onPointerUp() {
    dragging = false;
    dragMesh = null;
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') setSelected([]);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selected.length && !isTyping(event.target)) {
        onDelete?.();
      }
    }
  }

  function isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    setSelected,
    select,
    applyHighlight,
  };
}
