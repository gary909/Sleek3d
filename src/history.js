export function createHistory() {
  const undoStack = [];
  const redoStack = [];

  function push(command) {
    undoStack.push(command);
    redoStack.length = 0;
  }

  function undo() {
    const command = undoStack.pop();
    if (!command) return;
    command.undo();
    redoStack.push(command);
  }

  function redo() {
    const command = redoStack.pop();
    if (!command) return;
    command.redo();
    undoStack.push(command);
  }

  function clear() {
    undoStack.length = 0;
    redoStack.length = 0;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  return { push, undo, redo, clear, canUndo, canRedo };
}
