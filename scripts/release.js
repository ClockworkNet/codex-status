#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');

function log(step, message) {
  process.stdout.write(`\n[${step}] ${message}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    const pretty = [command, ...args].join(' ');
    throw new Error(`Command failed: ${pretty}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (result.status !== 0) {
    const pretty = [command, ...args].join(' ');
    const stderr = result.stderr?.toString() || '';
    throw new Error(`Command failed: ${pretty}\n${stderr}`);
  }
  return result.stdout.toString().trim();
}

function ensureCleanWorkingTree() {
  const status = runCapture('git', ['status', '--porcelain']);
  if (status) {
    throw new Error('Working tree is not clean. Commit or stash your changes before running the release script.');
  }
}

function ensureTagDoesNotExist(tagName) {
  const existing = runCapture('git', ['tag', '--list', tagName]);
  if (existing === tagName) {
    throw new Error(`Tag ${tagName} already exists. Bump the version in package.json before re-running.`);
  }
}

function getVersion() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  return pkg.version;
}

function runTests() {
  log('test', 'Running npm test');
  run('npm', ['test']);
}

function fetchGitHubTarballSha(version) {
  return new Promise((resolve, reject) => {
    const url = `https://github.com/clockworknet/codex-status/archive/refs/tags/v${version}.tar.gz`;
    log('fetch', `Fetching GitHub tarball: ${url}`);
    
    const hash = crypto.createHash('sha256');
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        return;
      }
      
      res.on('data', (chunk) => hash.update(chunk));
      res.on('end', () => {
        const sha = hash.digest('hex');
        resolve(sha);
      });
      res.on('error', reject);
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}


function updateFormula(version, sha) {
  const formulaPath = 'HomebrewFormula/codex-status.rb';
  const formula = readFileSync(formulaPath, 'utf8');
  const versionUrlPattern = /url "https:\/\/github\.com\/clockworknet\/codex-status\/archive\/refs\/tags\/v[\d.]+\.tar\.gz"/;
  const shaPattern = /sha256 "[^"]+"/;
  if (!versionUrlPattern.test(formula)) {
    throw new Error('Unable to locate url line in formula. Confirm the expected format.');
  }
  if (!shaPattern.test(formula)) {
    throw new Error('Unable to locate sha256 line in formula. Confirm the expected format.');
  }
  const updated = formula
    .replace(versionUrlPattern, `url "https://github.com/clockworknet/codex-status/archive/refs/tags/v${version}.tar.gz"`)
    .replace(shaPattern, `sha256 "${sha}"`);
  writeFileSync(formulaPath, updated);
  log('formula', `Updated Homebrew formula with version v${version} and SHA.`);
}

async function main() {
  try {
    log('check', 'Ensuring working tree is clean');
    ensureCleanWorkingTree();

    const version = getVersion();
    const tagName = `v${version}`;
    log('version', `Preparing release for ${tagName}`);

    ensureTagDoesNotExist(tagName);
    runTests();

    const sha = await fetchGitHubTarballSha(version);
    log('sha', `GitHub tarball SHA256: ${sha}`);

    updateFormula(version, sha);

    log('next', 'Review changes, commit, then tag and push when ready.');
  } catch (error) {
    const message = error?.message || error;
    process.stderr.write(`\nError: ${message}\n`);
    process.exit(1);
  }
}

main();
