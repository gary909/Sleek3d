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

  unionBtn.addEventListener('click', () => onBoolean('union'));
  subtractBtn.addEventListener('click', () => onBoolean('subtract'));
  intersectBtn.addEventListener('click', () => onBoolean('intersect'));

  document.getElementById('export').addEventListener('click', onExport);
  document.getElementById('reset').addEventListener('click', onReset);
  snapSelect.addEventListener('change', () => onSnap(Number(snapSelect.value)));

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

    if (primary) {
      scaleInput.value = String(primary.scale.x);
      colorInput.value = '#' + primary.material.color.getHexString();
      holeInput.checked = !primary.userData.solid;
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
