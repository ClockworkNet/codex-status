const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions,
  truncateToTerminal,
  parseArgs,
  ensureCodexCli,
  runWatch,
} = require('../src/codex-status');

test('parseArgs captures format and overrides', () => {
  const { options } = parseArgs([
    '--format',
    'model,directory,weekly',
    '--override-model',
    'mdl',
    '--override-directory=dir',
  ]);

  assert.deepEqual(options.formatOrder, ['model', 'directory', 'weekly']);
  assert.deepEqual(options.labelOverrides, {
    model: 'mdl',
    directory: 'dir',
  });
});

test('compareVersions handles greater, equal, and lesser', () => {
  assert.equal(compareVersions('0.42.0', '0.41.9'), 1);
  assert.equal(compareVersions('0.41.0', '0.41.0'), 0);
  assert.equal(compareVersions('0.40.10', '0.41.0'), -1);
});

test('truncateToTerminal respects columns and unicode width', () => {
  assert.equal(truncateToTerminal('hello', 10), 'hello');
  assert.equal(truncateToTerminal('hello', 4), 'hell');
  assert.equal(truncateToTerminal('🙂🙂🙂', 4), '🙂🙂');
  assert.equal(truncateToTerminal('🕒now 🤖bot', 9), '🕒now 🤖b');
  assert.equal(truncateToTerminal('A\u0301BC', 2), 'ÁB');
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
    formatOrder: null,
    labelOverrides: {},
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

test('runWatch respects custom format and labels', async () => {
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
      lastTokenCount: {
        info: {
          last_token_usage: { total_tokens: 1234 },
        },
      },
    }],
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      formatOrder: ['recent', 'model', 'directory'],
      labelOverrides: { recent: '++', model: '', directory: 'DIR:' },
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0];
  assert.ok(output.startsWith('++1.2K'));
  assert.ok(output.includes('test-model'));
  assert.ok(output.includes('DIR:tmp/project'));
});

test('runWatch renders rate limit resets as time or date', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  const originalNow = Date.now;
  console.clear = () => {};

  const base = new Date();
  base.setHours(12, 0, 0, 0);
  const baseMs = base.getTime();
  Date.now = () => baseMs;
  const primaryResetAt = Math.floor((baseMs + (5 * 60 * 60 * 1000)) / 1000);
  const secondaryResetAt = Math.floor((baseMs + (3 * 24 * 60 * 60 * 1000)) / 1000);

  const status = {
    sessions: [{
      log: { mtime: new Date(baseMs) },
      lastContext: {},
      lastTokenCount: {
        rate_limits: {
          primary: { used_percent: 12, window_minutes: 300, resets_at: primaryResetAt },
          secondary: { used_percent: 34, window_minutes: 4320, resets_at: secondaryResetAt },
        },
      },
    }],
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      formatOrder: ['daily', 'weekly'],
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
    });
  } finally {
    console.clear = originalClear;
    Date.now = originalNow;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0].trim();
  const segments = output.split(/\s+/);
  const daily = segments.find((part) => part.startsWith('🕔'));
  const weekly = segments.find((part) => part.startsWith('🗓'));
  assert.ok(daily);
  assert.ok(weekly);
  assert.match(daily, /🕔\d+%\/\d{2}:\d{2}/);
  assert.match(weekly, /🗓\d+%\/\d{2}\/\d{2}/);
});
