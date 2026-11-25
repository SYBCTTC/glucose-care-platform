/**
 * 存量患者控糖目标回填。规格 `docs/specs/patient-glucose-target.md` 裁定 T / §12-②。
 *
 * 执行：
 *   pnpm db:backfill-targets            # 试运行，只统计不写库（默认）
 *   pnpm db:backfill-targets -- --apply # 真正写库
 *
 * 为什么是独立脚本而不写进迁移 SQL（仓库有 `20261120000000_add_admission_records`
 * 迁移内回填的先例）：
 *  1. 可先试运行看规模再决定写不写 —— 医疗数据，批量写入前需人工确认；
 *  2. 可重跑（幂等），而迁移只能执行一次；
 *  3. 与建表解耦：回填失败不会连带回滚表结构。
 *
 * 安全约定（与 `remask-patient-fields.ts` / `reencrypt-patient-fields.ts` 一致）：
 *  - 默认试运行，必须显式 `--apply` 才写库；
 *  - **只补缺行，绝不改已有行**：快照语义（裁定 G）下医护可能已调过个别患者的目标，
 *    回填把它们冲回默认值等于静默篡改临床配置，比缺行危险得多；
 *  - 幂等：先查已有 code 再算缺失，写入用 `skipDuplicates`，重跑不产生重复行；
 *  - 游标分页 + 整页一个事务；
 *  - 不打印任何患者标识（ID/姓名/住院号），只输出统计数字。
 *
 * 回填范围：**未归档**患者（`archivedAt IS NULL`），含在院与出院。
 *  - 归档 = 病历封存，不再写入新数据（与 `AGENTS.md` §5.3 的删除口径一致）；
 *  - 出院患者纳入是因为可能重新办理入院（`patient:admit`），届时需要目标行；
 *  - 试运行会分类输出规模，确认后再 `--apply`。
 */
import { PATIENT_STATUS, TIME_SLOT_CATEGORY } from '@gc/shared';
import { Prisma, PrismaClient } from '@prisma/client';
import { SYSTEM_CONFIG_KEY } from '../src/modules/system/system-config.service';

const prisma = new PrismaClient();

/** 每页处理行数：游标分页避免一次性把全表读进内存 */
const PAGE_SIZE = 500;

/** 展示集合的一行（R1 口径，与后端 `loadDisplaySet` 一致） */
interface DisplaySlot {
  code: string;
  valueDown: Prisma.Decimal;
  valueUp: Prisma.Decimal;
}

interface Stats {
  /** 扫描到的未归档患者数 */
  scanned: number;
  inpatient: number;
  discharged: number;
  /** 至少缺一个时段目标行的患者数 */
  patientsNeedTargets: number;
  /** 展示集合内目标行已齐全的患者数 */
  patientsFull: number;
  /** 将新建的时段目标行总数 */
  targetRows: number;
  /** 将新建的预警行数 */
  alertCreated: number;
  /** 已有预警行（不动） */
  alertExisting: number;
  /** 因全局阈值缺失而无法回填预警行 */
  alertSkipped: number;
}

function emptyStats(): Stats {
  return {
    scanned: 0,
    inpatient: 0,
    discharged: 0,
    patientsNeedTargets: 0,
    patientsFull: 0,
    targetRows: 0,
    alertCreated: 0,
    alertExisting: 0,
    alertSkipped: 0,
  };
}

/**
 * 展示集合：`enabled && type === 普通 && valueDown/valueUp 均非空`，按 sortOrder 升序。
 *
 * 与后端 `PatientGlucoseTargetService.loadDisplaySet()` 同一口径（R1 / 裁定 U）：
 * 动态查库，**不硬编码 code 白名单**（`AGENTS.md` §4.4，code 才是契约、名称可改）。
 * 两处若漂移会导致「回填的行前端不展示」，改口径时必须同步。
 */
async function loadDisplaySet(): Promise<DisplaySlot[]> {
  const rows = await prisma.timeSlot.findMany({
    where: {
      enabled: true,
      type: TIME_SLOT_CATEGORY.NORMAL,
      valueDown: { not: null },
      valueUp: { not: null },
    },
    select: { code: true, valueDown: true, valueUp: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  // where 已排除 null，但 Prisma 的静态类型仍是 Decimal | null，故再过滤一次让类型收窄
  return rows.flatMap((row) =>
    row.valueDown !== null && row.valueUp !== null
      ? [{ code: row.code, valueDown: row.valueDown, valueUp: row.valueUp }]
      : [],
  );
}

/**
 * 全局预警阈值。缺失/非法/自相矛盾时返回 null 而**不退出**：
 * 时段目标行仍可从 `TimeSlot` 回填，只有预警行跳过并计数。
 * 与 `SystemConfigService` 抛 10000 的口径不同 —— 那是录入血糖的硬依赖，
 * 这里只是补默认值，缺了不该让整个回填停摆（同裁定 Q 的「不阻断」精神）。
 */
async function loadGlobalThreshold(): Promise<{
  low: Prisma.Decimal;
  high: Prisma.Decimal;
} | null> {
  const rows = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD, SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD],
      },
    },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const low = Number(values.get(SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD));
  const high = Number(values.get(SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
    return null;
  }
  return { low: new Prisma.Decimal(low.toFixed(1)), high: new Prisma.Decimal(high.toFixed(1)) };
}

async function backfill(
  stats: Stats,
  displaySet: DisplaySlot[],
  threshold: { low: Prisma.Decimal; high: Prisma.Decimal } | null,
  apply: boolean,
): Promise<void> {
  let cursor: string | undefined;

  for (;;) {
    const patients = await prisma.patient.findMany({
      take: PAGE_SIZE,
      ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
      where: { archivedAt: null },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    });
    if (patients.length === 0) {
      return;
    }
    cursor = patients[patients.length - 1].id;

    // 整页批量查已有行，避免「每患者一次查询」的 N+1（500 患者 × 2 表 = 1000 次查询）
    const ids = patients.map((patient) => patient.id);
    const [existingTargets, existingAlerts] = await Promise.all([
      prisma.patientGlucoseTarget.findMany({
        where: { patientId: { in: ids } },
        select: { patientId: true, timeSlotCode: true },
      }),
      prisma.patientAlertThreshold.findMany({
        where: { patientId: { in: ids } },
        select: { patientId: true },
      }),
    ]);

    const haveByPatient = new Map<string, Set<string>>();
    for (const row of existingTargets) {
      const codes = haveByPatient.get(row.patientId);
      if (codes) {
        codes.add(row.timeSlotCode);
      } else {
        haveByPatient.set(row.patientId, new Set([row.timeSlotCode]));
      }
    }
    const alertPatients = new Set(existingAlerts.map((row) => row.patientId));

    const targetRows: Array<{
      patientId: string;
      timeSlotCode: string;
      valueDown: Prisma.Decimal;
      valueUp: Prisma.Decimal;
    }> = [];
    const alertRows: Array<{
      patientId: string;
      lowThreshold: Prisma.Decimal;
      highThreshold: Prisma.Decimal;
    }> = [];

    for (const patient of patients) {
      stats.scanned += 1;
      if (patient.status === PATIENT_STATUS.INPATIENT) {
        stats.inpatient += 1;
      } else if (patient.status === PATIENT_STATUS.DISCHARGED) {
        stats.discharged += 1;
      }

      const have = haveByPatient.get(patient.id);
      const missing = displaySet.filter((slot) => !have?.has(slot.code));
      if (missing.length > 0) {
        stats.patientsNeedTargets += 1;
        stats.targetRows += missing.length;
        for (const slot of missing) {
          targetRows.push({
            patientId: patient.id,
            timeSlotCode: slot.code,
            valueDown: slot.valueDown,
            valueUp: slot.valueUp,
          });
        }
      } else {
        stats.patientsFull += 1;
      }

      if (alertPatients.has(patient.id)) {
        stats.alertExisting += 1;
      } else if (threshold === null) {
        stats.alertSkipped += 1;
      } else {
        stats.alertCreated += 1;
        alertRows.push({
          patientId: patient.id,
          lowThreshold: threshold.low,
          highThreshold: threshold.high,
        });
      }
    }

    if (apply) {
      // $transaction 只接受 PrismaPromise（带 Symbol.toStringTag 标记），普通 Promise 会类型不匹配
      const writes: Array<Prisma.PrismaPromise<unknown>> = [];
      if (targetRows.length > 0) {
        // skipDuplicates：与并发建档或重跑撞 (patientId, timeSlotCode) 唯一索引时不报错
        writes.push(
          prisma.patientGlucoseTarget.createMany({ data: targetRows, skipDuplicates: true }),
        );
      }
      if (alertRows.length > 0) {
        writes.push(
          prisma.patientAlertThreshold.createMany({ data: alertRows, skipDuplicates: true }),
        );
      }
      if (writes.length > 0) {
        // 整页一个事务：中途失败不留「半页有目标、半页没有」
        await prisma.$transaction(writes);
      }
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // 运维脚本的进度输出一律走 console.warn：eslint 的 no-console 只放行 warn/error，
  // 与 prisma/seed.ts、remask-patient-fields.ts 的既有约定一致。
  console.warn(
    `[backfill-targets] 模式：${apply ? 'APPLY（写库）' : 'DRY-RUN（只统计，加 --apply 才写库）'}`,
  );

  const displaySet = await loadDisplaySet();
  if (displaySet.length === 0) {
    // 展示集合为空说明 TimeSlot 配置异常（没有 enabled 的普通时段带阈值）。
    // 此时继续跑只会给每个患者补一行预警值，目标行全缺，结果没有意义 —— 直接失败。
    console.error(
      '[backfill-targets] ✗ 展示集合为空：TimeSlot 里没有「启用 + 普通 + 带上下限」的时段。\n' +
        '  请先检查时段配置（pnpm db:seed 可灌入默认时段），再重跑本脚本。',
    );
    process.exitCode = 1;
    return;
  }

  const threshold = await loadGlobalThreshold();
  if (threshold === null) {
    console.warn(
      '[backfill-targets] ⚠️ 全局预警阈值缺失或非法（SystemConfig 的 ' +
        `${SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD} / ${SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD}）：` +
        '时段目标行照常回填，预警行将全部跳过并计数。',
    );
  }

  const archived = await prisma.patient.count({ where: { archivedAt: { not: null } } });

  console.warn(
    `[backfill-targets] 展示集合时段数 = ${displaySet.length}（${displaySet
      .map((slot) => slot.code)
      .join(', ')}）`,
  );

  const stats = emptyStats();
  await backfill(stats, displaySet, threshold, apply);

  console.warn('[backfill-targets] 已归档患者（跳过）  =', archived);
  console.warn('[backfill-targets] 扫描未归档患者      =', stats.scanned);
  console.warn(
    '[backfill-targets]   在院 / 出院       =',
    `${stats.inpatient} / ${stats.discharged}`,
  );
  console.warn('[backfill-targets] 需补目标行的患者    =', stats.patientsNeedTargets);
  console.warn('[backfill-targets] 目标行已齐全的患者  =', stats.patientsFull);
  console.warn('[backfill-targets] 时段目标行新建数    =', stats.targetRows);
  console.warn('[backfill-targets] 预警行新建数        =', stats.alertCreated);
  console.warn('[backfill-targets] 预警行已存在（不动）=', stats.alertExisting);
  console.warn('[backfill-targets] 预警行跳过（无全局）=', stats.alertSkipped);

  if (!apply && (stats.targetRows > 0 || stats.alertCreated > 0)) {
    console.warn(
      '[backfill-targets] 试运行未写库。确认上述规模无误后执行：pnpm db:backfill-targets -- --apply',
    );
  }
  if (apply) {
    console.warn('[backfill-targets] 已写库。本脚本幂等，重跑只补新缺的行、不改已有行。');
  }
}

main()
  .catch((error: unknown) => {
    console.error('[backfill-targets] 执行失败', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
