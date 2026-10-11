// npm run fresh: start NEO Canon as on a computer that has never seen it.
// A new empty profile and library in a temporary folder each time (see
// FRESH in main.js); the reader already downloaded here is reused.
// Extra arguments pass through: npm run fresh -- --no-sandbox
const { spawn } = require('child_process');
const electron = require('electron');
spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NEO_FRESH: '1' } })
  .on('exit', (code) => process.exit(code ?? 0));
