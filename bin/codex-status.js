#!/usr/bin/env node

const { runCli } = require('../src/codex-status');

(async () => {
  const pkg = require('../package.json');
  const exitCode = await runCli({ version: pkg.version });
  if (Number.isInteger(exitCode) && exitCode !== 0) {
    process.exit(exitCode);
  }
})();
