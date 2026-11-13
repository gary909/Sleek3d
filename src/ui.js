import { SHAPE_DEFS } from './shapes.js';
import { getUnit, DEFAULT_SETTINGS, fromMm, toMm, formatLength } from './settings.js';

export function createUI({
  state,
  settings,
  onAdd,
  onScale,
  onScaleCommit,
  onColor,
  onColorCommit,
  onToggleHole,
  onToggleTransparent,
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
  const transparentInput = document.getElementById('transparent');
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

  const shapesToggle = document.getElementById('shapes-toggle');
  const shapeList = document.getElementById('shape-list');
  if (shapesToggle && shapeList) {
    shapesToggle.addEventListener('click', () => {
      const willOpen = shapeList.hidden;
      shapeList.hidden = !willOpen;
      shapesToggle.setAttribute('aria-expanded', String(willOpen));
    });
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => onSetMode(btn.dataset.mode));
  });

  scaleInput.addEventListener('input', () => onScale(Number(scaleInput.value)));
  scaleInput.addEventListener('change', onScaleCommit);
  colorInput.addEventListener('input', () => onColor(colorInput.value));
  colorInput.addEventListener('change', onColorCommit);
  holeInput.addEventListener('change', () => onToggleHole(holeInput.checked));
  transparentInput.addEventListener('change', () => onToggleTransparent(transparentInput.checked));
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

    const unit = getUnit(settings);
    const current = { ...(object.userData.params || {}) };
    def.params.forEach((spec) => {
      const isLength = spec.unit !== false;
      const valueMm = current[spec.key] ?? spec.def ?? spec.min;
      current[spec.key] = valueMm;

      // Values are stored in mm internally; the slider/field work in the selected unit.
      const format = (mmValue) =>
        isLength ? formatLength(mmValue, settings) : String(Math.round(mmValue));
      const toDisplay = (mmValue) => (isLength ? fromMm(mmValue, settings) : mmValue);
      const fromDisplay = (displayValue) => (isLength ? toMm(displayValue, settings) : displayValue);

      const row = document.createElement('div');
      row.className = 'dim-row';

      const label = document.createElement('label');
      label.textContent = spec.label;

      const field = document.createElement('input');
      field.type = 'text';
      field.inputMode = isLength ? 'decimal' : 'numeric';
      field.className = 'dim-input';
      field.value = format(valueMm);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'dim-slider';
      slider.min = toDisplay(spec.min);
      slider.max = toDisplay(spec.max);
      slider.step = toDisplay(spec.step);
      slider.value = toDisplay(valueMm);

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(field);
      if (isLength) {
        const unitEl = document.createElement('span');
        unitEl.className = 'dim-unit';
        unitEl.textContent = unit;
        row.appendChild(unitEl);
      }

      const setValue = (value, { syncSlider = false, syncField = false } = {}) => {
        let next = Math.min(spec.max, Math.max(spec.min, value));
        if (!isLength) next = Math.round(next);
        current[spec.key] = next;
        if (syncSlider) slider.value = toDisplay(next);
        if (syncField) field.value = format(next);
        onParamChange({ ...current });
      };

      const readField = () => {
        const raw = parseFloat(field.value);
        return Number.isFinite(raw) ? fromDisplay(raw) : null;
      };

      slider.addEventListener('input', () => {
        setValue(fromDisplay(parseFloat(slider.value)), { syncField: true });
      });
      slider.addEventListener('change', onParamCommit);

      field.addEventListener('input', () => {
        const mm = readField();
        if (mm != null) setValue(mm, { syncSlider: true });
      });
      field.addEventListener('change', () => {
        const mm = readField();
        const next = mm == null ? current[spec.key] : Math.min(spec.max, Math.max(spec.min, mm));
        field.value = format(!isLength ? Math.round(next) : next);
        onParamCommit();
      });

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
      transparentInput.checked = mesh ? mesh.userData.transparent === true : false;
    }
  }

  function setActiveMode(mode) {
    modeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const rotateHint = document.getElementById('rotate-hint');
    if (rotateHint) rotateHint.hidden = mode !== 'rotate';
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

// A single floating tooltip, shown after a 1s hover delay. Any element with a
// `data-tip` attribute gets one; an optional `data-key` renders a shortcut chip.
export function initTooltips() {
  const tip = document.getElementById('tooltip');
  if (!tip) return;

  // Convert existing native `title` tooltips into data-tip (+ parsed shortcut).
  document.querySelectorAll('[title]').forEach((el) => {
    const title = el.getAttribute('title');
    el.removeAttribute('title');
    const match = title.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const isShortcut =
      match &&
      (/⌘|ctrl|cmd|shift|alt|option|del|esc/i.test(match[2]) ||
        /^[a-z]$/i.test(match[2].trim()) ||
        /^f\d+$/i.test(match[2].trim()));
    if (match && isShortcut) {
      el.dataset.tip = match[1].trim();
      el.dataset.key = match[2].trim();
    } else {
      el.dataset.tip = title;
    }
  });

  // Auto-describe repetitive button groups.
  document.querySelectorAll('#toolbar .shape').forEach((el) => {
    if (!el.dataset.tip) el.dataset.tip = 'Add ' + el.textContent.trim().toLowerCase();
  });
  document.querySelectorAll('#align [data-align]').forEach((el) => {
    if (el.dataset.tip) return;
    const [axis, mode] = el.dataset.align.split(',');
    el.dataset.tip = `Align ${axis.toUpperCase()} ${mode}`;
  });

  let timer = null;
  let current = null;

  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
  };

  const show = (el) => {
    tip.textContent = el.dataset.tip || '';
    if (el.dataset.key) {
      const kbd = document.createElement('span');
      kbd.className = 'kbd';
      kbd.textContent = el.dataset.key;
      tip.appendChild(kbd);
    }
    tip.hidden = false;

    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const margin = 8;
    const gap = 6;
    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(cx, w / 2 + margin), window.innerWidth - w / 2 - margin);

    let top = r.top - gap;
    let transform = 'translate(-50%, -100%)';
    if (r.top - gap - h < margin) {
      top = r.bottom + gap;
      transform = 'translate(-50%, 0)';
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.transform = transform;
  };

  const activate = (el) => {
    current = el;
    clearTimeout(timer);
    tip.hidden = true;
    timer = setTimeout(() => show(el), 1000);
  };

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && el !== current) activate(el);
  });

  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || el !== current) return;
    if (e.relatedTarget && el.contains(e.relatedTarget)) return;
    current = null;
    hide();
  });

  document.addEventListener('pointerdown', () => {
    current = null;
    hide();
  }, true);

  window.addEventListener('scroll', () => {
    current = null;
    hide();
  }, true);
}
