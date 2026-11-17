/**
 * 存量敏感字段重加密：把旧方案密文迁移到当前的确定性 AES-256-GCM，并支持换密钥（re-key）。
 *
 * ## 两种模式
 *
 * **① 方案迁移**（未设 `PATIENT_FIELD_KEY_OLD`）：解密与加密都用 `PATIENT_FIELD_KEY`。
 * 用于把 `enc:<base64>` 开发兜底密文升级为真 AES，或加密算法/前缀版本号变更后重刷。
 *
 * **② 换密钥 re-key**（设了 `PATIENT_FIELD_KEY_OLD`）：用旧钥解密、新钥加密。
 * ```powershell
 * # .env 里 PATIENT_FIELD_KEY 已换成新钥，再临时提供旧钥：
 * $env:PATIENT_FIELD_KEY_OLD="<旧钥>"; pnpm db:reencrypt            # 先试运行
 * $env:PATIENT_FIELD_KEY_OLD="<旧钥>"; pnpm db:reencrypt -- --apply  # 确认后写库
 * Remove-Item Env:PATIENT_FIELD_KEY_OLD                             # 跑完立刻清掉，别让旧钥留在会话里
 * ```
 *
 * 执行：
 *   pnpm db:reencrypt            # 试运行，只统计不写库（默认）
 *   pnpm db:reencrypt -- --apply # 真正写库
 *
 * 什么时候需要跑：
 *  1. 首次配置 `PATIENT_FIELD_KEY` 之后（存量是 `enc:<base64>` 开发兜底，等于明文）；
 *  2. 加密算法升级、密文前缀版本号变化之后；
 *  3. 更换 `PATIENT_FIELD_KEY` 之后（等保要求具备密钥轮换能力）——走 re-key 模式。
 *
 * ## 安全约定
 *
 *  - **不配置新钥直接拒绝执行**：否则 base64 → base64 空转一遍还报"成功"，掩盖问题；
 *  - 默认试运行，必须显式 `--apply` 才写库（医疗数据，不做默认破坏性操作）；
 *  - 解密不出明文的行**一律跳过并计数**，绝不拿 null/空串覆盖原密文；
 *  - **失败即安全**：拿错旧钥（或新旧钥写反）时所有行 GCM 校验失败 → 全部跳过 → 零写入，
 *    不会损毁数据，只会报"无法解密"，据此可发现拿错钥；
 *  - 回显新旧钥**指纹**（SHA-256 前 8 位）而非密钥本身，供操作者核对拿的是哪把钥；
 *  - 不打印任何明文、密文或患者标识，只输出统计数字。
 *
 * ## 幂等性（两种模式不同，别搞混）
 *
 *  - 方案迁移模式**幂等**：确定性加密下已是当前方案的行重加密后密文不变，自动跳过，可反复执行；
 *  - re-key 模式**不幂等**：跑完一次后存量已是新钥密文，再用同一把旧钥跑会全部解密失败被跳过
 *    （安全但数字难看）。要重跑必须先确认库里到底是什么钥加密的。
 *
 * ## 换钥完整流程（缺一不可）
 *
 *  1. 备份旧钥与数据库；2. 改 `.env` 的 `PATIENT_FIELD_KEY` 为新钥；
 *  3. **重启后端**（密钥只在进程启动时读入，未重启的进程仍用旧钥写入，会造成新旧密文混杂）；
 *  4. 用 `PATIENT_FIELD_KEY_OLD` 跑本脚本 `--apply`；5. 只读复核往返解密与姓名等值查询；
 *  6. 清除 `PATIENT_FIELD_KEY_OLD`，按密钥保管要求处置旧钥。
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
  cipherSchemeOf,
  decryptWithKey,
  encryptWithKey,
  isFieldCryptoConfigured,
  keyFingerprint,
} from '../src/common/crypto/field-crypto';

const prisma = new PrismaClient();

/** 每页处理行数：分页游标避免一次性把全表读进内存 */
const PAGE_SIZE = 500;

/** 本次运行使用的密钥对 */
interface KeyPair {
  /** 解密用密钥：re-key 模式下是旧钥，方案迁移模式下与新钥相同 */
  decryptKey: string;
  /** 加密用密钥：始终是 `PATIENT_FIELD_KEY` */
  encryptKey: string;
  /** 是否为换密钥模式 */
  rekey: boolean;
}

interface Stats {
  scanned: number;
  updated: number;
  unchanged: number;
  /** 解密失败而跳过的字段数（历史 HMAC 不可逆，或密钥与密文不匹配） */
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
  keys: KeyPair,
): string | null {
  bump(stats[bucket], cipherSchemeOf(stored));
  if (stored === null) {
    return null;
  }
  // legacy（enc:<base64>）与 hmac 前缀不需要密钥，decryptWithKey 内部按前缀分流，
  // 因此 re-key 过程中混有历史方案的行也能被正确升级或跳过。
  const plain = decryptWithKey(stored, keys.decryptKey);
  if (plain === null) {
    // 不可逆的历史 HMAC 密文、或密钥不匹配：跳过，保留原值等人工处理
    stats.skippedUndecryptable += 1;
    return null;
  }
  const next = encryptWithKey(plain, keys.encryptKey);
  return next === stored ? null : next;
}

async function reencryptPatients(stats: Stats, apply: boolean, keys: KeyPair): Promise<void> {
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
      const nameCipher = reencrypt(row.nameCipher, stats, 'before', keys);
      const idCardCipher = reencrypt(row.idCardCipher, stats, 'before', keys);
      const phoneCipher = reencrypt(row.phoneCipher, stats, 'before', keys);

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

async function reencryptUsers(stats: Stats, apply: boolean, keys: KeyPair): Promise<void> {
  const rows = await prisma.user.findMany({
    select: { id: true, phoneCipher: true },
    orderBy: { id: 'asc' },
  });

  const updates: Array<Prisma.PrismaPromise<unknown>> = [];
  for (const row of rows) {
    stats.scanned += 1;
    const phoneCipher = reencrypt(row.phoneCipher, stats, 'before', keys);
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

/**
 * 解析本次运行的密钥对。
 * @returns 解析失败时返回 null（已打印原因）
 */
function resolveKeys(): KeyPair | null {
  const encryptKey = process.env.PATIENT_FIELD_KEY ?? '';
  if (!isFieldCryptoConfigured()) {
    console.error(
      '[reencrypt] ✗ 未配置 PATIENT_FIELD_KEY，拒绝执行。\n' +
        '  没有密钥时加密函数会退回 base64，跑一遍只是空转并报"成功"，掩盖真实问题。\n' +
        '  请先在 apps/server/.env 配置密钥（≥32 位随机串），再重跑本脚本。',
    );
    return null;
  }

  const oldKey = (process.env.PATIENT_FIELD_KEY_OLD ?? '').trim();
  if (oldKey === '') {
    return { decryptKey: encryptKey, encryptKey, rekey: false };
  }

  if (oldKey === encryptKey) {
    console.error(
      '[reencrypt] ✗ PATIENT_FIELD_KEY_OLD 与 PATIENT_FIELD_KEY 相同，这不是换密钥。\n' +
        '  若只想做方案迁移，请清除 PATIENT_FIELD_KEY_OLD 后重跑。',
    );
    return null;
  }

  return { decryptKey: oldKey, encryptKey, rekey: true };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const keys = resolveKeys();
  if (keys === null) {
    process.exitCode = 1;
    return;
  }

  // 运维脚本的进度输出一律走 console.warn：eslint 的 no-console 只放行 warn/error，
  // 与 prisma/seed.ts 的既有约定一致（见 seed.ts 的完成提示）。
  console.warn(
    `[reencrypt] 模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（只统计，加 --apply 才写库）'}`,
  );
  // 只回显指纹，不回显密钥：换钥拿错钥会永久损毁存量密文，操作者必须能核对身份
  console.warn(
    `[reencrypt] 类型：${keys.rekey ? 'RE-KEY（换密钥）' : '方案迁移'}   ` +
      `解密钥指纹=${keyFingerprint(keys.decryptKey)}  加密钥指纹=${keyFingerprint(keys.encryptKey)}`,
  );

  const stats = emptyStats();
  await reencryptPatients(stats, apply, keys);
  await reencryptUsers(stats, apply, keys);

  console.warn('[reencrypt] 扫描行数        =', stats.scanned);
  console.warn('[reencrypt] 需重加密行数    =', stats.updated);
  console.warn('[reencrypt] 已是当前方案    =', stats.unchanged);
  console.warn('[reencrypt] 无法解密已跳过  =', stats.skippedUndecryptable);
  console.warn('[reencrypt] 迁移前字段分布  =', JSON.stringify(stats.before));
  console.warn('[reencrypt] 迁移后字段分布  =', JSON.stringify(stats.after));

  if (stats.skippedUndecryptable > 0) {
    console.warn(
      `[reencrypt] ⚠️ 有 ${stats.skippedUndecryptable} 个字段解密失败被跳过。可能原因：` +
        (keys.rekey
          ? '旧钥不对（或新旧钥写反）、该行已用新钥加密过（re-key 不幂等）、或历史 HMAC 密文不可逆。'
          : '历史 HMAC 密文不可逆，或密钥与密文不匹配。') +
        '这些行保留原密文，需人工确认处理方式，不要直接删除。',
    );
  }
  if (keys.rekey && apply && stats.updated > 0) {
    console.warn(
      '[reencrypt] ✓ 换密钥写库完成。请立刻：① 只读复核往返解密与姓名等值查询；' +
        '② 清除 PATIENT_FIELD_KEY_OLD；③ 确认后端已用新钥重启。',
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
