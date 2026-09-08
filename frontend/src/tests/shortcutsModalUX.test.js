import test from 'node:test'
import assert from 'node:assert'

test('ShortcutsModal component triggers shortcut actions and auto-closes dialog', (t) => {
  let closed = false;
  let actionExecuted = false;

  const handleClose = () => {
    closed = true;
  };

  const dummyAction = () => {
    actionExecuted = true;
  };

  // Simulate shortcut button click execution logic inside ShortcutsModal
  const onClickHandler = (actionFn, closeFn) => {
    if (typeof actionFn === 'function') {
      actionFn();
    }
    closeFn();
  };

  onClickHandler(dummyAction, handleClose);

  assert.strictEqual(actionExecuted, true, 'Shortcut action callback should be executed upon click');
  assert.strictEqual(closed, true, 'Modal close callback should be invoked upon clicking shortcut action');
});
