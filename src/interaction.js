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
  onZoomIn,
  onZoomOut,
  onCopy,
  onPaste,
  onDrop,
  pickFrameHandle,
  onFrameHover,
  onFrameDragStart,
  onFrameDragMove,
  onFrameDragEnd,
}) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let viewCamera = camera;

  let downX = 0;
  let downY = 0;
  let hovered = null;
  let pointerDownOnCanvas = false;
  let frameDrag = null;
  let hoveredHandle = null;

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewCamera);
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
        if (m.material.emissive) m.material.emissive.setHex(level);
      });
    });
  }

  function onPointerMove(event) {
    if (frameDrag !== null) return; // frame drags are tracked on the window
    updatePointer(event);
    const handle = pickFrameHandle ? pickFrameHandle(raycaster) : null;
    if (handle !== hoveredHandle) {
      hoveredHandle = handle;
      onFrameHover?.(handle);
    }
    if (handle) {
      if (hovered !== null) {
        hovered = null;
        applyHighlight();
      }
      return;
    }
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

  // Frame handles win over the gizmo: this capture-phase handler runs before the
  // canvas listeners, and stopping propagation keeps TransformControls out of it.
  window.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || frameDrag !== null) return;
    if (event.target !== renderer.domElement) return;
    updatePointer(event);
    const handle = pickFrameHandle ? pickFrameHandle(raycaster) : null;
    if (handle === null) return;
    frameDrag = handle;
    event.stopPropagation();
    event.preventDefault();
    onFrameDragStart?.(handle, raycaster, event);
  }, true);

  // Selection happens on pointer *up*, and only if the pointer barely moved (a real
  // click). This way dragging a gizmo handle or orbiting never changes the selection.
  function onPointerDown(event) {
    if (event.button !== 0) return;
    pointerDownOnCanvas = true;
    downX = event.clientX;
    downY = event.clientY;
  }

  function onPointerUp(event) {
    if (frameDrag !== null) {
      const handle = frameDrag;
      frameDrag = null;
      onFrameDragEnd?.(handle);
      return;
    }
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
    if (mod && (event.key === 'c' || event.key === 'C')) {
      event.preventDefault();
      onCopy?.();
      return;
    }
    if (mod && (event.key === 'v' || event.key === 'V')) {
      event.preventDefault();
      onPaste?.();
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
    if (event.key === 'd' || event.key === 'D') onDrop?.();
    if (event.key === '+' || event.key === '=') onZoomIn?.();
    if (event.key === '-' || event.key === '_') onZoomOut?.();
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
  // A frame drag keeps following the pointer even outside the canvas, so the
  // object keeps rotating instead of stopping at the canvas edge.
  window.addEventListener('pointermove', (event) => {
    if (frameDrag === null) return;
    updatePointer(event);
    onFrameDragMove?.(raycaster, event);
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    if (frameDrag !== null) return;
    if (hovered !== null) {
      hovered = null;
      applyHighlight();
    }
    if (hoveredHandle !== null) {
      hoveredHandle = null;
      onFrameHover?.(null);
    }
  });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function setCamera(cam) {
    viewCamera = cam;
  }

  return {
    setCamera,
    setSelected,
    select,
    applyHighlight,
  };
}
