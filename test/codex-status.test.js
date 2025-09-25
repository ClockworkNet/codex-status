const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions,
  truncateToTerminal,
  parseArgs,
  ensureCodexCli,
  runWatch,
} = require('../src/codex-status');

test('compareVersions handles greater, equal, and lesser', () => {
  assert.equal(compareVersions('0.42.0', '0.41.9'), 1);
  assert.equal(compareVersions('0.41.0', '0.41.0'), 0);
  assert.equal(compareVersions('0.40.10', '0.41.0'), -1);
});

test('truncateToTerminal respects columns and unicode length', () => {
  assert.equal(truncateToTerminal('hello', 10), 'hello');
  assert.equal(truncateToTerminal('hello', 4), 'hell');
  // emoji should count as single character visually when using Array.from
  assert.equal(truncateToTerminal('🙂🙂🙂', 2), '🙂🙂');
});

test('parseArgs supports flags and defaults', () => {
  const { options, showHelp, showVersion } = parseArgs([
    '--base',
    '/tmp',
    '--watch',
    '--interval',
    '5',
    '--limit',
    '3',
  ]);
  assert.deepEqual(options, {
    baseDir: '/tmp',
    watch: true,
    interval: 5,
    limit: 3,
    minimal: false,
  });
  assert.equal(showHelp, false);
  assert.equal(showVersion, false);
});

test('parseArgs handles help and version flags', () => {
  const { options, showHelp, showVersion } = parseArgs(['--help', '--version']);
  assert.equal(options.baseDir.includes('.codex/sessions'), true);
  assert.equal(showHelp, true);
  assert.equal(showVersion, true);
  assert.equal(options.minimal, false);
});

test('parseArgs sets minimal mode', () => {
  const { options } = parseArgs(['-m']);
  assert.equal(options.minimal, true);
});

test('ensureCodexCli succeeds via package.json version', () => {
  const result = ensureCodexCli('0.41.0', {
    loadPackage: () => ({ version: '0.41.2' }),
  });
  assert.equal(result, true);
});

test('ensureCodexCli fails when package version too low', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(msg);
  try {
    const result = ensureCodexCli('0.41.0', {
      loadPackage: () => ({ version: '0.40.0' }),
    });
    assert.equal(result, 1);
    assert.equal(errors.length > 0, true);
  } finally {
    console.error = originalError;
  }
});

test('ensureCodexCli falls back to PATH binaries', () => {
  const result = ensureCodexCli('0.41.0', {
    loadPackage: () => {
      throw new Error('not found');
    },
    execSpawn: () => ({ stdout: 'codex-cli 0.41.5\n', stderr: '' }),
  });
  assert.equal(result, true);
});

test('ensureCodexCli fails when PATH binary missing', () => {
  const errors = [];
  const originalError = console.error;
  console.error = (msg) => errors.push(msg);
  try {
    const result = ensureCodexCli('0.41.0', {
      loadPackage: () => {
        throw new Error('not found');
      },
      execSpawn: () => ({ error: new Error('not found') }),
    });
    assert.equal(result, 1);
    assert.equal(errors.length > 0, true);
  } finally {
    console.error = originalError;
  }
});

test('runWatch outputs the same summary as single run', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};
  const status = {
    sessions: [{
      log: { mtime: new Date() },
      lastContext: {
        model: 'gpt-test-model',
        cwd: '/tmp/project',
      },
    }],
  };

  try {
    await runWatch({ baseDir: '.', interval: 5, limit: 1 }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  assert.equal(fakeStdout.writes[0], '🕒now 🤖test-model 🔄n/a 📁tmp/project\n');
});

test('runWatch minimal mode omits policy and directory', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};
  const status = {
    sessions: [{
      log: { mtime: new Date() },
      lastContext: {
        model: 'gpt-test-model',
        cwd: '/tmp/project',
        sandbox_policy: { mode: 'workspace-write', network_access: false },
        approval_policy: 'on-request',
      },
    }],
  };

  try {
    await runWatch({ baseDir: '.', interval: 5, limit: 1, minimal: true }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0];
  assert.ok(!output.includes('🛂'));
  assert.ok(!output.includes('🧪'));
  assert.ok(!output.includes('📁'));
});
