/**
 * 把共享包产物同步到各应用的 node_modules。
 *
 * 背景：pnpm workspace 依赖 `@gc/shared` 通过 junction/symlink 链接。
 * 部分 Windows 环境（无管理员权限、或安全策略禁用链接遍历）下该链接不可用，
 * 导致运行时报 "Cannot find module '@gc/shared'"。
 * 本脚本以复制方式兜底，保证 `pnpm dev` / `pnpm build` 在任何环境都能跑通。
 *
 * 用法：node scripts/sync-shared.mjs
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = resolve(root, 'packages/shared');
const targets = ['apps/server/node_modules/@gc/shared', 'apps/web/node_modules/@gc/shared'];

for (const target of targets) {
  const dest = resolve(root, target);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dirname(dest), { recursive: true });
  await cp(sharedRoot, dest, {
    recursive: true,
    // 只分发构建产物与包描述，避免把源码和 node_modules 一并复制
    filter: (source) => {
      const relative = source.replace(/\\/g, '/');
      if (relative.endsWith('/packages/shared')) return true;
      return relative.endsWith('/dist') || relative.endsWith('/package.json') || relative.includes('/dist/');
    },
  });
  console.log(`[sync-shared] ${target} 已同步`);
}
