import { Logger } from '@nestjs/common';
import { ERROR_CODES, GENDER, PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type { UpdatePatientInput } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptField } from '../../common/crypto/field-crypto';
import type { AuthenticatedUser } from '../../common/types';
import { PatientService } from './patient.service';

// R28 namePlain：decryptField 真实实现依赖 PATIENT_FIELD_KEY（测试环境未配置，恒返回 null），
// mock 掉以控制解密结果；encryptDeterministic 等其余导出保留真实实现（create/update 用例在用）。
vi.mock('../../common/crypto/field-crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../common/crypto/field-crypto')>();
  return { ...actual, decryptField: vi.fn() };
});

const PATIENT_ID = 'p-0001';

/** 护理人员：数据范围限定本科室，用来验证越权拦截 */
const deptUser = {
  userId: 'u-nurse',
  username: 'nurse.li',
  displayName: '李护士',
  departmentId: 'd-endo',
  departmentName: '内分泌科',
  permissions: [PERMISSION.PATIENT_UPDATE],
  roles: ['NURSE'],
  dataScope: 'DEPARTMENT',
} as unknown as AuthenticatedUser;

/** 系统管理员：数据范围全院 */
const allUser = { ...deptUser, dataScope: 'ALL' } as unknown as AuthenticatedUser;

/**
 * update() 里读的 existing 行。
 * 默认值与 baseInput() 完全一致，保证「不改任何字段」时 changedFields 为空。
 */
function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    status: PATIENT_STATUS.INPATIENT,
    archivedAt: null,
    departmentId: 'd-endo',
    nameCipher: 'cipher-name-old',
    idCardCipher: 'cipher-id-old',
    phoneCipher: 'cipher-phone-old',
    gender: GENDER.MALE,
    birthDate: new Date('1976-10-23T00:00:00.000Z'),
    bedNo: '15-01',
    doctorId: 'doc-1',
    nurseId: null,
    diabetesType: 'TYPE_2',
    hba1c: new Prisma.Decimal('7.5'),
    ...overrides,
  };
}

/** PATIENT_PUBLIC_SELECT 形状的行，供 toListItem() 组装返回值 */
function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PATIENT_ID,
    // fixture 用当前脱敏规则的形状（只保留姓氏），避免误导后来人以为还保留末字
    nameMasked: '张**',
    patientNo: 'H-0001',
    gender: GENDER.MALE,
    birthDate: new Date('1976-10-23T00:00:00.000Z'),
    bedNo: '15-01',
    departmentId: 'd-endo',
    department: { name: '内分泌科' },
    doctorId: 'doc-1',
    doctor: { name: '王医生' },
    status: PATIENT_STATUS.INPATIENT,
    admissionAt: new Date('2026-10-01T02:00:00.000Z'),
    dischargeAt: null,
    archivedAt: null,
    glucoseRecords: [],
    // toListItem 会读 virtualWardRecords 判定 inVirtualWard，mock 行须与 PATIENT_PUBLIC_SELECT 同形
    virtualWardRecords: [],
    ...overrides,
  };
}

/** 与 existingRow() 对齐的默认请求体：默认不产生任何变更 */
function baseInput(overrides: Partial<UpdatePatientInput> = {}): UpdatePatientInput {
  return {
    gender: GENDER.MALE,
    birthDate: new Date('1976-10-23T00:00:00.000Z'),
    departmentId: 'd-endo',
    bedNo: '15-01',
    doctorId: 'doc-1',
    nurseId: null,
    diabetesType: 'TYPE_2',
    hba1c: 7.5,
    ...overrides,
  };
}

function createService() {
  const prisma = {
    patient: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    // R24：住院记录 / 科室停留（建档与办理住院双写、admissions 树查询）
    admission: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    admissionDepartment: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  // 交互式事务：回调直接拿同一套 mock（tx 与 client 同接口），断言方式不变
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.resolve(arg),
  );
  // 第二个依赖是控糖目标 service（建档后写快照，规格 R9）。默认给一个不抛错的桩：
  // 快照自身的逻辑（展示集合过滤、SystemConfig 缺失不阻断）在
  // patient-glucose-target.service.spec.ts 覆盖，本文件只验证**调用时机**与
  // 「快照失败不阻断建档」（后者在用例内用 mockRejectedValueOnce 临时翻成抛错）。
  const glucoseTargets = { initSnapshot: vi.fn().mockResolvedValue(undefined) };
  const service = new PatientService(prisma as never, glucoseTargets as never);
  return { service, prisma, glucoseTargets };
}

describe('PatientService.update — 状态与存在性', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.user.findFirst.mockResolvedValue({ id: 'doc-1' });
    prisma.patient.update.mockResolvedValue(publicRow());
    prisma.patient.findUniqueOrThrow.mockResolvedValue(publicRow());
  });

  it('出院患者拒绝编辑，且不写库', async () => {
    prisma.patient.findUnique.mockResolvedValue(existingRow({ status: PATIENT_STATUS.DISCHARGED }));

    await expect(
      service.update(allUser, PATIENT_ID, baseInput({ bedNo: '15-02' })),
    ).rejects.toMatchObject({ code: ERROR_CODES.PATIENT_INVALID_STATE });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('患者不存在按 40001 处理，不泄露存在性', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);

    await expect(service.update(allUser, PATIENT_ID, baseInput())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('已归档患者按 40001 处理', async () => {
    prisma.patient.findUnique.mockResolvedValue(
      existingRow({ archivedAt: new Date('2026-10-20T00:00:00.000Z') }),
    );

    await expect(service.update(allUser, PATIENT_ID, baseInput())).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });
});

describe('PatientService.update — 数据权限', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.user.findFirst.mockResolvedValue({ id: 'doc-1' });
    prisma.patient.update.mockResolvedValue(publicRow());
  });

  it('患者当前科室不在数据范围内 → 30002', async () => {
    prisma.patient.findUnique.mockResolvedValue(existingRow({ departmentId: 'd-cardio' }));

    await expect(service.update(deptUser, PATIENT_ID, baseInput())).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('把患者改到无权科室也要拦下（双重判权）', async () => {
    prisma.patient.findUnique.mockResolvedValue(existingRow());

    await expect(
      service.update(deptUser, PATIENT_ID, baseInput({ departmentId: 'd-cardio' })),
    ).rejects.toMatchObject({ code: ERROR_CODES.CROSS_DEPARTMENT_DENIED });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('责任医生不属于所选科室 → 字段级校验错误定位到 doctorId', async () => {
    prisma.patient.findUnique.mockResolvedValue(existingRow());
    prisma.user.findFirst.mockResolvedValue(null);

    const error = await service
      .update(allUser, PATIENT_ID, baseInput({ bedNo: '15-02' }))
      .catch((caught) => caught);

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((error.getResponse() as { details?: unknown }).details).toEqual([
      { field: 'doctorId', message: '责任医生不属于所选科室' },
    ]);
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('责任护士不属于所选科室 → 字段级校验错误定位到 nurseId', async () => {
    prisma.patient.findUnique.mockResolvedValue(existingRow());
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'doc-1' }).mockResolvedValueOnce(null);

    const error = await service
      .update(allUser, PATIENT_ID, baseInput({ nurseId: 'nurse-x', bedNo: '15-02' }))
      .catch((caught) => caught);

    expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((error.getResponse() as { details?: unknown }).details).toEqual([
      { field: 'nurseId', message: '责任护士不属于所选科室' },
    ]);
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });
});

describe('PatientService.update — 变更集语义', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue(existingRow());
    prisma.user.findFirst.mockResolvedValue({ id: 'doc-1' });
    prisma.patient.update.mockResolvedValue(publicRow({ bedNo: '15-02' }));
    prisma.patient.findUniqueOrThrow.mockResolvedValue(publicRow());
  });

  it('敏感字段省略即不修改：请求里不出现 name/idCard/phone 时保留原密文', async () => {
    const result = await service.update(allUser, PATIENT_ID, baseInput({ bedNo: '15-02' }));

    expect(result.changedFields).toEqual(['bedNo']);
    const data = prisma.patient.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('nameCipher');
    expect(data).not.toHaveProperty('idCardCipher');
    expect(data).not.toHaveProperty('phoneCipher');
  });

  it('显式传 null 表示清除：密文与脱敏值一起置空', async () => {
    const result = await service.update(allUser, PATIENT_ID, baseInput({ idCard: null }));

    expect(result.changedFields).toEqual(['idCard']);
    const data = prisma.patient.update.mock.calls[0][0].data;
    expect(data.idCardCipher).toBeNull();
    expect(data.idCardMasked).toBeNull();
  });

  it('改名后密文重新计算且脱敏值同步更新', async () => {
    const result = await service.update(allUser, PATIENT_ID, baseInput({ name: '张三丰' }));

    expect(result.changedFields).toEqual(['name']);
    const data = prisma.patient.update.mock.calls[0][0].data;
    expect(data.nameCipher).toBeTypeOf('string');
    expect(data.nameCipher).not.toBe('cipher-name-old');
    // 脱敏统一走 @gc/shared：只保留姓氏，不保留末字（原 field-crypto 副本是 '张*丰'，
    // 三字名只遮一个字，配合科室/床号足以反推身份）
    expect(data.nameMasked).toBe('张**');
  });

  it('完全无变更时返回空 changedFields，且不发起写库', async () => {
    const result = await service.update(allUser, PATIENT_ID, baseInput());

    expect(result.changedFields).toEqual([]);
    expect(prisma.patient.update).not.toHaveBeenCalled();
    expect(prisma.patient.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it('hba1c 按一位小数写入 Decimal，避免浮点误差', async () => {
    await service.update(allUser, PATIENT_ID, baseInput({ hba1c: 8.2 }));

    const data = prisma.patient.update.mock.calls[0][0].data;
    expect(data.hba1c).toBeInstanceOf(Prisma.Decimal);
    expect(Number(data.hba1c)).toBe(8.2);
  });
});

describe('PatientService.detail', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue(
      publicRow({
        idCardMasked: '110********01',
        phoneMasked: '138****1234',
        remark: null,
        nurseId: 'nurse-1',
        nurse: { name: '赵护士' },
        diabetesType: 'TYPE_2',
        hba1c: new Prisma.Decimal('7.5'),
        bindings: [],
      }),
    );
  });

  it('跨科室查看详情 → 30002', async () => {
    prisma.patient.findUnique.mockResolvedValue(publicRow({ departmentId: 'd-cardio' }));

    await expect(service.detail(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
  });

  it('详情只出脱敏值，不返回任何明文字段', async () => {
    const detail = await service.detail(deptUser, PATIENT_ID);

    expect(detail.nameMasked).toBe('张**');
    expect(detail.idCardMasked).toBe('110********01');
    expect(detail.phoneMasked).toBe('138****1234');
    expect(detail.nurseId).toBe('nurse-1');
    expect(detail.nurseName).toBe('赵护士');
    expect(detail.hba1c).toBe(7.5);
    // 明文列在 select 里就没有，这里断言 key 不存在，防止将来误加
    expect(detail).not.toHaveProperty('name');
    expect(detail).not.toHaveProperty('idCard');
    expect(detail).not.toHaveProperty('phone');
  });

  it('无责任护士时 nurseName 为 null（nurse 关系缺失不报错）', async () => {
    prisma.patient.findUnique.mockResolvedValue(
      publicRow({
        idCardMasked: '110********01',
        phoneMasked: '138****1234',
        remark: null,
        nurseId: null,
        nurse: null,
        diabetesType: null,
        hba1c: null,
        bindings: [],
      }),
    );

    const detail = await service.detail(deptUser, PATIENT_ID);

    expect(detail.nurseId).toBeNull();
    expect(detail.nurseName).toBeNull();
  });
});

describe('PatientService.namePlain — R28 明文姓名（打印头）', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue({
      nameCipher: 'cipher-name',
      departmentId: 'd-endo',
      archivedAt: null,
    });
    // spy 调用记录跨用例累计（vitest 未开 clearMocks），先清再设返回值，
    // 否则「越权不解密」用例的 not.toHaveBeenCalled 会被前面用例的调用污染
    vi.mocked(decryptField).mockReset();
    vi.mocked(decryptField).mockReturnValue('张三分');
  });

  it('本科室 → 返回解密后的明文姓名', async () => {
    await expect(service.namePlain(deptUser, PATIENT_ID)).resolves.toEqual({ name: '张三分' });
    expect(decryptField).toHaveBeenCalledWith('cipher-name');
  });

  it('解密失败（历史不可逆密文）→ name 为 null，不抛错（前端回退 nameMasked）', async () => {
    vi.mocked(decryptField).mockReturnValue(null);

    await expect(service.namePlain(deptUser, PATIENT_ID)).resolves.toEqual({ name: null });
  });

  it('跨科室 → 30002，且不解密（先鉴权后碰密文）', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      nameCipher: 'cipher-name',
      departmentId: 'd-cardio',
      archivedAt: null,
    });

    await expect(service.namePlain(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(decryptField).not.toHaveBeenCalled();
  });

  it('NONE 档 → 30006（设备管理员无患者数据）', async () => {
    const noneUser = { ...deptUser, dataScope: 'NONE' } as unknown as AuthenticatedUser;

    await expect(service.namePlain(noneUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.NO_PATIENT_DATA_SCOPE,
    });
    expect(decryptField).not.toHaveBeenCalled();
  });

  it('不存在 / 已归档 → 40001', async () => {
    for (const row of [
      null,
      { nameCipher: 'cipher-name', departmentId: 'd-endo', archivedAt: new Date() },
    ]) {
      prisma.patient.findUnique.mockResolvedValue(row);

      await expect(service.namePlain(deptUser, PATIENT_ID)).rejects.toMatchObject({
        code: ERROR_CODES.PATIENT_NOT_FOUND,
      });
    }
  });
});

describe('PatientService.admit — 办理住院', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.update.mockResolvedValue(publicRow());
  });

  it('出院患者可办理住院：状态转住院、清空出院时间、写入本次入院时间', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: null,
      departmentId: 'd-endo',
    });

    const result = await service.admit(deptUser, PATIENT_ID);

    const args = prisma.patient.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: PATIENT_ID, status: PATIENT_STATUS.DISCHARGED });
    expect(args.data.status).toBe(PATIENT_STATUS.INPATIENT);
    expect(args.data.admissionAt).toBeInstanceOf(Date);
    expect(args.data.dischargeAt).toBeNull();
    expect(result.fromStatus).toBe(PATIENT_STATUS.DISCHARGED);
    expect(result.toStatus).toBe(PATIENT_STATUS.INPATIENT);
    expect(result.item.status).toBe(PATIENT_STATUS.INPATIENT);
  });

  it('住院中的患者重复办理按 40004 拒绝，且不写库', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.INPATIENT,
      archivedAt: null,
      departmentId: 'd-endo',
    });

    await expect(service.admit(allUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_INVALID_STATE,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('跨科室患者 → 30002，且不写库', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: null,
      departmentId: 'd-cardio',
    });

    await expect(service.admit(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });

  it('患者不存在或已归档按 40001 处理', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: new Date('2026-10-01T00:00:00.000Z'),
      departmentId: 'd-endo',
    });

    await expect(service.admit(allUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.patient.update).not.toHaveBeenCalled();
  });
});

/* -------------------- R24：住院记录双写与 admissions 树查询 -------------------- */

describe('PatientService.admit — R24 住院记录双写', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];
  const dischargedAt = new Date('2026-10-01T02:00:00.000Z');

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: null,
      departmentId: 'd-endo',
      dischargeAt: dischargedAt,
    });
    prisma.patient.update.mockResolvedValue(publicRow());
    prisma.admission.findFirst.mockResolvedValue({ seq: 2 });
  });

  it('办理住院 → 新住院 seq=max+1 + 首条科室停留，入院时刻与 Patient.admissionAt 一致', async () => {
    await service.admit(deptUser, PATIENT_ID);

    const admissionAt = prisma.patient.update.mock.calls[0][0].data.admissionAt as Date;
    const created = prisma.admission.create.mock.calls[0][0].data;
    expect(created.patientId).toBe(PATIENT_ID);
    expect(created.seq).toBe(3);
    expect(created.admittedAt).toBe(admissionAt);
    expect(created.dischargedAt).toBeNull();
    expect(created.departmentId).toBe('d-endo');
    expect(created.departmentStays.create).toEqual({
      patientId: PATIENT_ID,
      departmentId: 'd-endo',
      startedAt: admissionAt,
      endedAt: null,
    });
  });

  it('防御性关闭：上一次「进行中」的住院/停留用原出院时间关闭', async () => {
    await service.admit(deptUser, PATIENT_ID);

    expect(prisma.admission.updateMany).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID, dischargedAt: null },
      data: { dischargedAt: dischargedAt },
    });
    expect(prisma.admissionDepartment.updateMany).toHaveBeenCalledWith({
      where: { patientId: PATIENT_ID, endedAt: null },
      data: { endedAt: dischargedAt },
    });
  });

  it('原出院时间为空（数据不一致）→ 以本次办理时刻近似关闭', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: null,
      departmentId: 'd-endo',
      dischargeAt: null,
    });

    await service.admit(deptUser, PATIENT_ID);

    const admissionAt = prisma.patient.update.mock.calls[0][0].data.admissionAt as Date;
    expect(prisma.admission.updateMany.mock.calls[0][0].data.dischargedAt).toBe(admissionAt);
  });

  it('无历史住院记录（迁移前老数据兜底）→ seq=1', async () => {
    prisma.admission.findFirst.mockResolvedValue(null);

    await service.admit(deptUser, PATIENT_ID);

    expect(prisma.admission.create.mock.calls[0][0].data.seq).toBe(1);
  });
});

describe('PatientService.create — R24 建档双写', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];
  let glucoseTargets: ReturnType<typeof createService>['glucoseTargets'];
  const admissionAt = new Date('2026-11-01T08:00:00.000Z');

  function createInput() {
    return {
      patientNo: 'H-0002',
      name: '李四',
      gender: GENDER.MALE,
      birthDate: new Date('1980-01-01T00:00:00.000Z'),
      departmentId: 'd-endo',
      admissionAt,
      status: PATIENT_STATUS.INPATIENT,
      doctorId: 'doc-1',
    };
  }

  beforeEach(() => {
    ({ service, prisma, glucoseTargets } = createService());
    prisma.user.findFirst.mockResolvedValue({ id: 'doc-1' });
    prisma.patient.findUnique.mockResolvedValue(null); // 住院号查重通过
    prisma.patient.create.mockResolvedValue({ id: 'p-new' });
  });

  it('建档成功 → 同事务创建 Admission(seq=1) + 首条科室停留', async () => {
    const result = await service.create(allUser, createInput() as never);

    expect(result.id).toBe('p-new');
    const created = prisma.admission.create.mock.calls[0][0].data;
    expect(created.patientId).toBe('p-new');
    expect(created.seq).toBe(1);
    expect(created.admittedAt).toBe(admissionAt);
    expect(created.dischargedAt).toBeNull();
    expect(created.departmentId).toBe('d-endo');
    expect(created.departmentStays.create).toEqual({
      patientId: 'p-new',
      departmentId: 'd-endo',
      startedAt: admissionAt,
      endedAt: null,
    });
  });

  it('建档成功后初始化控糖目标快照（R9 / 裁定 G 快照语义）', async () => {
    await service.create(allUser, createInput() as never);

    expect(glucoseTargets.initSnapshot).toHaveBeenCalledTimes(1);
    expect(glucoseTargets.initSnapshot).toHaveBeenCalledWith(allUser, 'p-new');
  });

  it('快照初始化抛错 → 建档仍返回 id（裁定 Q 失败不阻断；调用点防御性 catch）', async () => {
    glucoseTargets.initSnapshot.mockRejectedValueOnce(new Error('deadlock'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const result = await service.create(allUser, createInput() as never);

    // 关键：患者已入库就必须返回成功，否则医护会重复提交并撞 P2002 报「住院号已存在」
    expect(result.id).toBe('p-new');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('住院号重复 → 40002，且不创建住院记录（事务未开启）', async () => {
    prisma.patient.findUnique.mockResolvedValue({ id: 'p-existing' });

    await expect(service.create(allUser, createInput() as never)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NO_DUPLICATE,
    });
    expect(prisma.admission.create).not.toHaveBeenCalled();
    // 建档未成功就不该写快照，否则会留下无主的控糖目标行
    expect(glucoseTargets.initSnapshot).not.toHaveBeenCalled();
  });
});

describe('PatientService.admissions — R24 住院记录树', () => {
  let service: PatientService;
  let prisma: ReturnType<typeof createService>['prisma'];

  /** 两次住院夹具：第 2 次在院（1 段停留），第 1 次已出院（2 段停留 = 转科一次） */
  function admissionRows() {
    return [
      {
        id: 'a-2',
        seq: 2,
        admittedAt: new Date(2026, 10, 1, 9, 0, 0),
        dischargedAt: null,
        departmentStays: [
          {
            id: 'ad-2',
            departmentId: 'd-endo',
            startedAt: new Date(2026, 10, 1, 9, 0, 0),
            endedAt: null,
            department: { name: '内分泌科' },
          },
        ],
      },
      {
        id: 'a-1',
        seq: 1,
        admittedAt: new Date(2026, 9, 1, 8, 0, 0),
        dischargedAt: new Date(2026, 9, 20, 10, 0, 0),
        departmentStays: [
          {
            id: 'ad-1a',
            departmentId: 'd-cardio',
            startedAt: new Date(2026, 9, 1, 8, 0, 0),
            endedAt: new Date(2026, 9, 10, 8, 0, 0),
            department: { name: '心内科' },
          },
          {
            id: 'ad-1b',
            departmentId: 'd-endo',
            startedAt: new Date(2026, 9, 10, 8, 0, 0),
            endedAt: new Date(2026, 9, 20, 10, 0, 0),
            department: { name: '内分泌科' },
          },
        ],
      },
    ];
  }

  beforeEach(() => {
    ({ service, prisma } = createService());
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.INPATIENT,
      archivedAt: null,
      departmentId: 'd-endo',
    });
    prisma.admission.findMany.mockResolvedValue(admissionRows());
  });

  it('树形组装：status + isCurrent + 本地时刻字符串 + 科室名（裁定 Q4/Q8 数据源）', async () => {
    const result = await service.admissions(deptUser, PATIENT_ID);

    expect(result.status).toBe(PATIENT_STATUS.INPATIENT);
    expect(result.admissions).toHaveLength(2);

    const current = result.admissions[0];
    expect(current.seq).toBe(2);
    expect(current.isCurrent).toBe(true);
    expect(current.admittedAt).toBe('2026-11-01 09:00:00');
    expect(current.dischargedAt).toBeNull();
    expect(current.departments).toEqual([
      {
        id: 'ad-2',
        departmentId: 'd-endo',
        departmentName: '内分泌科',
        startedAt: '2026-11-01 09:00:00',
        endedAt: null,
      },
    ]);

    const past = result.admissions[1];
    expect(past.isCurrent).toBe(false);
    expect(past.dischargedAt).toBe('2026-10-20 10:00:00');
    expect(past.departments.map((stay) => stay.departmentName)).toEqual(['心内科', '内分泌科']);
  });

  it('排序参数：住院按 admittedAt 降序 NULLS LAST，停留按 startedAt 升序 NULLS FIRST（裁定 Q6）', async () => {
    await service.admissions(deptUser, PATIENT_ID);

    const args = prisma.admission.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ patientId: PATIENT_ID });
    expect(args.orderBy).toEqual({ admittedAt: { sort: 'desc', nulls: 'last' } });
    expect(args.select.departmentStays.orderBy).toEqual({
      startedAt: { sort: 'asc', nulls: 'first' },
    });
  });

  it('出院患者：即使存在 dischargedAt 为空的脏数据行，isCurrent 也恒为 false', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.DISCHARGED,
      archivedAt: null,
      departmentId: 'd-endo',
    });
    prisma.admission.findMany.mockResolvedValue([
      { id: 'a-1', seq: 1, admittedAt: null, dischargedAt: null, departmentStays: [] },
    ]);

    const result = await service.admissions(deptUser, PATIENT_ID);

    expect(result.status).toBe(PATIENT_STATUS.DISCHARGED);
    expect(result.admissions[0].isCurrent).toBe(false);
    // admittedAt 为空（裁定 Q7）：原样下发 null，前端 label 省略区间
    expect(result.admissions[0].admittedAt).toBeNull();
  });

  it('跨科室 → 30002，且不查住院记录', async () => {
    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.INPATIENT,
      archivedAt: null,
      departmentId: 'd-cardio',
    });

    await expect(service.admissions(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.CROSS_DEPARTMENT_DENIED,
    });
    expect(prisma.admission.findMany).not.toHaveBeenCalled();
  });

  it('患者不存在或已归档 → 40001，不泄露存在性', async () => {
    prisma.patient.findUnique.mockResolvedValue(null);
    await expect(service.admissions(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });

    prisma.patient.findUnique.mockResolvedValue({
      status: PATIENT_STATUS.INPATIENT,
      archivedAt: new Date('2026-10-01T00:00:00.000Z'),
      departmentId: 'd-endo',
    });
    await expect(service.admissions(deptUser, PATIENT_ID)).rejects.toMatchObject({
      code: ERROR_CODES.PATIENT_NOT_FOUND,
    });
    expect(prisma.admission.findMany).not.toHaveBeenCalled();
  });
});
