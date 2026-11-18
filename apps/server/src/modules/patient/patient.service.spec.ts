import { ERROR_CODES, GENDER, PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type { UpdatePatientInput } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../common/types';
import { PatientService } from './patient.service';

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
    },
    user: {
      findFirst: vi.fn(),
    },
  };
  const service = new PatientService(prisma as never);
  return { service, prisma };
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
