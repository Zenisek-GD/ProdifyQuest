let sequence = 0;
/** Called only while handling edits; IDs survive reordering and title changes. */
export function makeChecklistStep(title = '') {
  return { id: `step_${Date.now()}_${sequence++}`, title, done: false };
}
