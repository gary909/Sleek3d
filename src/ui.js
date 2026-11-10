import { SHAPE_DEFS } from './shapes.js';
import { getUnit, DEFAULT_SETTINGS, fromMm, toMm } from './settings.js';

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
  onAlign,
  onCopy,
  onPaste,
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
  const alignBtns = Array.from(document.querySelectorAll('#align [data-align]'));
  const copyBtn = document.getElementById('copy');
  const pasteBtn = document.getElementById('paste');

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
  copyBtn.addEventListener('click', onCopy);
  pasteBtn.addEventListener('click', onPaste);

  alignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const [axis, mode] = btn.dataset.align.split(',');
      onAlign(axis, mode);
    });
  });

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
    copyBtn.disabled = !hasSelection;
    duplicateBtn.disabled = !hasSelection;
    groupBtn.disabled = sel.length < 2;
    ungroupBtn.disabled = !sel.some((o) => o.isGroup);
    alignBtns.forEach((b) => { b.disabled = sel.length < 2; });
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

  function setClipboardState(hasClipboard) {
    pasteBtn.disabled = !hasClipboard;
  }

  return { refresh, setActiveMode, setHistoryState, setClipboardState };
}

export function createSettingsPanel({ settings, onUpdate }) {
  const btn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const closeBtn = document.getElementById('s-close');
  const bgInput = document.getElementById('s-bg');
  const bgReset = document.getElementById('s-bg-reset');
  const shadowsInput = document.getElementById('s-shadows');
  const gridInput = document.getElementById('s-grid');
  const unitsSelect = document.getElementById('s-units');
  const gridWInput = document.getElementById('s-gridw');
  const gridLInput = document.getElementById('s-gridl');
  const gridWUnit = document.getElementById('s-gridw-unit');
  const gridLUnit = document.getElementById('s-gridl-unit');

  function syncUnits() {
    const unit = getUnit(settings);
    gridWUnit.textContent = unit;
    gridLUnit.textContent = unit;
  }

  function gridDisplay(mmValue) {
    return Number(fromMm(mmValue, settings).toFixed(2)).toString();
  }

  function sync() {
    bgInput.value = settings.background;
    shadowsInput.checked = settings.shadows;
    gridInput.checked = settings.grid;
    unitsSelect.value = settings.units;
    gridWInput.value = gridDisplay(settings.gridWidth);
    gridLInput.value = gridDisplay(settings.gridLength);
    syncUnits();
  }

  btn.addEventListener('click', () => {
    sync();
    modal.hidden = false;
  });
  closeBtn.addEventListener('click', () => {
    modal.hidden = true;
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  bgInput.addEventListener('input', () => onUpdate({ background: bgInput.value }));
  bgReset.addEventListener('click', () => {
    bgInput.value = DEFAULT_SETTINGS.background;
    onUpdate({ background: DEFAULT_SETTINGS.background });
  });
  shadowsInput.addEventListener('change', () => onUpdate({ shadows: shadowsInput.checked }));
  gridInput.addEventListener('change', () => onUpdate({ grid: gridInput.checked }));
  unitsSelect.addEventListener('change', () => {
    onUpdate({ units: unitsSelect.value });
    gridWInput.value = gridDisplay(settings.gridWidth);
    gridLInput.value = gridDisplay(settings.gridLength);
    syncUnits();
  });
  gridWInput.addEventListener('change', () =>
    onUpdate({ gridWidth: Math.max(1, Math.round(toMm(Number(gridWInput.value) || 0, settings))) })
  );
  gridLInput.addEventListener('change', () =>
    onUpdate({ gridLength: Math.max(1, Math.round(toMm(Number(gridLInput.value) || 0, settings))) })
  );
}
