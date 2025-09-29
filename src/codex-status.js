#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawnSync } = require('child_process');

function trimPath(p) {
  if (!p) return '';
  const home = os.homedir();
  let result = p.startsWith(home) ? p.slice(home.length) : p;
  if (result.startsWith(path.sep)) result = result.slice(1);
  const parts = result.split(path.sep);
  if (parts.length > 1 && parts[0] === 'dev') {
    result = parts.slice(1).join(path.sep);
  }
  return result || '.';
}

function stripModelPrefix(model) {
  if (typeof model !== 'string') return model;
  return model.startsWith('gpt-') ? model.slice(4) : model;
}

function truncateToTerminal(text, columns) {
  if (!columns || columns <= 0) return text;
  const chars = Array.from(text);
  if (chars.length <= columns) return text;
  return chars.slice(0, columns).join('');
}

function compareVersions(a, b) {
  const toNumeric = (version) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = 3;
  const [aParts, bParts] = [toNumeric(a), toNumeric(b)];
  for (let i = 0; i < maxLength; i += 1) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;
    if (aVal > bVal) return 1;
    if (aVal < bVal) return -1;
  }
  return 0;
}

function ensureCodexCli(required = '0.41.0', overrides = {}) {
  const installHint = 'Install or upgrade via "npm install -g @openai/codex" or follow https://github.com/openai/codex for instructions.';
  const missingMessage = (reason) => `codex-status requires Codex CLI @ ${required} or newer (${reason}). ${installHint}`;

  const defaultLoaders = [
    () => require('@openai/codex/package.json'),
    () => require('codex-cli/package.json'),
  ];
  const loadPackage = overrides.loadPackage || (() => {
    for (const loader of defaultLoaders) {
      try {
        return loader();
      } catch (err) {
        // try next loader
      }
    }
    throw new Error('package not found');
  });
  const execSpawn = overrides.execSpawn || (() => spawnSync('codex', ['--version'], { encoding: 'utf8' }));

  try {
    const codexPackage = loadPackage();
    const current = codexPackage.version || '0.0.0';
    if (compareVersions(current, required) < 0) {
      console.error(missingMessage(`detected ${current}`));
      return 1;
    }
    return true;
  } catch (err) {
    // fall back to checking PATH for other installations
  }

  const result = execSpawn();
  if (result.error) {
    console.error(missingMessage('binary not found on PATH'));
    return 1;
  }
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const match = output.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    console.error(missingMessage('unable to detect version'));
    return 1;
  }
  const current = match[1];
  if (compareVersions(current, required) < 0) {
    console.error(missingMessage(`detected ${current}`));
    return 1;
  }
  return true;
}

const CANONICAL_FIELDS = [
  'time',
  'error',
  'model',
  'approval',
  'sandbox',
  'daily',
  'weekly',
  'recent',
  'total',
  'directory',
];

const FIELD_ALIASES = {
  time: 'time',
  timestamp: 'time',
  age: 'time',
  error: 'error',
  model: 'model',
  agent: 'model',
  approval: 'approval',
  policy: 'approval',
  sandbox: 'sandbox',
  'sandbox-policy': 'sandbox',
  env: 'sandbox',
  primary: 'daily',
  daily: 'daily',
  quota: 'daily',
  secondary: 'weekly',
  weekly: 'weekly',
  billing: 'weekly',
  recent: 'recent',
  'recent-tokens': 'recent',
  latest: 'recent',
  total: 'total',
  'total-tokens': 'total',
  cumulative: 'total',
  directory: 'directory',
  cwd: 'directory',
  path: 'directory',
};

const DEFAULT_FORMAT_ORDER = [
  'time',
  'error',
  'model',
  'approval',
  'sandbox',
  'daily',
  'weekly',
  'recent',
  'total',
  'directory',
];

function normalizeFieldKey(key) {
  if (typeof key !== 'string') return null;
  const lookup = FIELD_ALIASES[key.trim().toLowerCase()];
  if (!lookup) return null;
  return CANONICAL_FIELDS.includes(lookup) ? lookup : null;
}

function parseFormatList(raw) {
  if (typeof raw !== 'string') {
    throw new Error('Format must be a comma-separated list of field names.');
  }
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (!parts.length) {
    throw new Error('Format must include at least one field.');
  }
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const normalized = normalizeFieldKey(part);
    if (!normalized) {
      throw new Error(`Unknown field in format: ${part}`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function parseArgs(argv) {
  const options = {
    baseDir: path.join(os.homedir(), '.codex', 'sessions'),
    watch: false,
    interval: 15,
    limit: 1,
    minimal: false,
    formatOrder: null,
    labelOverrides: {},
  };

  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      options.formatOrder = parseFormatList(value);
    } else if (arg.startsWith('--override-')) {
      const [flag, inlineValue] = arg.split('=', 2);
      const keyPart = flag.slice('--override-'.length);
      if (!keyPart) {
        throw new Error('Override flag requires a field name.');
      }
      let overrideValue = inlineValue;
      if (overrideValue === undefined) {
        overrideValue = argv[i + 1];
        if (overrideValue === undefined) {
          throw new Error(`Override for ${keyPart} requires a value.`);
        }
        i += 1;
      }
      const normalizedKey = normalizeFieldKey(keyPart);
      if (!normalizedKey) {
        throw new Error(`Unknown override field: ${keyPart}`);
      }
      options.labelOverrides[normalizedKey] = overrideValue;
    } else if ((arg === '--base' || arg === '-b') && argv[i + 1]) {
      options.baseDir = argv[i + 1];
      i += 1;
    } else if (arg === '--watch' || arg === '-w') {
      options.watch = true;
    } else if ((arg === '--interval' || arg === '-n') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Interval must be a positive number of seconds.');
      }
      options.interval = value;
      i += 1;
    } else if ((arg === '--limit' || arg === '-l') && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('Limit must be a positive integer.');
      }
      options.limit = value;
      i += 1;
    } else if (arg === '--minimal' || arg === '-m') {
      options.minimal = true;
    } else if (arg === '--format' || arg === '-f') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error('Format flag requires a comma-separated list of fields.');
      }
      options.formatOrder = parseFormatList(value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--version' || arg === '-v') {
      showVersion = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { options, showHelp, showVersion };
}

function buildHelpMessage() {
  return `Usage: codex-status [options]

Options:
  --base, -b <path>     Override base sessions directory (default: ~/.codex/sessions)
  --watch, -w           Continuously refresh status until interrupted
  --interval, -n <sec>  Seconds between refresh updates (default: 15)
  --limit, -l <count>   Maximum sessions to display (default: 1)
  --minimal, -m         Hide policy and directory details for a compact view
  --format, -f <fields> Comma-separated field order (e.g., time,model,directory)
  --override-<field> <label>
                        Replace a field label emoji/text (e.g., --override-model=🤩)
  --version, -v         Show version information
  --help, -h            Show this message
`;
}

async function findSessionLogs(baseDir, limit) {
  const stack = [baseDir];
  const sessions = [];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        let stats;
        try {
          stats = await fs.promises.stat(entryPath);
        } catch (err) {
          continue;
        }
        sessions.push({
          path: entryPath,
          mtime: stats.mtime,
        });
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  if (Number.isFinite(limit) && limit > 0) {
    return sessions.slice(0, limit);
  }
  return sessions;
}

function formatDuration(seconds, maxUnits = 2) {
  if (seconds == null || Number.isNaN(seconds)) return 'unknown';
  const abs = Math.max(0, Math.floor(seconds));
  const units = [
    { label: 'd', value: 24 * 60 * 60 },
    { label: 'h', value: 60 * 60 },
    { label: 'm', value: 60 },
    { label: 's', value: 1 },
  ];
  const parts = [];
  let remaining = abs;
  for (const unit of units) {
    if (unit.value > remaining && parts.length === 0) continue;
    const count = Math.floor(remaining / unit.value);
    if (count > 0 || parts.length > 0) {
      parts.push(`${count}${unit.label}`);
      remaining -= count * unit.value;
    }
    if (parts.length >= maxUnits) break;
  }
  return parts.length ? parts.join(' ') : '0s';
}

function formatAgoShort(date) {
  if (!date) return 'n/a';
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (Number.isNaN(diffSeconds)) return 'n/a';
  if (diffSeconds < 5) return 'now';
  const duration = formatDuration(diffSeconds, 1);
  return duration.replace(/\s+/g, '');
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCompact(value) {
  return typeof value === 'number' ? compactFormatter.format(value) : 'n/a';
}

async function readLog(filePath) {
  const stream = fs.createReadStream(filePath, 'utf8');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastContext = null;
  let lastTokenCount = null;
  let lastTimestamp = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch (err) {
      continue;
    }

    if (record.timestamp) {
      const ts = new Date(record.timestamp);
      if (!Number.isNaN(ts.getTime())) lastTimestamp = ts;
    }

    if (record.type === 'turn_context') {
      lastContext = record.payload || null;
    } else if (record.type === 'event_msg' && record.payload && record.payload.type === 'token_count') {
      lastTokenCount = record.payload;
    }
  }

  return { lastContext, lastTokenCount, lastTimestamp };
}

async function gatherStatuses(baseDir, limit) {
  const sessions = await findSessionLogs(baseDir, limit);
  if (!sessions.length) {
    return { error: `No rollout logs found in ${baseDir}` };
  }

  const details = [];
  for (const session of sessions) {
    try {
      const info = await readLog(session.path);
      details.push({
        log: session,
        ...info,
      });
    } catch (err) {
      details.push({
        log: session,
        error: err.message || String(err),
      });
    }
  }

  return { sessions: details };
}

function formatRateWindow(windowData) {
  if (!windowData) return 'n/a';
  const used = windowData.used_percent != null ? `${windowData.used_percent}%` : 'n/a';
  const reset = formatDuration(windowData.resets_in_seconds, 1).replace(/\s+/g, '');
  return `${used}/${reset}`;
}

const FIELD_DEFINITIONS = {
  time: {
    defaultLabel: '🕒',
    build: ({ detail }) => formatAgoShort(detail.log.mtime),
  },
  error: {
    defaultLabel: '❌',
    build: ({ detail }) => detail.error || null,
  },
  model: {
    defaultLabel: '🤖',
    build: ({ context }) => {
      if (typeof context.model === 'string' && context.model) {
        return stripModelPrefix(context.model);
      }
      return null;
    },
  },
  approval: {
    defaultLabel: '🛂',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      if (context.approval_policy) return context.approval_policy;
      return null;
    },
  },
  sandbox: {
    defaultLabel: '🧪',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      const policy = context.sandbox_policy;
      if (policy && policy.mode) {
        let label = policy.mode;
        if (policy.network_access === false) label += '🚫';
        return label;
      }
      return null;
    },
  },
  daily: {
    defaultLabel: '🕔',
    build: ({ rateLimits }) => {
      if (rateLimits && rateLimits.primary) {
        return formatRateWindow(rateLimits.primary);
      }
      return null;
    },
  },
  weekly: {
    defaultLabel: '🗓',
    build: ({ rateLimits }) => {
      if (rateLimits && rateLimits.secondary) {
        return formatRateWindow(rateLimits.secondary);
      }
      return null;
    },
  },
  recent: {
    defaultLabel: '🔄',
    build: ({ tokenInfo }) => {
      if (tokenInfo && tokenInfo.last_token_usage && typeof tokenInfo.last_token_usage.total_tokens === 'number') {
        return formatCompact(tokenInfo.last_token_usage.total_tokens);
      }
      if (!tokenInfo) return 'n/a';
      return null;
    },
  },
  total: {
    defaultLabel: '📦',
    build: ({ tokenInfo }) => {
      if (tokenInfo && tokenInfo.total_token_usage && typeof tokenInfo.total_token_usage.total_tokens === 'number') {
        return formatCompact(tokenInfo.total_token_usage.total_tokens);
      }
      return null;
    },
  },
  directory: {
    defaultLabel: '📁',
    build: ({ context, minimal }) => {
      if (minimal) return null;
      if (context.cwd) {
        const display = trimPath(context.cwd);
        if (display) return display;
      }
      return null;
    },
  },
};

function formatSessionSummary(detail, options = {}) {
  const minimal = Boolean(options.minimal);
  const labelOverrides = options.labelOverrides || {};
  const orderSource = Array.isArray(options.formatOrder) && options.formatOrder.length > 0
    ? options.formatOrder
    : DEFAULT_FORMAT_ORDER;
  const order = [];
  for (const entry of orderSource) {
    const key = normalizeFieldKey(entry);
    if (key && !order.includes(key)) order.push(key);
  }

  const context = detail.lastContext || {};
  const tokenCount = detail.lastTokenCount || null;
  const tokenInfo = tokenCount ? tokenCount.info || null : null;
  const rateLimits = tokenCount ? tokenCount.rate_limits || null : null;

  const fieldContext = {
    detail,
    minimal,
    context,
    tokenInfo,
    rateLimits,
  };

  const pieces = [];
  for (const key of order) {
    const definition = FIELD_DEFINITIONS[key];
    if (!definition) continue;
    const value = definition.build(fieldContext);
    if (value == null || value === '') continue;
    const override = Object.prototype.hasOwnProperty.call(labelOverrides, key)
      ? labelOverrides[key]
      : undefined;
    const label = override !== undefined ? override : definition.defaultLabel;
    if (label && String(label).length > 0) {
      pieces.push(`${label}${value}`);
    } else {
      pieces.push(String(value));
    }
  }

  if (!pieces.length) {
    return '⚡ no status';
  }
  return pieces.join(' ');
}

function buildReport(status, options = {}) {
  if (status.error) return status.error;
  const detail = status.sessions[0];
  if (!detail) return '⚡ no sessions';
  return formatSessionSummary(detail, options);
}

async function runOnce(options, stdout) {
  const status = await gatherStatuses(path.resolve(options.baseDir), options.limit);
  console.clear();
  const columns = stdout && Number.isInteger(stdout.columns) ? stdout.columns : null;
  stdout.write(`${truncateToTerminal(buildReport(status, options), columns)}\n`);
}

async function runWatch(options, stdout, deps = {}) {
  const baseDir = path.resolve(options.baseDir);
  const intervalMs = Math.max(1, options.interval) * 1000;
  const columns = () => (stdout && Number.isInteger(stdout.columns) ? stdout.columns : null);
  const gather = deps.gatherStatuses || gatherStatuses;
  const setIntervalFn = deps.setIntervalFn || setInterval;

  let running = false;
  async function draw() {
    if (running) return;
    running = true;
    try {
      const status = await gather(baseDir, options.limit);
      const summary = buildReport(status, options);
      console.clear();
      stdout.write(`${truncateToTerminal(summary, columns())}\n`);
    } finally {
      running = false;
    }
  }

  await draw();
  setIntervalFn(() => {
    draw().catch((err) => {
      console.error('Watch update failed:', err.message || err);
    });
  }, intervalMs);
}

async function runCli({ argv = process.argv.slice(2), version = '0.0.0', stdout = process.stdout }) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(err.message || err);
    return 1;
  }

  const { options, showHelp, showVersion } = parsed;
  if (showHelp) {
    stdout.write(buildHelpMessage());
    return 0;
  }
  if (showVersion) {
    stdout.write(`codex-status v${version}\n`);
    return 0;
  }

  const requirementResult = ensureCodexCli('0.41.0');
  if (requirementResult !== true) {
    return requirementResult;
  }

  try {
    if (options.watch) {
      await runWatch(options, stdout);
    } else {
      await runOnce(options, stdout);
    }
    return 0;
  } catch (err) {
    console.error(err.message || err);
    return 1;
  }
}

module.exports = {
  runCli,
  ensureCodexCli,
  parseArgs,
  compareVersions,
  truncateToTerminal,
  runWatch,
};
