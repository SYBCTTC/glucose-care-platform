/**
 * 存量脱敏值重算：按 `@gc/shared` 的当前脱敏规则刷新 `Patient.*Masked`。
 *
 * 执行：
 *   pnpm db:remask            # 试运行，只统计不写库（默认）
 *   pnpm db:remask -- --apply # 真正写库
 *
 * 为什么需要这个脚本：`nameMasked` / `idCardMasked` / `phoneMasked` 是**落库字段**，
 * 不是读取时计算的。2026-11-17 把脱敏统一到 `@gc/shared`（原先 `field-crypto` 里另有一套
 * 同名但规则不同的副本），规则变了存量行就会与新写入的行格式不一致：
 *   idCardMasked  '110********12'（前3后2）  → '110***********4512'（前3后4）
 *   nameMasked    '张*丰'（保留首尾）        → '张**'（只保留姓）
 *   phoneMasked   11 位手机号两者一致，不受影响
 *
 * 安全约定（与 reencrypt-patient-fields.ts 一致）：
 *  - 默认试运行，必须显式 `--apply` 才写库；
 *  - 脱敏值一律由**密文解出的明文**重算，不从旧脱敏值反推（反推会继承旧规则的泄漏）；
 *  - 解密不出的行**跳过并计数**，绝不拿 null/空串覆盖原值；
 *  - 幂等：重算结果与库里相同则不写，可反复执行；
 *  - 游标分页 + 整页一个事务；
 *  - 不打印任何明文、密文或患者标识，只输出统计数字。
 */
import { maskIdCard, maskName, maskPhone } from '@gc/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import { decryptField, isFieldCryptoConfigured } from '../src/common/crypto/field-crypto';

const prisma = new PrismaClient();

/** 每页处理行数：分页游标避免一次性把全表读进内存 */
const PAGE_SIZE = 500;

/** 三个脱敏字段的统一处理表，避免复制三遍相同逻辑 */
const FIELDS = [
  { cipher: 'nameCipher', masked: 'nameMasked', mask: maskName, label: 'nameMasked' },
  { cipher: 'idCardCipher', masked: 'idCardMasked', mask: maskIdCard, label: 'idCardMasked' },
  { cipher: 'phoneCipher', masked: 'phoneMasked', mask: maskPhone, label: 'phoneMasked' },
] as const;

interface Stats {
  scanned: number;
  /** 有任一字段需要更新的行数 */
  updated: number;
  /** 全部字段都已是当前规则的行数 */
  unchanged: number;
  /** 按字段统计：值发生变化 */
  changedByField: Record<string, number>;
  /** 按字段统计：值已正确 */
  okByField: Record<string, number>;
  /** 按字段统计：密文为空（该字段本就无值） */
  nullByField: Record<string, number>;
  /** 按字段统计：密文无法解密而跳过 */
  skippedByField: Record<string, number>;
}

function emptyStats(): Stats {
  return {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    changedByField: {},
    okByField: {},
    nullByField: {},
    skippedByField: {},
  };
}

function bump(bucket: Record<string, number>, key: string): void {
  bucket[key] = (bucket[key] ?? 0) + 1;
}

type PatientRow = Prisma.PatientGetPayload<{
  select: {
    id: true;
    nameCipher: true;
    nameMasked: true;
    idCardCipher: true;
    idCardMasked: true;
    phoneCipher: true;
    phoneMasked: true;
  };
}>;

/**
 * 算出一行需要更新的脱敏字段。
 * @returns 待写入的 data 片段；无需变更时返回 null
 */
function remaskRow(row: PatientRow, stats: Stats): Record<string, string> | null {
  const data: Record<string, string> = {};

  for (const field of FIELDS) {
    const cipher = row[field.cipher];
    const current = row[field.masked];

    if (cipher === null) {
      // 该字段本就无值：脱敏值也应为空，不动它（置空属另一件事，不在本脚本职责内）
      bump(stats.nullByField, field.label);
      continue;
    }

    const plain = decryptField(cipher);
    if (plain === null) {
      // 历史 HMAC 密文不可逆、或密钥与密文不匹配：跳过，保留原脱敏值等人工处理
      bump(stats.skippedByField, field.label);
      continue;
    }

    const next = field.mask(plain);
    if (next === current) {
      bump(stats.okByField, field.label);
      continue;
    }
    bump(stats.changedByField, field.label);
    data[field.masked] = next;
  }

  return Object.keys(data).length === 0 ? null : data;
}

async function remaskPatients(stats: Stats, apply: boolean): Promise<void> {
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.patient.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      select: {
        id: true,
        nameCipher: true,
        nameMasked: true,
        idCardCipher: true,
        idCardMasked: true,
        phoneCipher: true,
        phoneMasked: true,
      },
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
      const data = remaskRow(row, stats);
      if (data === null) {
        stats.unchanged += 1;
        continue;
      }
      stats.updated += 1;
      if (apply) {
        updates.push(prisma.patient.update({ where: { id: row.id }, data }));
      }
    }

    if (updates.length > 0) {
      // 整页一个事务：中途失败不留半页新半页旧
      await prisma.$transaction(updates);
    }
  }
}

function formatBucket(bucket: Record<string, number>): string {
  const entries = Object.entries(bucket);
  return entries.length === 0
    ? '（无）'
    : entries.map(([key, value]) => `${key}=${value}`).join('  ');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // 运维脚本的进度输出一律走 console.warn：eslint 的 no-console 只放行 warn/error，
  // 与 prisma/seed.ts 的既有约定一致。
  console.warn(`[remask] 模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（只统计，加 --apply 才写库）'}`);
  if (!isFieldCryptoConfigured()) {
    console.warn(
      '[remask] ⚠️ 未配置 PATIENT_FIELD_KEY：base64 存量可正常处理，' +
        '但已用 AES 加密的行会解密失败被跳过（见下方统计）。',
    );
  }

  const stats = emptyStats();
  await remaskPatients(stats, apply);

  const skippedTotal = Object.values(stats.skippedByField).reduce((sum, n) => sum + n, 0);

  console.warn('[remask] 扫描患者行数      =', stats.scanned);
  console.warn('[remask] 需更新行数        =', stats.updated);
  console.warn('[remask] 已是当前规则行数  =', stats.unchanged);
  console.warn('[remask] 各字段需更新      =', formatBucket(stats.changedByField));
  console.warn('[remask] 各字段已正确      =', formatBucket(stats.okByField));
  console.warn('[remask] 各字段本就无值    =', formatBucket(stats.nullByField));
  console.warn('[remask] 各字段解密失败    =', formatBucket(stats.skippedByField));

  if (skippedTotal > 0) {
    console.warn(
      '[remask] ⚠️ 有字段解密失败被跳过（历史 HMAC 密文不可逆，或密钥与密文不匹配）。' +
        '这些行保留原脱敏值，需人工确认处理方式。',
    );
    if (!isFieldCryptoConfigured()) {
      // 没配密钥却出现解密失败，几乎必然是 AES 存量：此时结果不可信，必须报错而不是"成功"
      console.error(
        '[remask] ✗ 未配置 PATIENT_FIELD_KEY 且存在无法解密的行，结果不可信。\n' +
          '  请先在 apps/server/.env 配置密钥，再重跑本脚本。',
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!apply && stats.updated > 0) {
    console.warn('[remask] 试运行未写库。确认无误后执行：pnpm db:remask -- --apply');
  }
}

main()
  .catch((error: unknown) => {
    console.error('[remask] 执行失败', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
