import * as THREE from 'three';

const HIGHLIGHT_HEX = 0x555555;
const HOVER_HEX = 0x333333;
const CLICK_THRESHOLD_PX = 6;

export function createInteraction({
  renderer,
  camera,
  state,
  onSelectionChange,
  onDelete,
  onSetMode,
  onUndo,
  onRedo,
  onDuplicate,
  onGroup,
  onUngroup,
  onSelectAll,
  onNudge,
  onNudgeEnd,
  onToggleHoleKey,
  onFocus,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let downX = 0;
  let downY = 0;
  let hovered = null;
  let pointerDownOnCanvas = false;

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function getMeshes(object) {
    if (object.isMesh) return [object];
    const meshes = [];
    object.traverse((o) => {
      if (o.isMesh) meshes.push(o);
    });
    return meshes;
  }

  function topLevelOf(node) {
    let current = node;
    while (current && !state.shapes.includes(current)) current = current.parent;
    return current;
  }

  function pick(event) {
    updatePointer(event);
    const hits = raycaster.intersectObjects(state.shapes, true);
    return hits.length ? topLevelOf(hits[0].object) : null;
  }

  function applyHighlight() {
    state.shapes.forEach((object) => {
      const selected = state.selected.includes(object);
      const isHovered = hovered === object;
      const level = selected ? HIGHLIGHT_HEX : isHovered ? HOVER_HEX : 0x000000;
      getMeshes(object).forEach((m) => {
        m.material.emissive.setHex(level);
      });
    });
  }

  function onPointerMove(event) {
    const object = pick(event);
    if (object !== hovered) {
      hovered = object;
      applyHighlight();
    }
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
    pointerDownOnCanvas = event.button === 0;
    if (!pointerDownOnCanvas) return;
    downX = event.clientX;
    downY = event.clientY;
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    if (!pointerDownOnCanvas) return;
    pointerDownOnCanvas = false;
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

    const mod = event.metaKey || event.ctrlKey;
    if (mod && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      if (event.shiftKey) onRedo?.();
      else onUndo?.();
      return;
    }
    if (mod && (event.key === 'y' || event.key === 'Y')) {
      event.preventDefault();
      onRedo?.();
      return;
    }
    if (mod && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault();
      onDuplicate?.();
      return;
    }
    if (mod && (event.key === 'g' || event.key === 'G')) {
      event.preventDefault();
      if (event.shiftKey) onUngroup?.();
      else onGroup?.();
      return;
    }
    if (mod && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      onSelectAll?.();
      return;
    }

    if (event.key === 'Escape') setSelected([]);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.selected.length) onDelete?.();
    }
    if (event.key === 'w' || event.key === 'W') onSetMode?.('translate');
    if (event.key === 'e' || event.key === 'E') onSetMode?.('rotate');
    if (event.key === 'r' || event.key === 'R') onSetMode?.('scale');
    if (event.key === 'h' || event.key === 'H') onToggleHoleKey?.();
    if (event.key === 'f' || event.key === 'F') onFocus?.();
    if (event.key === 'ArrowLeft') { event.preventDefault(); onNudge?.(-state.snap, 0); }
    if (event.key === 'ArrowRight') { event.preventDefault(); onNudge?.(state.snap, 0); }
    if (event.key === 'ArrowUp') { event.preventDefault(); onNudge?.(0, -state.snap); }
    if (event.key === 'ArrowDown') { event.preventDefault(); onNudge?.(0, state.snap); }
  }

  function onKeyUp(event) {
    if (event.key.startsWith('Arrow')) onNudgeEnd?.();
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', () => {
    if (hovered !== null) {
      hovered = null;
      applyHighlight();
    }
  });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    setSelected,
    select,
    applyHighlight,
  };
}
