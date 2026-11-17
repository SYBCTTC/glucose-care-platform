/**
 * 存量敏感字段重加密：把旧方案密文迁移到当前的确定性 AES-256-GCM。
 *
 * 执行：
 *   pnpm db:reencrypt            # 试运行，只统计不写库（默认）
 *   pnpm db:reencrypt -- --apply # 真正写库
 *
 * 什么时候需要跑：
 *  1. 首次配置 `PATIENT_FIELD_KEY` 之后（存量是 `enc:<base64>` 开发兜底，等于明文）；
 *  2. 加密算法升级、密文前缀版本号变化之后。
 *
 * 安全约定：
 *  - **不配置密钥直接拒绝执行**：否则 base64 → base64 空转一遍还报"成功"，掩盖问题；
 *  - 默认试运行，必须显式 `--apply` 才写库（医疗数据，不做默认破坏性操作）；
 *  - 解密不出明文的行**一律跳过并计数**，绝不拿 null/空串覆盖原密文；
 *  - 幂等：已是当前方案的行重加密后密文不变（确定性加密），自动跳过，可反复执行；
 *  - 不打印任何明文、密文或患者标识，只输出统计数字。
 *
 * ⚠️ 不支持换密钥（re-key）：`enc:hmac:` 历史密文不可逆；
 * 已用旧密钥加密的 AES 密文在换钥后 GCM 校验会失败。两种情况都只能跳过，
 * 需要换钥时先用旧密钥跑本脚本导出、再用新密钥导入，属独立运维流程。
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  cipherSchemeOf,
  decryptField,
  encryptDeterministic,
  isFieldCryptoConfigured,
} from '../src/common/crypto/field-crypto';

const prisma = new PrismaClient();

/** 每页处理行数：分页游标避免一次性把全表读进内存 */
const PAGE_SIZE = 500;

interface Stats {
  scanned: number;
  updated: number;
  unchanged: number;
  /** 解密失败而跳过的行数（按字段累计） */
  skippedUndecryptable: number;
  /** 迁移前各方案的字段数分布 */
  before: Record<string, number>;
  /** 迁移后各方案的字段数分布 */
  after: Record<string, number>;
}

function emptyStats(): Stats {
  return {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    skippedUndecryptable: 0,
    before: {},
    after: {},
  };
}

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

/**
 * 重加密单个字段。
 * @returns 新密文；无需变更或无法解密时返回 null
 */
function reencrypt(
  stored: string | null,
  stats: Stats,
  bucket: 'before' | 'after',
): string | null {
  bump(stats[bucket], cipherSchemeOf(stored));
  if (stored === null) {
    return null;
  }
  const plain = decryptField(stored);
  if (plain === null) {
    // 不可逆的历史 HMAC 密文、或密钥不匹配：跳过，保留原值等人工处理
    stats.skippedUndecryptable += 1;
    return null;
  }
  const next = encryptDeterministic(plain);
  return next === stored ? null : next;
}

async function reencryptPatients(stats: Stats, apply: boolean): Promise<void> {
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.patient.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      select: { id: true, nameCipher: true, idCardCipher: true, phoneCipher: true },
      orderBy: { id: 'asc' },
    });
    if (rows.length === 0) {
      return;
    }
    cursor = rows[rows.length - 1].id;

    // $transaction 只接受 PrismaPromise（带 Symbol.toStringTag 标记），普通 Promise 会类型不匹配
    const updates: Array<Prisma.PrismaPromise<unknown>> = [];
    for (const row of rows) {
      stats.scanned += 1;
      const nameCipher = reencrypt(row.nameCipher, stats, 'before');
      const idCardCipher = reencrypt(row.idCardCipher, stats, 'before');
      const phoneCipher = reencrypt(row.phoneCipher, stats, 'before');

      if (nameCipher === null && idCardCipher === null && phoneCipher === null) {
        stats.unchanged += 1;
        // 未变更的行也要统计 after 分布，否则迁移后核对不上
        bump(stats.after, cipherSchemeOf(row.nameCipher));
        bump(stats.after, cipherSchemeOf(row.idCardCipher));
        bump(stats.after, cipherSchemeOf(row.phoneCipher));
        continue;
      }

      stats.updated += 1;
      bump(stats.after, cipherSchemeOf(nameCipher ?? row.nameCipher));
      bump(stats.after, cipherSchemeOf(idCardCipher ?? row.idCardCipher));
      bump(stats.after, cipherSchemeOf(phoneCipher ?? row.phoneCipher));

      if (apply) {
        updates.push(
          prisma.patient.update({
            where: { id: row.id },
            data: {
              ...(nameCipher === null ? {} : { nameCipher }),
              ...(idCardCipher === null ? {} : { idCardCipher }),
              ...(phoneCipher === null ? {} : { phoneCipher }),
            },
          }),
        );
      }
    }

    if (updates.length > 0) {
      // 整页一个事务：中途失败不留半页新半页旧
      await prisma.$transaction(updates);
    }
  }
}

async function reencryptUsers(stats: Stats, apply: boolean): Promise<void> {
  const rows = await prisma.user.findMany({
    select: { id: true, phoneCipher: true },
    orderBy: { id: 'asc' },
  });

  const updates: Array<Prisma.PrismaPromise<unknown>> = [];
  for (const row of rows) {
    stats.scanned += 1;
    const phoneCipher = reencrypt(row.phoneCipher, stats, 'before');
    bump(stats.after, cipherSchemeOf(phoneCipher ?? row.phoneCipher));
    if (phoneCipher === null) {
      stats.unchanged += 1;
      continue;
    }
    stats.updated += 1;
    if (apply) {
      updates.push(prisma.user.update({ where: { id: row.id }, data: { phoneCipher } }));
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  if (!isFieldCryptoConfigured()) {
    console.error(
      '[reencrypt] ✗ 未配置 PATIENT_FIELD_KEY，拒绝执行。\n' +
        '  没有密钥时加密函数会退回 base64，跑一遍只是空转并报"成功"，掩盖真实问题。\n' +
        '  请先在 apps/server/.env 配置密钥（≥32 位随机串），再重跑本脚本。',
    );
    process.exitCode = 1;
    return;
  }

  // 运维脚本的进度输出一律走 console.warn：eslint 的 no-console 只放行 warn/error，
  // 与 prisma/seed.ts 的既有约定一致（见 seed.ts 的完成提示）。
  console.warn(`[reencrypt] 模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（只统计，加 --apply 才写库）'}`);

  const stats = emptyStats();
  await reencryptPatients(stats, apply);
  await reencryptUsers(stats, apply);

  console.warn('[reencrypt] 扫描行数        =', stats.scanned);
  console.warn('[reencrypt] 需重加密行数    =', stats.updated);
  console.warn('[reencrypt] 已是当前方案    =', stats.unchanged);
  console.warn('[reencrypt] 无法解密已跳过  =', stats.skippedUndecryptable);
  console.warn('[reencrypt] 迁移前字段分布  =', JSON.stringify(stats.before));
  console.warn('[reencrypt] 迁移后字段分布  =', JSON.stringify(stats.after));

  if (stats.skippedUndecryptable > 0) {
    console.warn(
      '[reencrypt] ⚠️ 有字段解密失败被跳过（历史 HMAC 密文不可逆，或密钥与密文不匹配）。' +
        '这些行保留原密文，需人工确认处理方式，不要直接删除。',
    );
  }
  if (!apply && stats.updated > 0) {
    console.warn('[reencrypt] 试运行未写库。确认无误后执行：pnpm db:reencrypt -- --apply');
  }
}

main()
  .catch((error: unknown) => {
    console.error('[reencrypt] 执行失败', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
