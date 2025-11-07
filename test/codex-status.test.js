const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  compareVersions,
  truncateToTerminal,
  parseArgs,
  ensureCodexCli,
  runWatch,
  readLog,
} = require('../src/codex-status');

const { playAlertSound } = require('../src/sound');

function createMockStdin({ isTTY = false } = {}) {
  const stream = new EventEmitter();
  stream.isTTY = isTTY;
  stream.setRawMode = () => {};
  stream.resume = () => {};
  stream.pause = () => {};
  return stream;
}

function createMockProcess() {
  return {
    once: () => {},
    exit: () => {},
  };
}

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
    sound: 'off',
    soundVolume: 100,
    soundReverb: 'default',
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
      lastActivity: null,
    }],
  };

  try {
    await runWatch({ baseDir: '.', interval: 5, limit: 1, sound: 'off' }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: createMockStdin(),
      processObject: createMockProcess(),
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  // Default order now begins with optional sound field; it's omitted when sound is off.
  assert.equal(fakeStdout.writes[0], '🕒now 🔄n/a 🤖test-model 📁tmp/project\n');
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
    await runWatch({ baseDir: '.', interval: 5, limit: 1, minimal: true, sound: 'off' }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: createMockStdin(),
      processObject: createMockProcess(),
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0];
  assert.ok(!output.includes('🔊'));
  assert.ok(!output.includes('🔇'));
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
      sound: 'off',
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: createMockStdin(),
      processObject: createMockProcess(),
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0];
  assert.ok(!output.startsWith('🔊 '));
  assert.ok(!output.startsWith('🔇 '));
  assert.ok(output.startsWith('++1.2K'));
  assert.ok(output.includes('test-model'));
  assert.ok(output.includes('DIR:tmp/project'));
});

test('runWatch custom format can omit sound indicator even when enabled', async () => {
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
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      formatOrder: ['model', 'directory'],
      sound: 'some',
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: createMockStdin({ isTTY: true }),
      processObject: createMockProcess(),
    });
  } finally {
    console.clear = originalClear;
  }

  assert.equal(fakeStdout.writes.length >= 1, true);
  const output = fakeStdout.writes[0];
  assert.ok(output.startsWith('🤖test-model'));
  assert.ok(!output.includes('🔊'));
  assert.ok(!output.includes('🔇'));
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
      sound: 'off',
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: createMockStdin(),
      processObject: createMockProcess(),
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

test('parseArgs enables sound flag', () => {
  const { options } = parseArgs(['--sound']);
  assert.equal(options.sound, 'some');
});

test('parseArgs enables sound flag with short form', () => {
  const { options } = parseArgs(['-s']);
  assert.equal(options.sound, 'some');
});

test('parseArgs accepts sound mode values', () => {
  const { options: opt1 } = parseArgs(['--sound=all']);
  assert.equal(opt1.sound, 'all');
  
  const { options: opt2 } = parseArgs(['--sound=some']);
  assert.equal(opt2.sound, 'some');
  
  const { options: opt3 } = parseArgs(['--sound=assistant']);
  assert.equal(opt3.sound, 'assistant');
  
  const { options: opt4 } = parseArgs(['--sound', 'some']);
  assert.equal(opt4.sound, 'some');
});

test('parseArgs rejects invalid sound modes', () => {
  assert.throws(() => {
    parseArgs(['--sound=invalid']);
  }, /Sound mode must be one of: all, some, assistant/);
});

test('parseArgs accepts sound volume', () => {
  const { options: opt1 } = parseArgs(['--sound-volume=50']);
  assert.equal(opt1.soundVolume, 50);
  
  const { options: opt2 } = parseArgs(['--sound-volume', '75']);
  assert.equal(opt2.soundVolume, 75);
  
  const { options: opt3 } = parseArgs(['--sound-volume=1']);
  assert.equal(opt3.soundVolume, 1);
  
  const { options: opt4 } = parseArgs(['--sound-volume=100']);
  assert.equal(opt4.soundVolume, 100);
});

test('parseArgs rejects invalid sound volume', () => {
  assert.throws(() => {
    parseArgs(['--sound-volume=0']);
  }, /Sound volume must be an integer between 1 and 100/);
  
  assert.throws(() => {
    parseArgs(['--sound-volume=101']);
  }, /Sound volume must be an integer between 1 and 100/);
  
  assert.throws(() => {
    parseArgs(['--sound-volume=50.5']);
  }, /Sound volume must be an integer between 1 and 100/);
});

test('parseArgs accepts sound reverb', () => {
  const { options: opt1 } = parseArgs(['--sound-reverb=none']);
  assert.equal(opt1.soundReverb, 'none');
  
  const { options: opt2 } = parseArgs(['--sound-reverb', 'subtle']);
  assert.equal(opt2.soundReverb, 'subtle');
  
  const { options: opt3 } = parseArgs(['--sound-reverb=default']);
  assert.equal(opt3.soundReverb, 'default');
  
  const { options: opt4 } = parseArgs(['--sound-reverb', 'lush']);
  assert.equal(opt4.soundReverb, 'lush');
});

test('parseArgs rejects invalid sound reverb', () => {
  assert.throws(() => {
    parseArgs(['--sound-reverb=invalid']);
  }, /Sound reverb must be one of: none, subtle, default, lush/);
  
  assert.throws(() => {
    parseArgs(['--sound-reverb', 'wrong']);
  }, /Sound reverb must be one of: none, subtle, default, lush/);
});

test('readLog captures structured review output even when review_output is null', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-status-test-'));
  try {
    const filePath = path.join(tmpDir, 'structured.jsonl');
    const structured = {
      findings: [
        {
          title: '[P1] Broken flow',
          body: 'Routing loses nested product data.',
          priority: 1,
          confidence_score: 0.6,
          code_location: {
            absolute_file_path: 'src/app.dart',
            line_range: { start: 10, end: 14 },
          },
        },
      ],
      overall_correctness: 'patch is incorrect',
      overall_explanation: 'Breaks deep link handling.',
      overall_confidence_score: 0.6,
    };

    const entries = [
      JSON.stringify({ timestamp: '2025-01-01T00:00:00.000Z', type: 'turn_context', payload: {} }),
      JSON.stringify({ timestamp: '2025-01-01T00:00:01.000Z', type: 'event_msg', payload: { type: 'entered_review_mode' } }),
      JSON.stringify({
        timestamp: '2025-01-01T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'agent_message',
          message: JSON.stringify(structured),
        },
      }),
      JSON.stringify({
        timestamp: '2025-01-01T00:00:03.000Z',
        type: 'event_msg',
        payload: {
          type: 'exited_review_mode',
          review_output: null,
        },
      }),
    ];

    fs.writeFileSync(filePath, `${entries.join('\n')}\n`);
    const info = await readLog(filePath);
    assert.ok(info.lastReview, 'expected lastReview to be captured');
    assert.equal(info.lastReview.overallCorrectness, 'patch is incorrect');
    assert.equal(info.lastReview.verdict, 'incorrect');
    assert.equal(info.lastReview.findings.length, 1);
    assert.equal(info.lastReview.findings[0].location.file, 'src/app.dart');
    assert.equal(info.lastActivity, 'review');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('readLog falls back to user_action review results when structured data is missing', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-status-test-'));
  try {
    const filePath = path.join(tmpDir, 'user-action.jsonl');
    const userAction = `<user_action>\n  <action>review</action>\n  <results>\n  Looks good to me.\n  </results>\n</user_action>`;

    const entries = [
      JSON.stringify({ timestamp: '2025-02-01T00:00:00.000Z', type: 'turn_context', payload: {} }),
      JSON.stringify({ timestamp: '2025-02-01T00:00:01.000Z', type: 'event_msg', payload: { type: 'entered_review_mode' } }),
      JSON.stringify({
        timestamp: '2025-02-01T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'exited_review_mode',
          review_output: null,
        },
      }),
      JSON.stringify({
        timestamp: '2025-02-01T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: userAction }],
        },
      }),
    ];

    fs.writeFileSync(filePath, `${entries.join('\n')}\n`);
    const info = await readLog(filePath);
    assert.ok(info.lastReview, 'expected fallback review to be captured');
    assert.equal(info.lastReview.source, 'user_action');
    assert.equal(info.lastReview.summary, 'Looks good to me.');
    assert.equal(info.lastReview.overallExplanation, 'Looks good to me.');
    assert.equal(info.lastReview.findings.length, 0);
    assert.equal(info.lastActivity, 'review');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('playAlertSound calls platform-specific command', () => {
  const calls = [];
  const mockSpawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return {
      on: () => {},
    };
  };

  playAlertSound('user', 'all', 100, 'default', { spawn: mockSpawn, platform: 'darwin', tmpdir: '/tmp' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'afplay');
  assert.ok(calls[0].args[0].startsWith('/tmp/codex-beep-')); // temp file path
  assert.ok(calls[0].args[0].endsWith('.wav'));
});

test('playAlertSound handles different platforms', () => {
  const mockProcess = {
    stdin: { write: () => {}, end: () => {} },
    on: () => {},
  };

  const darwinCalls = [];
  playAlertSound('user', 'all', 100, 'default', {
    spawn: (cmd, args) => { darwinCalls.push(cmd); return mockProcess; },
    platform: 'darwin',
    tmpdir: '/tmp',
  });
  assert.equal(darwinCalls[0], 'afplay');

  const linuxCalls = [];
  playAlertSound('tool', 'all', 100, 'default', {
    spawn: (cmd, args) => { linuxCalls.push(cmd); return mockProcess; },
    platform: 'linux',
    tmpdir: '/tmp',
  });
  assert.equal(linuxCalls[0], 'aplay'); // Linux tries aplay first
});

test('runWatch plays sound when new activity appears', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};

  const soundCalls = [];
  const mockPlaySound = () => soundCalls.push(Date.now());

  const firstTime = new Date('2025-10-27T19:47:56.258Z');
  const secondTime = new Date('2025-10-27T20:00:00.000Z');

  let callCount = 0;
  const mockGather = async () => {
    callCount += 1;
    return {
      sessions: [{
        log: { mtime: new Date() },
        lastContext: { model: 'gpt-test' },
        lastActivity: callCount === 1 ? 'tool' : 'assistant',
        lastTimestamp: callCount === 1 ? firstTime : secondTime,
      }],
    };
  };

  const intervals = [];
  const mockSetInterval = (fn) => {
    intervals.push(fn);
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      sound: 'all',
    }, fakeStdout, {
      gatherStatuses: mockGather,
      setIntervalFn: mockSetInterval,
      playSound: mockPlaySound,
      stdin: createMockStdin({ isTTY: true }),
      processObject: createMockProcess(),
    });

    // First call: no sound (initial state)
    assert.equal(soundCalls.length, 0);

    // Simulate second interval call
    await intervals[0]();

    // Second call: sound should play (new activity detected)
    assert.equal(soundCalls.length, 1);
  } finally {
    console.clear = originalClear;
  }
});

test('runWatch does not play sound for user messages', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};

  const soundCalls = [];
  const mockPlaySound = () => soundCalls.push(Date.now());

  const firstTime = new Date('2025-10-27T19:47:56.258Z');
  const secondTime = new Date('2025-10-27T20:00:00.000Z');

  let callCount = 0;
  const mockGather = async () => {
    callCount += 1;
    return {
      sessions: [{
        log: { mtime: new Date() },
        lastContext: { model: 'gpt-test' },
        lastActivity: callCount === 1 ? 'assistant' : 'user',
        lastTimestamp: callCount === 1 ? firstTime : secondTime,
      }],
    };
  };

  const intervals = [];
  const mockSetInterval = (fn) => {
    intervals.push(fn);
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      sound: 'all',
    }, fakeStdout, {
      gatherStatuses: mockGather,
      setIntervalFn: mockSetInterval,
      playSound: mockPlaySound,
      stdin: createMockStdin({ isTTY: true }),
      processObject: createMockProcess(),
    });

    // First call: no sound (initial state)
    assert.equal(soundCalls.length, 0);

    // Simulate second interval call (user activity)
    await intervals[0]();

    // Second call: no sound should play (user activity is excluded)
    assert.equal(soundCalls.length, 0);
  } finally {
    console.clear = originalClear;
  }
});

test('runWatch assistant mode only plays for assistant messages', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};

  const soundCalls = [];
  const mockPlaySound = () => soundCalls.push(Date.now());

  const times = [
    new Date('2025-10-27T19:47:56.258Z'),
    new Date('2025-10-27T20:00:00.000Z'),
    new Date('2025-10-27T20:01:00.000Z'),
    new Date('2025-10-27T20:02:00.000Z'),
  ];

  let callCount = 0;
  const activities = ['assistant', 'tool', 'assistant', 'thinking'];
  const mockGather = async () => {
    const idx = callCount;
    callCount += 1;
    return {
      sessions: [{
        log: { mtime: new Date() },
        lastContext: { model: 'gpt-test' },
        lastActivity: activities[idx],
        lastTimestamp: times[idx],
      }],
    };
  };

  const intervals = [];
  const mockSetInterval = (fn) => {
    intervals.push(fn);
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      sound: 'assistant',
    }, fakeStdout, {
      gatherStatuses: mockGather,
      setIntervalFn: mockSetInterval,
      playSound: mockPlaySound,
      stdin: createMockStdin({ isTTY: true }),
      processObject: createMockProcess(),
    });

    // First call: no sound (initial state, assistant activity)
    assert.equal(soundCalls.length, 0);

    // Second call: tool activity - no sound in assistant mode
    await intervals[0]();
    assert.equal(soundCalls.length, 0);

    // Third call: assistant activity - sound should play
    await intervals[0]();
    assert.equal(soundCalls.length, 1);

    // Fourth call: thinking activity - no sound in assistant mode
    await intervals[0]();
    assert.equal(soundCalls.length, 1);
  } finally {
    console.clear = originalClear;
  }
});

test('runWatch some mode plays assistant always and others every 2nd/3rd', async () => {
  const fakeStdout = {
    columns: 120,
    writes: [],
    write(chunk) {
      this.writes.push(chunk);
    },
  };
  const originalClear = console.clear;
  console.clear = () => {};

  const soundCalls = [];
  const mockPlaySound = () => soundCalls.push(Date.now());

  const times = [
    new Date('2025-10-27T19:47:56.258Z'),
    new Date('2025-10-27T20:00:00.000Z'),
    new Date('2025-10-27T20:01:00.000Z'),
    new Date('2025-10-27T20:02:00.000Z'),
    new Date('2025-10-27T20:03:00.000Z'),
    new Date('2025-10-27T20:04:00.000Z'),
    new Date('2025-10-27T20:05:00.000Z'),
  ];
  // assistant (always plays), tool (counter=1, no sound), user (ignored), 
  // thinking (counter=2, plays), review (counter=3, plays), assistant (always plays)
  const activities = ['assistant', 'tool', 'user', 'thinking', 'review', 'assistant'];

  let callCount = 0;
  const mockGather = async () => {
    const idx = callCount;
    callCount += 1;
    return {
      sessions: [{
        log: { mtime: new Date() },
        lastContext: { model: 'gpt-test' },
        lastActivity: activities[idx],
        lastTimestamp: times[idx],
      }],
    };
  };

  const intervals = [];
  const mockSetInterval = (fn) => {
    intervals.push(fn);
  };

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      sound: 'some',
    }, fakeStdout, {
      gatherStatuses: mockGather,
      setIntervalFn: mockSetInterval,
      playSound: mockPlaySound,
      stdin: createMockStdin({ isTTY: true }),
      processObject: createMockProcess(),
    });

    // First call: assistant activity, no sound (initial state)
    assert.equal(soundCalls.length, 0);

    // Second call: tool activity -> counter=1, no sound (1%2 !== 0 && 1%3 !== 0)
    await intervals[0]();
    assert.equal(soundCalls.length, 0);

    // Third call: user activity -> no sound, counter unchanged
    await intervals[0]();
    assert.equal(soundCalls.length, 0);

    // Fourth call: thinking activity -> counter=2, sound plays (2%2 === 0)
    await intervals[0]();
    assert.equal(soundCalls.length, 1);

    // Fifth call: review activity -> counter=3, sound plays (3%3 === 0)
    await intervals[0]();
    assert.equal(soundCalls.length, 2);

    // Sixth call: assistant activity -> always plays, counter unchanged
    await intervals[0]();
    assert.equal(soundCalls.length, 3);
  } finally {
    console.clear = originalClear;
  }
});

test('runWatch toggles sound mute with keyboard', async () => {
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
      lastContext: { model: 'gpt-test', cwd: '/tmp/project' },
      lastActivity: 'assistant',
      lastTimestamp: new Date('2025-10-27T19:47:56.258Z'),
    }],
  };

  const mockStdin = createMockStdin({ isTTY: true });

  try {
    await runWatch({
      baseDir: '.',
      interval: 5,
      limit: 1,
      sound: 'some',
    }, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: mockStdin,
      processObject: createMockProcess(),
    });

    assert.equal(fakeStdout.writes.length >= 1, true);
    const initialOutput = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(initialOutput.startsWith('🔊 '));

    mockStdin.emit('keypress', 'm', { name: 'm' });
    await new Promise((resolve) => setImmediate(resolve));
    const mutedOutput = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(mutedOutput.startsWith('🔇 '));

    mockStdin.emit('keypress', 'm', { name: 'm' });
    await new Promise((resolve) => setImmediate(resolve));
    const unmutedOutput = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(unmutedOutput.startsWith('🔊 '));
  } finally {
    console.clear = originalClear;
  }
});

test('runWatch cycles reverb with keyboard', async () => {
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
      lastContext: { model: 'gpt-test', cwd: '/tmp/project' },
      lastActivity: 'assistant',
      lastTimestamp: new Date('2025-10-27T19:47:56.258Z'),
    }],
  };

  const mockStdin = createMockStdin({ isTTY: true });
  const options = {
    baseDir: '.',
    interval: 5,
    limit: 1,
    sound: 'some',
  };

  try {
    await runWatch(options, fakeStdout, {
      gatherStatuses: async () => status,
      setIntervalFn: () => {},
      stdin: mockStdin,
      processObject: createMockProcess(),
    });

    assert.equal(fakeStdout.writes.length >= 1, true);
    const initial = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(initial.startsWith('🔊 '));

    mockStdin.emit('keypress', 'r', { name: 'r' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(options.soundReverb, 'subtle');
    const subtleOutput = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(subtleOutput.startsWith('🔊 '));
    assert.ok(!subtleOutput.includes('🛁'));

    mockStdin.emit('keypress', 'r', { name: 'r' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(options.soundReverb, 'lush');
    const lushOutput = fakeStdout.writes[fakeStdout.writes.length - 1];
    assert.ok(lushOutput.startsWith('🔊 '));
    assert.ok(!lushOutput.includes('⛰️'));
  } finally {
    console.clear = originalClear;
  }
});
