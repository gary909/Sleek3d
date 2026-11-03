import { SHAPE_DEFS } from './shapes.js';

export function createUI({
  state,
  onAdd,
  onScale,
  onScaleCommit,
  onColor,
  onColorCommit,
  onToggleHole,
  onDelete,
  onBoolean,
  onExport,
  onReset,
  onSnap,
  onSetMode,
  onUndo,
  onRedo,
  onDuplicate,
  onGroup,
  onUngroup,
  onNew,
  onParamChange,
  onParamCommit,
}) {
  const inspectorEmpty = document.getElementById('inspector-empty');
  const inspectorBody = document.getElementById('inspector-body');
  const scaleInput = document.getElementById('scale');
  const colorInput = document.getElementById('color');
  const holeInput = document.getElementById('hole');
  const snapSelect = document.getElementById('snap');
  const deleteBtn = document.getElementById('delete');
  const unionBtn = document.getElementById('union');
  const subtractBtn = document.getElementById('subtract');
  const intersectBtn = document.getElementById('intersect');
  const modeBtns = Array.from(document.querySelectorAll('#inspector [data-mode]'));
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const duplicateBtn = document.getElementById('duplicate');
  const groupBtn = document.getElementById('group');
  const ungroupBtn = document.getElementById('ungroup');
  const newBtn = document.getElementById('new');
  const dimContainer = document.getElementById('dimensions');

  document.querySelectorAll('#toolbar .shape').forEach((btn) => {
    btn.addEventListener('click', () => onAdd(btn.dataset.shape));
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => onSetMode(btn.dataset.mode));
  });

  scaleInput.addEventListener('input', () => onScale(Number(scaleInput.value)));
  scaleInput.addEventListener('change', onScaleCommit);
  colorInput.addEventListener('input', () => onColor(colorInput.value));
  colorInput.addEventListener('change', onColorCommit);
  holeInput.addEventListener('change', () => onToggleHole(holeInput.checked));
  deleteBtn.addEventListener('click', onDelete);

  undoBtn.addEventListener('click', onUndo);
  redoBtn.addEventListener('click', onRedo);
  duplicateBtn.addEventListener('click', onDuplicate);
  groupBtn.addEventListener('click', onGroup);
  ungroupBtn.addEventListener('click', onUngroup);
  newBtn.addEventListener('click', onNew);

  unionBtn.addEventListener('click', () => onBoolean('union'));
  subtractBtn.addEventListener('click', () => onBoolean('subtract'));
  intersectBtn.addEventListener('click', () => onBoolean('intersect'));

  document.getElementById('export').addEventListener('click', onExport);
  document.getElementById('reset').addEventListener('click', onReset);
  snapSelect.addEventListener('change', () => onSnap(Number(snapSelect.value)));

  function firstMesh(object) {
    if (object.isMesh) return object;
    let found = null;
    object.traverse((o) => {
      if (!found && o.isMesh) found = o;
    });
    return found;
  }

  function renderDimensions(object) {
    const def = object && object.isMesh ? SHAPE_DEFS[object.userData.shapeType] : null;
    dimContainer.innerHTML = '';
    dimContainer.hidden = !def;
    if (!def) return;

    const current = { ...(object.userData.params || {}) };
    def.params.forEach((spec) => {
      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('label');
      label.textContent = spec.label;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      input.value = current[spec.key] ?? spec.min;

      input.addEventListener('input', () => {
        let value = Number(input.value);
        if (!Number.isFinite(value)) value = spec.min;
        value = Math.min(spec.max, Math.max(spec.min, value));
        current[spec.key] = value;
        onParamChange({ ...current });
      });
      input.addEventListener('change', onParamCommit);

      row.appendChild(label);
      row.appendChild(input);
      dimContainer.appendChild(row);
    });
  }

  function refresh() {
    const sel = state.selected;
    const primary = sel[0];
    const hasSelection = sel.length > 0;

    inspectorEmpty.hidden = hasSelection;
    inspectorBody.hidden = !hasSelection;

    const canCombine = sel.length === 2;
    unionBtn.disabled = !canCombine;
    subtractBtn.disabled = !canCombine;
    intersectBtn.disabled = !canCombine;
    deleteBtn.disabled = !hasSelection;
    renderDimensions(primary);

    if (primary) {
      const mesh = firstMesh(primary);
      scaleInput.value = String(primary.scale.x);
      colorInput.value = '#' + (mesh ? mesh.material.color.getHexString() : '4a90d9');
      holeInput.checked = mesh ? !mesh.userData.solid : false;
    }
  }

  function setActiveMode(mode) {
    modeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  function setHistoryState(canUndo, canRedo) {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  }

  return { refresh, setActiveMode, setHistoryState };
}
