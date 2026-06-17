/**
 * Build standalone Jira Dashboard packages (no Node.js required to run).
 *
 * Usage:
 *   node scripts/build-standalone.js           # current OS
 *   node scripts/build-standalone.js win       # Windows x64
 *   node scripts/build-standalone.js mac       # macOS x64 + arm64
 *   node scripts/build-standalone.js all         # all platforms
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PKG_TARGETS = {
  win: ['node18-win-x64'],
  mac: ['node18-macos-x64', 'node18-macos-arm64'],
  linux: ['node18-linux-x64'],
};

const PLATFORM_LABEL = {
  'node18-win-x64': 'Windows',
  'node18-macos-x64': 'macOS-Intel',
  'node18-macos-arm64': 'macOS-Apple-Silicon',
  'node18-linux-x64': 'Linux',
};

const EXE_NAME = {
  'node18-win-x64': 'Jira-Dashboard.exe',
  'node18-macos-x64': 'Jira-Dashboard',
  'node18-macos-arm64': 'Jira-Dashboard',
  'node18-linux-x64': 'jira-dashboard',
};

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
}

function copyPackageFiles(outDir) {
  const configOut = path.join(outDir, 'config');
  fs.mkdirSync(configOut, { recursive: true });

  fs.copyFileSync(
    path.join(ROOT, 'dashboard.html'),
    path.join(outDir, 'dashboard.html')
  );

  fs.copyFileSync(
    path.join(ROOT, 'config', 'projects.default.json'),
    path.join(configOut, 'projects.default.json')
  );

  fs.copyFileSync(
    path.join(ROOT, 'docs', 'STANDALONE-README.txt'),
    path.join(outDir, 'README.txt')
  );

  if (process.platform === 'win32') {
    fs.copyFileSync(
      path.join(ROOT, 'docs', 'Start Jira Dashboard.vbs'),
      path.join(outDir, 'Start Jira Dashboard.vbs')
    );
  }
}

function zipDir(dirPath, zipPath) {
  if (process.platform === 'win32') {
    const parent = path.dirname(dirPath);
    const name = path.basename(dirPath);
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${dirPath}\\*' -DestinationPath '${zipPath}' -Force"`
    );
    return;
  }

  const parent = path.dirname(dirPath);
  const name = path.basename(dirPath);
  run(`cd "${parent}" && zip -r "${zipPath}" "${name}"`);
}

function buildTarget(target) {
  const label = PLATFORM_LABEL[target];
  const folderName = `Jira-Dashboard-${label}`;
  const outDir = path.join(DIST, folderName);
  const exeName = EXE_NAME[target];
  const exePath = path.join(outDir, exeName);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  run(`npx pkg proxy.js --targets ${target} --output "${exePath}"`);

  copyPackageFiles(outDir);

  if (target !== 'node18-win-x64') {
    fs.chmodSync(exePath, 0o755);
  }

  const zipPath = path.join(DIST, `${folderName}.zip`);
  fs.rmSync(zipPath, { force: true });
  zipDir(outDir, zipPath);

  console.log(`\n  Built: ${zipPath}\n`);
}

function resolveTargets(arg) {
  if (arg === 'all') return [...PKG_TARGETS.win, ...PKG_TARGETS.mac];
  if (arg && PKG_TARGETS[arg]) return PKG_TARGETS[arg];

  const key = process.platform === 'win32' ? 'win'
    : process.platform === 'darwin' ? 'mac'
    : 'linux';
  if (PKG_TARGETS[key]) return PKG_TARGETS[key];

  console.error(`Unknown platform "${arg}". Use: win, mac, linux, or all`);
  process.exit(1);
}

function main() {
  const arg = process.argv[2];
  const targets = resolveTargets(arg);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  console.log('\n  Building standalone Jira Dashboard...\n');
  for (const target of targets) {
    buildTarget(target);
  }
  console.log('  Done.\n');
}

main();