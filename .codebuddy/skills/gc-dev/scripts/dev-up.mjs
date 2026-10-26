/**
 * 一键启动本地开发环境（PostgreSQL + 后端 + 前端）。
 *
 * 与 `pnpm dev` 的差异：
 *  - 已在运行的服务直接跳过（幂等，重复执行 < 1s）
 *  - @gc/shared 源码没变时跳过 build + sync（省约 5s，且不破坏 Vite 依赖缓存）
 *  - prisma/schema.prisma 没变时跳过 prisma generate（省约 7s）
 *  - 嵌入式 PG 已在 5432 监听时跳过启动
 *
 * 用法：
 *   node .codebuddy/skills/gc-dev/scripts/dev-up.mjs
 *   node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --restart        先停后起
 *   node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --sync-shared    强制重建并同步共享包
 *   node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --generate      强制重新生成 Prisma Client
 *   node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --seed          重新灌演示数据（危险：覆盖现有数据）
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

const SERVER_PORT = 3000;
const WEB_PORT = 5173;
const PG_PORT = 5432;
const SERVER_HEALTH = `http://127.0.0.1:${SERVER_PORT}/api/health`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const logDir = join(root, '.devtools/logs');
const flags = new Set(process.argv.slice(2));

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);
const ok = (msg) => console.log(`  \u2714 ${msg}`);
const skip = (msg) => console.log(`  \u2212 ${msg}`);
const info = (msg) => console.log(`  \u2026 ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPortOpen(port, timeout = 400) {
  return new Promise((done) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitPort(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await sleep(200);
  }
  return false;
}

function httpOk(url, timeout = 1500) {
  return new Promise((done) => {
    const request = http.get(url, { timeout }, (res) => {
      res.resume();
      done(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
    });
    request.on('timeout', () => {
      request.destroy();
      done(false);
    });
    request.on('error', () => done(false));
  });
}

async function waitHttp(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpOk(url)) return true;
    await sleep(250);
  }
  return false;
}

function newestMtime(dir) {
  let newest = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return newest;
}

function mtime(file) {
  return existsSync(file) ? statSync(file).mtimeMs : 0;
}

function run(command, args, label) {
  info(label);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  if (result.status !== 0) {
    warn(`${label} 失败，退出码 ${result.status}`);
    process.exit(1);
  }
}

function listListeningPids(ports) {
  const out = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', shell: true });
  const pids = new Set();
  for (const line of (out.stdout ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || !cols[0].toUpperCase().includes('TCP')) continue;
    const localPort = Number(cols[1].split(':').pop());
    if (ports.includes(localPort) && cols[3].toUpperCase() === 'LISTENING') pids.add(Number(cols[4]));
  }
  return [...pids].filter((pid) => Number.isFinite(pid) && pid > 0);
}

function killPids(pids) {
  for (const pid of pids) {
    spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', shell: true });
  }
}

function startDetached(command, args, logFile) {
  mkdirSync(logDir, { recursive: true });
  const fd = openSync(join(logDir, logFile), 'w');
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', fd, fd],
    shell: true,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.unref();
  closeSync(fd);
  return child.pid;
}

async function main() {
  console.log('\n[gc-dev] 启动本地开发环境');

  if (flags.has('--restart')) {
    const pids = listListeningPids([SERVER_PORT, WEB_PORT]);
    if (pids.length) {
      killPids(pids);
      info(`已停止旧进程 ${pids.join(', ')}`);
      await sleep(1500);
    }
  }

  // ---------- 1. 依赖 ----------
  if (!existsSync(join(root, 'node_modules'))) {
    run('pnpm', ['install'], '安装依赖（首次启动）');
    ok('依赖已安装');
  } else {
    skip('依赖已存在（跳过 pnpm install）');
  }

  // ---------- 2. 数据库 ----------
  if (await isPortOpen(PG_PORT)) {
    skip(`PostgreSQL ${PG_PORT} 已在运行（跳过启动）`);
  } else {
    info('启动嵌入式 PostgreSQL …');
    startDetached('node', ['.devtools/start-db.mjs'], 'pg.log');
    const ready = await waitPort(PG_PORT, 60_000);
    if (!ready) {
      warn('PostgreSQL 启动超时，查看 .devtools/logs/pg.log');
      process.exit(1);
    }
    ok(`PostgreSQL ${PG_PORT} 就绪`);
  }

  if (flags.has('--generate')) {
    run('pnpm', ['db:generate'], '重新生成 Prisma Client');
    ok('Prisma Client 已生成');
  } else {
    const schema = join(root, 'apps/server/prisma/schema.prisma');
    const client = join(root, 'node_modules/.prisma/client/index.js');
    if (mtime(schema) > mtime(client)) {
      run('pnpm', ['db:generate'], 'schema.prisma 有更新，重新生成 Prisma Client');
      ok('Prisma Client 已生成');
    } else {
      skip('Prisma Client 与 schema.prisma 一致（跳过 generate）');
    }
  }

  if (flags.has('--seed')) {
    run('pnpm', ['db:seed'], '重灌演示数据');
    ok('演示数据已就绪');
  }

  // ---------- 3. 共享包 ----------
  const sharedSrc = join(root, 'packages/shared/src');
  const sharedDist = join(root, 'packages/shared/dist/index.js');
  const copiedDist = join(root, 'apps/web/node_modules/@gc/shared/dist/index.js');
  const stale =
    flags.has('--sync-shared') ||
    newestMtime(sharedSrc) > mtime(sharedDist) ||
    mtime(sharedDist) > mtime(copiedDist) ||
    !existsSync(copiedDist);

  if (stale) {
    run('pnpm', ['--filter', '@gc/shared', 'build'], '编译共享包');
    run('node', ['scripts/sync-shared.mjs'], '同步共享包到 apps/*');
    // 共享包副本更新会改变依赖图指纹，必须清 Vite 预构建缓存，否则可能整页白屏
    rmSync(join(root, 'apps/web/node_modules/.vite'), { recursive: true, force: true });
    ok('共享包已同步，Vite 预构建缓存已重置');
  } else {
    skip('共享包无变更（跳过 build + sync，保留 Vite 缓存）');
  }

  // ---------- 4. 后端 + 前端并行启动 ----------
  const [serverUp, webUp] = await Promise.all([isPortOpen(SERVER_PORT), isPortOpen(WEB_PORT)]);
  const serverStartedAt = Date.now();
  const webStartedAt = Date.now();

  const serverTask = (async () => {
    if (serverUp) {
      skip(`后端 ${SERVER_PORT} 已在运行（跳过）`);
      return;
    }
    info('启动后端（nest 全量编译，约 10-13s）…');
    startDetached('pnpm', ['dev:server'], 'server.log');
    if (!(await waitHttp(SERVER_HEALTH))) {
      warn('后端启动超时，查看 .devtools/logs/server.log');
      process.exit(1);
    }
    ok(`后端就绪 ${SERVER_HEALTH}（${((Date.now() - serverStartedAt) / 1000).toFixed(1)}s）`);
  })();

  const webTask = (async () => {
    if (webUp) {
      skip(`前端 ${WEB_PORT} 已在运行（跳过）`);
      return;
    }
    info('启动前端（Vite）…');
    startDetached('pnpm', ['dev:web'], 'web.log');
    if (!(await waitHttp(WEB_URL))) {
      warn('前端启动超时，查看 .devtools/logs/web.log');
      process.exit(1);
    }
    ok(`前端就绪 ${WEB_URL}（${((Date.now() - webStartedAt) / 1000).toFixed(1)}s）`);
  })();

  await Promise.all([serverTask, webTask]);

  console.log(`
[gc-dev] 就绪，总耗时 ${elapsed()}s
  前端   http://127.0.0.1:${WEB_PORT}
  后端   http://127.0.0.1:${SERVER_PORT}/api
  健康   ${SERVER_HEALTH}
  演示账号 sys.admin / Gc@2026pass（SYS_ADMIN，全院数据）
           dr.wang  / Gc@2026pass（DOCTOR，内分泌科）
  日志   .devtools/logs/{server,web,pg}.log
  停止   pnpm dev:down
`);
}

main().catch((error) => {
  console.error('[gc-dev] 启动失败：', error?.message ?? error);
  process.exit(1);
});
