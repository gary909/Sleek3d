import * as THREE from 'three';

const HIGHLIGHT_HEX = 0x555555;
const CLICK_THRESHOLD_PX = 6;

export function createInteraction({
  renderer,
  camera,
  state,
  onSelectionChange,
  onDelete,
  onSetMode,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let downX = 0;
  let downY = 0;

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
    const unchanged =
      meshes.length === state.selected.length &&
      meshes.every((m, i) => m === state.selected[i]);
    if (unchanged) return;

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

  // Selection happens on pointer *up*, and only if the pointer barely moved (a real
  // click). This way dragging a gizmo handle or orbiting never changes the selection.
  function onPointerDown(event) {
    if (event.button !== 0) return;
    downX = event.clientX;
    downY = event.clientY;
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > CLICK_THRESHOLD_PX) {
      return;
    }
    const mesh = pick(event);
    select(mesh, event.shiftKey);
  }

  function isTyping(target) {
    return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
  }

  function onKeyDown(event) {
    if (isTyping(event.target)) return;

    if (event.key === 'Escape') setSelected([]);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selected.length) onDelete?.();
    }
    if (event.key === 'w' || event.key === 'W') onSetMode?.('translate');
    if (event.key === 'e' || event.key === 'E') onSetMode?.('rotate');
    if (event.key === 'r' || event.key === 'R') onSetMode?.('scale');
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    setSelected,
    select,
    applyHighlight,
  };
}
