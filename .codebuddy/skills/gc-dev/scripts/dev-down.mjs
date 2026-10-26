/**
 * 停止本地开发服务（后端 3000 / 前端 5173）。
 *
 * 停止策略（按优先级）：
 *  1. dev-up 写入的 .devtools/run/*.pid：杀父进程整树，避免只杀监听子进程、留下 nest watcher
 *  2. 端口监听者：兜底（例如服务是手工启动、没有 pid 文件）
 *  3. 命令行扫描：清掉没有监听端口的孤儿 watcher（旧版按端口停止会留下 nest start --watch）
 *
 * 用法：
 *   node .codebuddy/skills/gc-dev/scripts/dev-down.mjs         只停前后端，数据库继续运行
 *   node .codebuddy/skills/gc-dev/scripts/dev-down.mjs --db    连嵌入式 PostgreSQL 一起停
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = 3000;
const WEB_PORT = 5173;
const PG_PORT = 5432;

const flags = new Set(process.argv.slice(2));
const withDb = flags.has('--db');
const ports = withDb ? [SERVER_PORT, WEB_PORT, PG_PORT] : [SERVER_PORT, WEB_PORT];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const runDir = join(root, '.devtools/run');

const targets = new Map();
const addTarget = (pid, reason) => {
  if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) {
    targets.set(pid, reason);
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// 1. dev-up 记录的父进程 PID
const pidFiles = [];
for (const name of withDb ? ['server', 'web', 'pg'] : ['server', 'web']) {
  const file = join(runDir, `${name}.pid`);
  if (!existsSync(file)) continue;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (isAlive(pid)) addTarget(pid, `pid 文件 ${name}`);
  pidFiles.push(file);
}

// 2. 端口监听者兜底（pid 文件缺失时）
const netstat = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', shell: true });
for (const line of (netstat.stdout ?? '').split(/\r?\n/)) {
  const cols = line.trim().split(/\s+/);
  if (cols.length < 5 || !cols[0].toUpperCase().includes('TCP')) continue;
  const localPort = Number(cols[1].split(':').pop());
  if (ports.includes(localPort) && cols[3].toUpperCase() === 'LISTENING') {
    addTarget(Number(cols[4]), `端口 ${localPort}`);
  }
}

// 3. 命令行兜底：清理没有监听端口的孤儿 watcher
if (process.platform === 'win32') {
  const patterns = [
    'nest\\.js.*start --watch',
    'vite\\.js',
    'pnpm\\.cjs.*dev:(server|web)',
    ...(withDb ? ['start-db\\.mjs'] : []),
  ].join('|');
  const script = [
    `$root = '${root.replace(/'/g, "''")}';`,
    'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" |',
    `Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) -and $_.CommandLine -match '${patterns}' } |`,
    'ForEach-Object { $_.ProcessId }',
  ].join(' ');
  const found = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  for (const line of (found.stdout ?? '').split(/\r?\n/)) {
    addTarget(Number(line.trim()), '残留 dev 进程');
  }
}

if (targets.size === 0) {
  for (const file of pidFiles) rmSync(file, { force: true });
  console.log('[gc-dev] 没有需要停止的进程');
  process.exit(0);
}

for (const [pid, reason] of targets) {
  if (!isAlive(pid)) continue;
  const result = spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], {
    encoding: 'utf8',
    shell: true,
  });
  if (result.status === 0) {
    console.log(`[gc-dev] 已停止 PID ${pid}（${reason}）`);
  } else {
    console.warn(
      `[gc-dev] 停止 PID ${pid}（${reason}）失败：${(result.stderr || result.stdout || '').trim()}`,
    );
  }
}

for (const file of pidFiles) rmSync(file, { force: true });

console.log(
  withDb
    ? '[gc-dev] 前后端与数据库均已停止'
    : '[gc-dev] 前后端已停止（数据库仍在运行，加快下次启动）',
);
