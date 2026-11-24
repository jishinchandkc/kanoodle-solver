// End-to-end smoke test for Pebblepack. In the page's console:
//   await (await import('/tests/browser-smoke.js')).run()
// It clears the game's saved data first, plays several games with every input method,
// and returns a report: every line should end in "ok".
export async function run() {
  await import('/tests/browser-harness.js?' + Date.now());
  const T = window.T;
  const until = async (cond, ms = 6000) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await T.wait(20); return cond(); };
  const $ = id => document.getElementById(id);
  const report = [];
  const check = (name, cond, detail = '') => report.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  let errors = 0;
  const onErr = () => errors++;
  window.addEventListener('error', onErr);

  localStorage.removeItem('pebblepack.game.v1');
  localStorage.removeItem('pebblepack.best.v1');
  const slider = $('pp-start');
  slider.value = 5; slider.dispatchEvent(new Event('input'));
  $('pp-new').click();
  await T.wait(50);

  check('fresh puzzle has 5 stones', T.count() === '5/12', T.count());
  check('clock waits for the first move', $('pp-time').textContent === '0:00');
  check('no horizontal scrolling', document.documentElement.scrollWidth <= innerWidth);

  // Placing: mouse drag, touch drag, tap-tap
  let sol = T.solution();
  await T.dragFromTray(T.trayLetters()[0], sol, 'mouse');
  check('mouse drag places a stone', T.count() === '6/12', T.count());
  await T.dragFromTray(T.trayLetters()[0], T.solution(), 'touch');
  check('touch drag places a stone', T.count() === '7/12', T.count());
  sol = T.solution();
  const l = T.trayLetters()[0];
  document.querySelector(`.pp-piece[data-letter="${l}"]`).click();
  const tgt = T.target(sol, l); T.orientTo(l, tgt);
  const cc = T.centerCell(T.E.normalize(T.trayShape(l)));
  const minR = Math.min(...tgt.map(c => c[0])), minC = Math.min(...tgt.map(c => c[1]));
  const dest = T.cells()[(minR + cc[0]) * 11 + (minC + cc[1])];
  dest.click(); dest.click();
  check('tap-tap places a stone', T.count() === '8/12', T.count());

  // Undo and lifting
  $('pp-undo').click();
  check('undo removes the last stone', T.count() === '7/12', T.count());
  T.cells().find(c => c.classList.contains('mine')).click();
  check('tapping a placed stone lifts it', T.count() === '6/12', T.count());
  $('pp-undo').click();

  // Check and Hint
  $('pp-check').click();
  await until(() => !T.status().startsWith('Checking'));
  check('Check says still solvable', T.status().startsWith('Still solvable'), T.status());
  const before = T.count();
  $('pp-hint').click();
  await until(() => T.count() !== before);
  check('Hint places a stone', T.count() !== before, `${before} -> ${T.count()}`);

  // Resume data is being saved
  const saved = JSON.parse(localStorage.getItem('pebblepack.game.v1') || 'null');
  check('progress is saved for resume', saved && saved.placed.length >= 3, saved ? `${saved.placed.length} stones saved` : 'nothing saved');

  // Finish and win
  while (T.trayLetters().length) await T.dragFromTray(T.trayLetters()[0], T.solution(), 'mouse');
  await T.wait(50);
  check('board is complete and valid', T.E.isComplete(T.board()));
  check('win card shows', !$('pp-win').hidden, $('pp-winline').textContent);
  check('hinted solve does not set a best', !(JSON.parse(localStorage.getItem('pebblepack.best.v1') || '{}'))['5']);

  // A clean, hint-free solve sets a best
  $('pp-win-new').click();
  await T.wait(50);
  while (T.trayLetters().length) await T.dragFromTray(T.trayLetters()[0], T.solution(), 'mouse');
  await T.wait(50);
  check('hint-free solve sets a best', $('pp-best').textContent !== '–', $('pp-winbest').textContent);

  check('no script errors', errors === 0, `${errors} errors`);
  window.removeEventListener('error', onErr);
  localStorage.removeItem('pebblepack.game.v1');
  localStorage.removeItem('pebblepack.best.v1');
  return report;
}
