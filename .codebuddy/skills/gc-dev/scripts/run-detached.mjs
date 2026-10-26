/**
 * 以 detached 方式启动 dev 服务，并把 stdout/stderr 落盘。
 *
 * 为什么需要这层包装：Windows 下用 `cmd /c "... > log 2>&1"` + detached 启动时，
 * cmd 重定向的句柄在部分环境（IDE 沙箱/作业对象）不会传给子进程，日志恒为 0 字节。
 * 由 Node 进程创建 pipe 再写入文件则不依赖句柄继承，稳定可用。
 *
 * 用法：
 *   node run-detached.mjs <logFile> <command> [...args]
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [logFile, command, ...args] = process.argv.slice(2);

if (!logFile || !command) {
  console.error('[gc-dev] usage: node run-detached.mjs <logFile> <command> [...args]');
  process.exit(2);
}

mkdirSync(dirname(logFile), { recursive: true });
const stream = createWriteStream(logFile, { flags: 'w' });

const child = spawn(command, args, {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
  env: process.env,
});

child.stdout.pipe(stream, { end: false });
child.stderr.pipe(stream, { end: false });

child.on('error', (error) => {
  stream.write(`[gc-dev] 启动失败：${error.message}\n`);
});

child.on('exit', (code, signal) => {
  stream.end(`[gc-dev] 进程退出 code=${code ?? '-'} signal=${signal ?? '-'}\n`, () => {
    process.exit(code ?? 0);
  });
});
