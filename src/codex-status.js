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
    // fall back to checking PATH for Homebrew or other installs
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

function parseArgs(argv) {
  const options = {
    baseDir: path.join(os.homedir(), '.codex', 'sessions'),
    watch: false,
    interval: 15,
    limit: 1,
  };

  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--base' || arg === '-b') && argv[i + 1]) {
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

function formatTimestamp(date) {
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;
  if (sameDay) return time;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day} ${time}`;
}

function formatSessionSummary(detail) {
  const fields = [`🕒${formatAgoShort(detail.log.mtime)}`];
  let cwdField = null;
  if (detail.error) {
    fields.push(`❌${detail.error}`);
    if (cwdField) fields.push(cwdField);
    return fields.join(' ');
  }

  const context = detail.lastContext || {};
  if (typeof context.model === 'string' && context.model) {
    fields.push(`🤖${stripModelPrefix(context.model)}`);
  }
  if (context.approval_policy) fields.push(`🛂${context.approval_policy}`);
  if (context.sandbox_policy && context.sandbox_policy.mode) {
    let sandbox = `🧪${context.sandbox_policy.mode}`;
    if (context.sandbox_policy.network_access === false) sandbox += '🚫';
    fields.push(sandbox);
  }
  if (context.cwd) {
    const displayCwd = trimPath(context.cwd);
    if (displayCwd) cwdField = `📁${displayCwd}`;
  }

  const rateLimits = detail.lastTokenCount ? detail.lastTokenCount.rate_limits : null;
  if (rateLimits) {
    if (rateLimits.primary) fields.push(`🕔${formatRateWindow(rateLimits.primary)}`);
    if (rateLimits.secondary) fields.push(`🗓${formatRateWindow(rateLimits.secondary)}`);
  }

  const tokenInfo = detail.lastTokenCount ? detail.lastTokenCount.info : null;
  if (tokenInfo) {
    const recent = tokenInfo.last_token_usage || {};
    const total = tokenInfo.total_token_usage || {};
    if (typeof recent.total_tokens === 'number') {
      fields.push(`🔄${formatCompact(recent.total_tokens)}`);
    }
    if (typeof total.total_tokens === 'number') {
      fields.push(`📦${formatCompact(total.total_tokens)}`);
    }
  } else {
    fields.push('🔄n/a');
  }

  if (cwdField) fields.push(cwdField);
  return fields.join(' ');
}

function buildReport(status) {
  if (status.error) return status.error;
  const detail = status.sessions[0];
  if (!detail) return '⚡ no sessions';
  return formatSessionSummary(detail);
}

async function runOnce(options, stdout) {
  const status = await gatherStatuses(path.resolve(options.baseDir), options.limit);
  console.clear();
  const columns = stdout && Number.isInteger(stdout.columns) ? stdout.columns : null;
  stdout.write(`${truncateToTerminal(buildReport(status), columns)}\n`);
}

async function runWatch(options, stdout) {
  const baseDir = path.resolve(options.baseDir);
  const intervalMs = Math.max(1, options.interval) * 1000;
  const columns = () => (stdout && Number.isInteger(stdout.columns) ? stdout.columns : null);

  let running = false;
  async function draw() {
    if (running) return;
    running = true;
    try {
      const status = await gatherStatuses(baseDir, options.limit);
      const summary = buildReport(status);
      console.clear();
      const line = `🕘 ${formatTimestamp(new Date())} ${summary}`;
      stdout.write(`${truncateToTerminal(line, columns())}\n`);
    } finally {
      running = false;
    }
  }

  await draw();
  setInterval(() => {
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
};
