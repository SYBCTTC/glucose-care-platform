/**
 * 停止本地开发服务（后端 3000 / 前端 5173）。
 *
 * 用法：
 *   node .codebuddy/skills/gc-dev/scripts/dev-down.mjs         只停前后端，数据库继续运行
 *   node .codebuddy/skills/gc-dev/scripts/dev-down.mjs --db    连嵌入式 PostgreSQL 一起停
 */
import { spawnSync } from 'node:child_process';

const SERVER_PORT = 3000;
const WEB_PORT = 5173;
const PG_PORT = 5432;

const flags = new Set(process.argv.slice(2));
const withDb = flags.has('--db');
const ports = withDb ? [SERVER_PORT, WEB_PORT, PG_PORT] : [SERVER_PORT, WEB_PORT];

const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', shell: true });
const pids = new Set();

for (const line of (out.stdout ?? '').split(/\r?\n/)) {
  const cols = line.trim().split(/\s+/);
  if (cols.length < 5 || !cols[0].toUpperCase().includes('TCP')) continue;
  const localPort = Number(cols[1].split(':').pop());
  if (ports.includes(localPort) && cols[3].toUpperCase() === 'LISTENING') pids.add(Number(cols[4]));
}

if (pids.size === 0) {
  console.log('[gc-dev] 没有需要停止的进程');
  process.exit(0);
}

for (const pid of pids) {
  spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', shell: true });
  console.log(`[gc-dev] 已停止 PID ${pid}`);
}

console.log(
  withDb
    ? '[gc-dev] 前后端与数据库均已停止'
    : '[gc-dev] 前后端已停止（数据库仍在运行，加快下次启动）',
);
