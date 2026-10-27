#!/usr/bin/env node
/**
 * 收敛输出的质量门禁脚本。
 *
 * 解决的问题：pnpm -r lint/typecheck/test 的输出会整段进入 AI 上下文，
 * 一次全量校验动辄上千行，而其中 99% 是成功噪声。
 *
 * 策略：**成功静默，失败全量**。
 *  - 成功：每个步骤只打一行「✅ 名称 + 耗时 + 摘要」
 *  - 失败：原样打印该步骤完整输出（此时诊断信息一个字都不能少），并以非零码退出
 *
 * 用法：
 *   node scripts/check.mjs              # lint + typecheck + test（全仓库）
 *   node scripts/check.mjs server       # 只验后端（含 shared 的 lint）
 *   node scripts/check.mjs web          # 只验前端（含 shared 的 lint）
 *   node scripts/check.mjs server --verbose   # 成功也打印全量输出
 */

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const scopeArg = argv.find((arg) => !arg.startsWith('-'));

const SCOPES = {
  all: {
    label: '全仓库',
    steps: [
      { name: 'lint', command: 'pnpm exec eslint .' },
      { name: 'typecheck', command: 'pnpm -r typecheck' },
      { name: 'test', command: 'pnpm -r test' },
    ],
  },
  server: {
    label: 'server + shared',
    steps: [
      { name: 'lint', command: 'pnpm exec eslint apps/server packages/shared' },
      { name: 'typecheck', command: 'pnpm --filter @gc/server typecheck' },
      {
        name: 'test',
        command:
          'pnpm --filter @gc/server exec vitest run --passWithNoTests --reporter=dot --silent',
      },
    ],
  },
  web: {
    label: 'web + shared',
    steps: [
      { name: 'lint', command: 'pnpm exec eslint apps/web packages/shared' },
      { name: 'typecheck', command: 'pnpm --filter @gc/web typecheck' },
      {
        name: 'test',
        command: 'pnpm --filter @gc/web exec vitest run --passWithNoTests --reporter=dot --silent',
      },
    ],
  },
};

const scopeKey = scopeArg ?? 'all';
const scope = SCOPES[scopeKey];

if (!scope) {
  console.error(`未知范围：${scopeKey}。可用值：${Object.keys(SCOPES).join(' / ')}`);
  process.exit(2);
}

/** 去掉 ANSI 颜色码，避免把转义序列写进日志或上下文（用 fromCharCode 规避 no-control-regex） */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * 从测试输出里提取一行摘要。
 * 用途：`--passWithNoTests` 会让「一个测试都没跑」也算通过，
 * 把真实用例数暴露出来，避免出现「全绿但其实没用例」的假阳性。
 */
function testSummary(output) {
  const plain = stripAnsi(output);
  const matches = plain.match(/Tests\s+(?:\d+ failed[^\n]*?)?\d+ passed[^\n]*/g);
  if (!matches) {
    return '未发现用例统计';
  }
  // 全量模式会依次跑多个包，逐个列出，避免只看到最后一个包的用例数
  return matches.map((line) => line.trim()).join(' | ');
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

console.log(`> check [${scopeKey}] ${scope.label}`);

const failures = [];
const startedAt = Date.now();

for (const step of scope.steps) {
  const stepStartedAt = Date.now();
  const result = spawnSync(step.command, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });

  const duration = Date.now() - stepStartedAt;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const passed = result.status === 0;

  if (passed) {
    const extra = step.name === 'test' ? `  ${testSummary(output)}` : '';
    console.log(`✅ ${step.name.padEnd(9)} ${formatDuration(duration).padStart(6)}${extra}`);
    if (verbose && output.trim()) {
      console.log(stripAnsi(output).trimEnd());
    }
    continue;
  }

  failures.push(step.name);
  console.log(
    `❌ ${step.name.padEnd(9)} ${formatDuration(duration).padStart(6)}  (${step.command})`,
  );
  // 失败时不做任何裁剪：堆栈、断言行号、类型错误都在这里
  console.log(stripAnsi(output).trimEnd() || '(无输出，退出码 ' + result.status + ')');
  break;
}

const total = Date.now() - startedAt;

if (failures.length > 0) {
  console.log(`\n失败：${failures.join(', ')}（总计 ${formatDuration(total)}）`);
  process.exit(1);
}

console.log(`\n全部通过（总计 ${formatDuration(total)}）`);
