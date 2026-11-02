export function createUI({
  state,
  onAdd,
  onRotate,
  onScale,
  onColor,
  onToggleHole,
  onDelete,
  onBoolean,
  onExport,
  onReset,
  onSnap,
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

  document.querySelectorAll('#toolbar .shape').forEach((btn) => {
    btn.addEventListener('click', () => onAdd(btn.dataset.shape));
  });

  document.querySelectorAll('#inspector [data-rot]').forEach((btn) => {
    btn.addEventListener('click', () => onRotate(btn.dataset.axis, Number(btn.dataset.rot)));
  });

  scaleInput.addEventListener('input', () => onScale(Number(scaleInput.value)));
  colorInput.addEventListener('input', () => onColor(colorInput.value));
  holeInput.addEventListener('change', () => onToggleHole(holeInput.checked));
  deleteBtn.addEventListener('click', onDelete);

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

  return { refresh };
}
