import { formatDateTime, GLUCOSE_ALERT_RESULT_CODES, PATIENT_STATUS } from '@gc/shared';
import type { GlucoseAlertQuery } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptDeterministic } from '../../common/crypto/field-crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import type { PatientGlucoseTargetService } from '../patient/patient-glucose-target.service';
import { GlucoseAlertService } from './glucose-alert.service';

/**
 * P4-7 预警列表 service 单测（docs/specs/glucose-alerts.md §12 后端项）。
 *
 * 钉住的口径：
 *  - 预警 = 落库 resultType（'2' 高 / '0' 低，裁定 R1-Q1），查询不重判；
 *  - 作废记录一律排除（voidedAt: null，AGENTS.md §5.2 读路径铁律）；
 *  - 数据范围经 buildScopeWhere(PATIENT) 收敛，科室档只见本科室；
 *  - valueGt/valueLt AND 叠加（裁定 R1-Q2），gt ≥ lt 不强拦（裁定 R2-Q4）；
 *  - 统计随全部筛选、不受分页影响（裁定 R2-Q1）；patientCount 去重；
 *  - type 指定时另一侧计数恒 0 且**不发无谓 count 查询**；
 *  - 控糖范围批量解析（一次 IN + 全局一次），禁止 N+1；
 *  - 姓名筛选走确定性密文等值；响应 name 恒为 nameMasked。
 */

/** 本科室护士：数据范围 DEPARTMENT */
const deptUser = {
  userId: 'u-nurse',
  username: 'nurse.li',
  displayName: '李护士',
  departmentId: 'd-endo',
  permissions: [],
  roles: ['NURSE'],
  dataScope: 'DEPARTMENT',
} as unknown as AuthenticatedUser;

/** 系统管理员：数据范围全院 */
const allUser = { ...deptUser, dataScope: 'ALL' } as unknown as AuthenticatedUser;

const START = new Date(2026, 10, 1, 0, 0, 0);
const END = new Date(2026, 10, 27, 23, 59, 59);

function baseQuery(overrides: Partial<GlucoseAlertQuery> = {}): GlucoseAlertQuery {
  return {
    admissionStatus: 'inpatient',
    startTime: START,
    endTime: END,
    page: 1,
    pageSize: 20,
    ...overrides,
  } as GlucoseAlertQuery;
}

/** findMany 主查询返回的行（与 controller select 同形） */
function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'g-1',
    patientId: 'p-1',
    resultType: '2',
    valueMmolL: new Prisma.Decimal('18.2'),
    measuredAt: new Date(2026, 10, 20, 10, 30, 0),
    mealContext: 'FASTING',
    patient: {
      patientNo: 'P2026000004',
      nameMasked: '张**',
      gender: 'MALE',
      bedNo: '12-01',
      department: { name: '内分泌科' },
      doctor: { name: '王医生' },
      nurse: { name: '李护士' },
    },
    ...overrides,
  };
}

function createService() {
  const prisma = {
    glucoseRecord: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
  const targets = {
    resolveResultTypeThresholdsBatch: vi.fn().mockResolvedValue({
      byPatientSlot: new Map<string, { low: number; high: number }>(),
      global: { low: 3.9, high: 16.7 },
    }),
  };
  const service = new GlucoseAlertService(
    prisma as unknown as PrismaService,
    targets as unknown as PatientGlucoseTargetService,
  );
  return { service, prisma, targets };
}

type Ctx = ReturnType<typeof createService>;
let ctx: Ctx;
let service: Ctx['service'];
let prisma: Ctx['prisma'];
let targets: Ctx['targets'];

beforeEach(() => {
  ctx = createService();
  ({ service, prisma, targets } = ctx);
  // 主查询（无 distinct）返回记录行；去重患者数查询（distinct patientId）返回患者 ID 行
  prisma.glucoseRecord.findMany.mockImplementation(
    async (args: { distinct?: string[] } | undefined) =>
      args?.distinct ? [{ patientId: 'p-1' }, { patientId: 'p-2' }] : [recordRow()],
  );
  // count 按 where.resultType 分支：'2'→高 3 次、'0'→低 2 次、IN（所有预警）→总 5 次。
  // type 指定时 total 与对应侧计数同 where，mock 返回值天然自洽（total == highCount）。
  prisma.glucoseRecord.count.mockImplementation(
    async (args: { where?: { resultType?: unknown } }) => {
      const resultType = args?.where?.resultType;
      if (resultType === GLUCOSE_ALERT_RESULT_CODES.high) return 3;
      if (resultType === GLUCOSE_ALERT_RESULT_CODES.low) return 2;
      return 5;
    },
  );
});

/** 取主查询（非 distinct）的调用参数 */
function mainCallArgs() {
  const call = prisma.glucoseRecord.findMany.mock.calls.find(
    ([args]) => !(args as { distinct?: unknown }).distinct,
  );
  if (!call) {
    throw new Error('主查询（非 distinct findMany）未被调用');
  }
  return call[0] as {
    where: Record<string, unknown> & { patient: Record<string, unknown> };
    orderBy: unknown;
    skip: number;
    take: number;
  };
}

describe('GlucoseAlertService.list — where 口径', () => {
  it('默认（所有预警）：排除作废 + resultType IN (0,2) + measuredAt 闭区间', async () => {
    await service.list(deptUser, baseQuery());

    const { where } = mainCallArgs();
    expect(where.voidedAt).toBeNull();
    expect(where.resultType).toEqual({ in: ['2', '0'] });
    expect(where.measuredAt).toEqual({ gte: START, lte: END });
    expect(where.valueMmolL).toBeUndefined();
  });

  it("type='high' → resultType='2'；type='low' → resultType='0'（预警=落库结果类型，裁定 R1-Q1）", async () => {
    await service.list(deptUser, baseQuery({ type: 'high' }));
    expect(mainCallArgs().where.resultType).toBe('2');

    prisma.glucoseRecord.findMany.mockClear();
    await service.list(deptUser, baseQuery({ type: 'low' }));
    expect(mainCallArgs().where.resultType).toBe('0');
  });

  it('科室档用户：患者条件叠加 departmentId（buildScopeWhere 收敛）；全院档不叠加', async () => {
    await service.list(deptUser, baseQuery());
    expect(mainCallArgs().where.patient.departmentId).toBe('d-endo');

    prisma.glucoseRecord.findMany.mockClear();
    await service.list(allUser, baseQuery());
    expect(mainCallArgs().where.patient.departmentId).toBeUndefined();
  });

  it('住院状态：默认 inpatient → status=INPATIENT；discharged → DISCHARGED；all → 不加 status', async () => {
    await service.list(deptUser, baseQuery());
    expect(mainCallArgs().where.patient.status).toBe(PATIENT_STATUS.INPATIENT);

    prisma.glucoseRecord.findMany.mockClear();
    await service.list(deptUser, baseQuery({ admissionStatus: 'discharged' }));
    expect(mainCallArgs().where.patient.status).toBe(PATIENT_STATUS.DISCHARGED);

    prisma.glucoseRecord.findMany.mockClear();
    await service.list(deptUser, baseQuery({ admissionStatus: 'all' }));
    expect(mainCallArgs().where.patient.status).toBeUndefined();
  });

  it('科室/医生/住院号/床号筛选并入患者条件；住院号与床号模糊不区分大小写', async () => {
    await service.list(
      deptUser,
      baseQuery({ departmentId: 'd-cardio', doctorId: 'u-doc', patientNo: 'p2026', bedNo: '12-' }),
    );

    const { patient } = mainCallArgs().where;
    expect(patient.departmentId).toBe('d-cardio');
    expect(patient.doctorId).toBe('u-doc');
    expect(patient.patientNo).toEqual({ contains: 'p2026', mode: 'insensitive' });
    expect(patient.bedNo).toEqual({ contains: '12-', mode: 'insensitive' });
  });

  it('姓名筛选走确定性密文等值（同患者管理，密文不支持模糊）', async () => {
    await service.list(deptUser, baseQuery({ name: '张三' }));

    expect(mainCallArgs().where.patient.nameCipher).toBe(encryptDeterministic('张三'));
  });

  it('valueGt/valueLt AND 叠加为同一 valueMmolL 区间（裁定 R1-Q2）；只传一侧只加一侧', async () => {
    await service.list(deptUser, baseQuery({ valueGt: 3.9, valueLt: 16.7 }));
    expect(mainCallArgs().where.valueMmolL).toEqual({ gt: 3.9, lt: 16.7 });

    prisma.glucoseRecord.findMany.mockClear();
    await service.list(deptUser, baseQuery({ valueLt: 3.9 }));
    expect(mainCallArgs().where.valueMmolL).toEqual({ lt: 3.9 });
  });

  it('gt ≥ lt 不强拦（裁定 R2-Q4）：照常查询，允许空结果', async () => {
    prisma.glucoseRecord.findMany.mockImplementation(
      async (args: { distinct?: string[] } | undefined) => (args?.distinct ? [] : []),
    );
    prisma.glucoseRecord.count.mockResolvedValue(0);

    const result = await service.list(deptUser, baseQuery({ valueGt: 20, valueLt: 3.9 }));

    expect(mainCallArgs().where.valueMmolL).toEqual({ gt: 20, lt: 3.9 });
    expect(result.items).toEqual([]);
    expect(result.stats).toEqual({ patientCount: 0, totalCount: 0, highCount: 0, lowCount: 0 });
  });

  it('排序：检测时间倒序，同刻按 id 升序（翻页稳定）', async () => {
    await service.list(deptUser, baseQuery());

    expect(mainCallArgs().orderBy).toEqual([{ measuredAt: 'desc' }, { id: 'asc' }]);
  });

  it('分页：page=2 pageSize=10 → skip=10 take=10，响应回显 page/pageSize', async () => {
    const result = await service.list(deptUser, baseQuery({ page: 2, pageSize: 10 }));

    const args = mainCallArgs();
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });
});

describe('GlucoseAlertService.list — 统计（裁定 R2-Q1：随全部筛选、不受分页影响）', () => {
  it('所有预警：totalCount=全量 count，high/low 分别按 resultType 计数，patientCount 去重', async () => {
    const result = await service.list(deptUser, baseQuery());

    expect(result.stats).toEqual({ patientCount: 2, totalCount: 5, highCount: 3, lowCount: 2 });
    // 去重患者数：distinct patientId 查询行数即人数
    const distinctCall = prisma.glucoseRecord.findMany.mock.calls.find(
      ([args]) => (args as { distinct?: unknown }).distinct,
    );
    expect(distinctCall?.[0]).toMatchObject({
      select: { patientId: true },
      distinct: ['patientId'],
    });
  });

  it("type='high'：lowCount 恒 0 且不发 resultType='0' 的 count 查询（跳过无谓计数）", async () => {
    const result = await service.list(deptUser, baseQuery({ type: 'high' }));

    expect(result.stats).toEqual({ patientCount: 2, totalCount: 3, highCount: 3, lowCount: 0 });
    const countWheres = prisma.glucoseRecord.count.mock.calls.map(
      ([args]) => (args as { where: { resultType?: unknown } }).where.resultType,
    );
    expect(countWheres).not.toContain(GLUCOSE_ALERT_RESULT_CODES.low);
  });

  it("type='low'：highCount 恒 0 且不发 resultType='2' 的 count 查询", async () => {
    const result = await service.list(deptUser, baseQuery({ type: 'low' }));

    expect(result.stats).toEqual({ patientCount: 2, totalCount: 2, highCount: 0, lowCount: 2 });
    const countWheres = prisma.glucoseRecord.count.mock.calls.map(
      ([args]) => (args as { where: { resultType?: unknown } }).where.resultType,
    );
    expect(countWheres).not.toContain(GLUCOSE_ALERT_RESULT_CODES.high);
  });

  it('统计不受分页影响：page/pageSize 只作用于主查询 skip/take，count 与 distinct 用同一 where', async () => {
    await service.list(deptUser, baseQuery({ page: 3, pageSize: 10 }));

    const countArgs = prisma.glucoseRecord.count.mock.calls[0]?.[0] as { where: unknown };
    expect(countArgs.where).toEqual(mainCallArgs().where);
  });
});

describe('GlucoseAlertService.list — items 映射与控糖范围', () => {
  it("resultType '2'→high、'0'→low；Decimal 转 number；时间格式化；name 恒为脱敏文", async () => {
    prisma.glucoseRecord.findMany.mockImplementation(
      async (args: { distinct?: string[] } | undefined) =>
        args?.distinct
          ? [{ patientId: 'p-1' }]
          : [
              recordRow(),
              recordRow({
                id: 'g-2',
                patientId: 'p-2',
                resultType: '0',
                valueMmolL: new Prisma.Decimal('3.1'),
                mealContext: 'BEDTIME',
              }),
            ],
    );

    const result = await service.list(deptUser, baseQuery());

    expect(result.items[0]).toMatchObject({
      id: 'g-1',
      alertType: 'high',
      valueMmolL: 18.2,
      measuredAt: formatDateTime(new Date(2026, 10, 20, 10, 30, 0)),
      mealContext: 'FASTING',
      name: '张**',
      departmentName: '内分泌科',
      bedNo: '12-01',
      patientNo: 'P2026000004',
      gender: 'MALE',
      doctorName: '王医生',
      nurseName: '李护士',
    });
    expect(result.items[1]).toMatchObject({ alertType: 'low', valueMmolL: 3.1 });
    expect(typeof result.items[0].valueMmolL).toBe('number');
  });

  it('控糖范围批量解析：当页患者 ID 一次传入，禁止逐条 N+1', async () => {
    prisma.glucoseRecord.findMany.mockImplementation(
      async (args: { distinct?: string[] } | undefined) =>
        args?.distinct ? [] : [recordRow(), recordRow({ id: 'g-2', patientId: 'p-2' })],
    );

    await service.list(deptUser, baseQuery());

    expect(targets.resolveResultTypeThresholdsBatch).toHaveBeenCalledTimes(1);
    expect(targets.resolveResultTypeThresholdsBatch).toHaveBeenCalledWith(['p-1', 'p-2']);
  });

  it('targetRange：命中患者时段行用患者值，缺行回退全局，全局 null → targetRange null（前端显示 -）', async () => {
    prisma.glucoseRecord.findMany.mockImplementation(
      async (args: { distinct?: string[] } | undefined) =>
        args?.distinct
          ? []
          : [
              recordRow(),
              recordRow({ id: 'g-2', patientId: 'p-2', mealContext: 'BEDTIME' }),
              recordRow({ id: 'g-3', patientId: 'p-3', mealContext: 'RANDOM' }),
            ],
    );
    targets.resolveResultTypeThresholdsBatch.mockResolvedValue({
      byPatientSlot: new Map([['p-1|FASTING', { low: 4.4, high: 7.0 }]]),
      global: { low: 3.9, high: 16.7 },
    });

    const result = await service.list(deptUser, baseQuery());

    expect(result.items[0].targetRange).toEqual({ low: 4.4, high: 7.0 });
    expect(result.items[1].targetRange).toEqual({ low: 3.9, high: 16.7 });
    expect(result.items[2].targetRange).toEqual({ low: 3.9, high: 16.7 });
  });

  it('全局解析失败（global=null）且无患者行 → targetRange 为 null，查询不抛', async () => {
    targets.resolveResultTypeThresholdsBatch.mockResolvedValue({
      byPatientSlot: new Map(),
      global: null,
    });

    const result = await service.list(deptUser, baseQuery());

    expect(result.items[0].targetRange).toBeNull();
    expect(result.total).toBe(5);
  });

  it('mealContext 为 null 的历史行：按 `patientId|` 空串键查 Map，不命中即回退全局', async () => {
    targets.resolveResultTypeThresholdsBatch.mockResolvedValue({
      byPatientSlot: new Map([['p-1|', { low: 5.0, high: 9.0 }]]),
      global: null,
    });

    const result = await service.list(deptUser, baseQuery());
    // 默认行 mealContext='FASTING' 不命中 'p-1|' → 回退 global(null)
    expect(result.items[0].targetRange).toBeNull();

    prisma.glucoseRecord.findMany.mockImplementation(
      async (args: { distinct?: string[] } | undefined) =>
        args?.distinct ? [] : [recordRow({ mealContext: null })],
    );
    const nullSlot = await service.list(deptUser, baseQuery());
    expect(nullSlot.items[0].targetRange).toEqual({ low: 5.0, high: 9.0 });
  });
});

describe('GlucoseAlertService.list — 审计回显字段（AUDIT_DETAIL_ALLOW_LIST 白名单）', () => {
  it('rangeFrom/rangeTo = 查询区间本地格式化；count = 当页行数；alertType = type ?? all', async () => {
    const result = await service.list(deptUser, baseQuery({ type: 'high' }));

    expect(result.rangeFrom).toBe(formatDateTime(START));
    expect(result.rangeTo).toBe(formatDateTime(END));
    expect(result.count).toBe(1);
    expect(result.alertType).toBe('high');
  });

  it('未指定 type → alertType 回显 all', async () => {
    const result = await service.list(deptUser, baseQuery());

    expect(result.alertType).toBe('all');
  });
});
