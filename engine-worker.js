// Runs Check and Hint off the main thread so the page never freezes on a hard board.
// Messages in:  { id, op: 'check' | 'hint', board, preferred }
// Messages out: { id, result }
importScripts('engine.js');

self.onmessage = e => {
  const { id, op, board, preferred } = e.data;
  let result;
  if (op === 'check') result = { solvable: Engine.check(board).solvable };
  else if (op === 'hint') result = Engine.hint(board, preferred);
  self.postMessage({ id, result });
};
