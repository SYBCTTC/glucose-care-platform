import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  formatDateOnly,
  formatDateTime,
  maskIdCard,
  maskName,
  maskPhone,
  PATIENT_STATUS,
  RESOURCE,
  ROLE_CODE,
} from '@gc/shared';
import type {
  AdmissionsResponse,
  CreatePatientInput,
  DiabetesType,
  FieldError,
  PatientAdmitResult,
  PatientDetail,
  PatientListItem,
  PatientListQuery,
  PatientNamePlainResult,
  PatientStatus,
  PatientUpdateResult,
  UpdatePatientInput,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { decryptField, encryptDeterministic } from '../../common/crypto/field-crypto';
import { assertInScope, buildScopeWhere } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-error';

export interface PatientListResult {
  items: PatientListItem[];
  total: number;
}

/** 建档成功后返回的最小信息（前端据此刷新列表） */
export interface PatientCreateResult {
  id: string;
}

/** 责任护士候选角色：护士 + 护士长（与 DY-OPERATOR 口径一致） */
const NURSE_ROLE_CODES: string[] = [ROLE_CODE.NURSE, ROLE_CODE.HEAD_NURSE];

/** 按自然日计算年龄；出生日期缺失时返回 null */
function calcAge(birthDate: Date | null): number | null {
  if (!birthDate) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * 列表 / 详情共用的患者字段选择器。
 * 出参一律脱敏：*Cipher 列永远不进 select，避免明文或密文泄露到前端。
 */
export const PATIENT_PUBLIC_SELECT = Prisma.validator<Prisma.PatientSelect>()({
  id: true,
  nameMasked: true,
  patientNo: true,
  gender: true,
  birthDate: true,
  bedNo: true,
  departmentId: true,
  department: { select: { name: true } },
  doctorId: true,
  doctor: { select: { name: true } },
  status: true,
  admissionAt: true,
  dischargeAt: true,
  archivedAt: true,
  glucoseRecords: {
    // R25：最新血糖只认有效记录，已作废的不展示
    where: { voidedAt: null },
    orderBy: { measuredAt: 'desc' },
    take: 1,
    select: { resultType: true, valueMmolL: true, mealContext: true, measuredAt: true },
  },
  // 当前是否在虚拟病区：只探一条 leftAt 为空的记录，命中索引 (patientId, leftAt)。
  // 部分唯一索引保证至多一条，故 take:1 足够；用 length>0 判定而不是取字段，避免多查列。
  virtualWardRecords: {
    where: { leftAt: null },
    take: 1,
    select: { id: true },
  },
});

export type PatientPublicRow = Prisma.PatientGetPayload<{ select: typeof PATIENT_PUBLIC_SELECT }>;

/**
 * 行 → 列表项。列表与详情共用，保证两处口径一致。
 * 导出供血糖模块复用：添加血糖后要回传更新后的列表项，避免前端整页重查。
 */
export function toListItem(row: PatientPublicRow): PatientListItem {
  const lastGlucose = row.glucoseRecords[0] ?? null;
  return {
    id: row.id,
    nameMasked: row.nameMasked,
    patientNo: row.patientNo,
    gender: row.gender,
    bedNo: row.bedNo,
    departmentId: row.departmentId,
    departmentName: row.department.name,
    doctorId: row.doctorId,
    doctorName: row.doctor?.name ?? null,
    status: row.status,
    admissionAt: formatDateTime(row.admissionAt),
    dischargeAt: formatDateTime(row.dischargeAt),
    archivedAt: formatDateTime(row.archivedAt),
    age: calcAge(row.birthDate),
    lastGlucoseResultType: lastGlucose?.resultType ?? null,
    lastGlucoseValue: lastGlucose?.valueMmolL ? Number(lastGlucose.valueMmolL) : null,
    lastGlucoseMealContext: lastGlucose?.mealContext ?? null,
    lastGlucoseMeasuredAt: formatDateTime(lastGlucose?.measuredAt ?? null),
    // 前端据此把「加入虚拟病区」菜单项切换为置灰的「已加入虚拟病区」
    inVirtualWard: row.virtualWardRecords.length > 0,
  };
}

/** 详情选择器：在列表字段之上补编辑弹窗回填所需的字段，仍不含任何明文 */
const PATIENT_DETAIL_SELECT = Prisma.validator<Prisma.PatientSelect>()({
  ...PATIENT_PUBLIC_SELECT,
  idCardMasked: true,
  phoneMasked: true,
  remark: true,
  nurseId: true,
  nurse: { select: { name: true } },
  diabetesType: true,
  hba1c: true,
  bindings: {
    where: { unboundAt: null },
    select: { device: { select: { id: true, sn: true, model: true, status: true } } },
  },
});

@Injectable()
export class PatientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 患者建档（添加患者）。
   * 安全约定：
   *  1. 姓名 / 身份证 / 手机号加密存 Cipher，另存脱敏值，禁止落明文；
   *  2. 科室必须落在当前账号数据范围内（走 assertInScope，禁止手写科室比较）；
   *  3. 责任医生 / 责任护士必须属于所选科室且角色匹配，否则字段级报错。
   */
  async create(user: AuthenticatedUser, input: CreatePatientInput): Promise<PatientCreateResult> {
    assertInScope(user, RESOURCE.PATIENT, { departmentId: input.departmentId });

    await this.assertStaffInDepartment(
      input.doctorId,
      input.departmentId,
      [ROLE_CODE.DOCTOR],
      'doctorId',
      '责任医生不属于所选科室',
    );
    await this.assertStaffInDepartment(
      input.nurseId,
      input.departmentId,
      NURSE_ROLE_CODES,
      'nurseId',
      '责任护士不属于所选科室',
    );

    // 住院号院内唯一：先查一次给出明确业务码，并发冲突由下面的 P2002 兜底
    const duplicated = await this.prisma.patient.findUnique({
      where: { patientNo: input.patientNo },
      select: { id: true },
    });
    if (duplicated) {
      throw new BusinessException(ERROR_CODES.PATIENT_NO_DUPLICATE);
    }

    try {
      // R24 双写（规格 §2.4）：建档同事务创建首次住院记录（seq=1）+ 首条科室停留，
      // 保证详情页「住院记录/科室记录」下拉有数据。并发建档撞 P2002 时整个事务回滚。
      const created = await this.prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            patientNo: input.patientNo,
            nameCipher: encryptDeterministic(input.name),
            nameMasked: maskName(input.name),
            idCardCipher: input.idCard ? encryptDeterministic(input.idCard) : null,
            idCardMasked: input.idCard ? maskIdCard(input.idCard) : null,
            phoneCipher: input.phone ? encryptDeterministic(input.phone) : null,
            phoneMasked: input.phone ? maskPhone(input.phone) : null,
            gender: input.gender,
            birthDate: input.birthDate,
            bedNo: input.bedNo ?? null,
            diabetesType: input.diabetesType ?? null,
            hba1c: input.hba1c === undefined ? null : new Prisma.Decimal(input.hba1c.toFixed(1)),
            departmentId: input.departmentId,
            doctorId: input.doctorId ?? null,
            nurseId: input.nurseId ?? null,
            admissionAt: input.admissionAt,
            status: input.status,
            remark: input.remark ?? null,
          },
          select: { id: true },
        });
        await tx.admission.create({
          data: {
            patientId: patient.id,
            seq: 1,
            admittedAt: input.admissionAt,
            // 建档入参没有出院时间（与 Patient.dischargeAt 现状同口径）；即使建档为出院
            // 状态也留空，前端初始态判定以 AdmissionsResponse.status 为权威（裁定 Q15）
            dischargedAt: null,
            departmentId: input.departmentId,
            departmentStays: {
              create: {
                patientId: patient.id,
                departmentId: input.departmentId,
                startedAt: input.admissionAt,
                endedAt: null,
              },
            },
          },
        });
        return patient;
      });
      return { id: created.id };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BusinessException(ERROR_CODES.PATIENT_NO_DUPLICATE);
      }
      throw error;
    }
  }

  /** 校验责任医生 / 护士：必须是所选科室的在职医护，否则按字段级校验错误返回 */
  private async assertStaffInDepartment(
    staffId: string | undefined,
    departmentId: string,
    roleCodes: string[],
    field: string,
    message: string,
  ): Promise<void> {
    if (!staffId) {
      return;
    }
    const staff = await this.prisma.user.findFirst({
      where: {
        id: staffId,
        departmentId,
        status: 'ACTIVE',
        roles: { some: { role: { code: { in: roleCodes } } } },
      },
      select: { id: true },
    });
    if (!staff) {
      const details: FieldError[] = [{ field, message }];
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }
  }

  /**
   * 住院 / 出院患者列表。
   * 数据范围统一走 buildScopeWhere（PATIENT），禁止在此手写科室过滤绕过数据权限。
   */
  async list(
    user: AuthenticatedUser,
    status: PatientStatus,
    query: PatientListQuery,
  ): Promise<PatientListResult> {
    const scope = buildScopeWhere(user, RESOURCE.PATIENT) as unknown as Prisma.PatientWhereInput;
    const where: Prisma.PatientWhereInput = { ...scope, status };

    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }
    if (query.doctorId) {
      where.doctorId = query.doctorId;
    }
    if (query.patientNo) {
      where.patientNo = { contains: query.patientNo, mode: 'insensitive' };
    }
    if (query.bedNo) {
      where.bedNo = { contains: query.bedNo, mode: 'insensitive' };
    }
    if (query.name) {
      // 姓名为密文存储，只能做确定性等值匹配（不支持模糊）
      where.nameCipher = encryptDeterministic(query.name);
    }
    if (query.admissionFrom || query.admissionTo) {
      where.admissionAt = {
        ...(query.admissionFrom ? { gte: query.admissionFrom } : {}),
        ...(query.admissionTo ? { lte: query.admissionTo } : {}),
      };
    }
    if (query.dischargeFrom || query.dischargeTo) {
      where.dischargeAt = {
        ...(query.dischargeFrom ? { gte: query.dischargeFrom } : {}),
        ...(query.dischargeTo ? { lte: query.dischargeTo } : {}),
      };
    }

    // 同一时间入院的患者很多，追加 id 保证分页顺序稳定，避免滚动加载重复/漏人
    const orderBy: Prisma.PatientOrderByWithRelationInput[] =
      status === PATIENT_STATUS.DISCHARGED
        ? [{ dischargeAt: 'desc' }, { id: 'asc' }]
        : [{ admissionAt: 'desc' }, { id: 'asc' }];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({
        where,
        select: PATIENT_PUBLIC_SELECT,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    return { items: rows.map(toListItem), total };
  }

  /**
   * 患者详情（编辑弹窗回填用）。
   * 安全约定：
   *  1. 只返回脱敏值，明文身份信息一律不出库；
   *  2. 数据范围走 assertInScope，跨科室 → 30002；
   *  3. 属敏感查询，controller 挂 @Audit('PATIENT_VIEW') 逐条留痕。
   */
  async detail(user: AuthenticatedUser, id: string): Promise<PatientDetail> {
    const row = await this.prisma.patient.findUnique({
      where: { id },
      select: PATIENT_DETAIL_SELECT,
    });
    if (!row || row.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: row.departmentId });

    return {
      ...toListItem(row),
      idCardMasked: row.idCardMasked,
      phoneMasked: row.phoneMasked,
      birthDate: formatDateOnly(row.birthDate),
      remark: row.remark,
      nurseId: row.nurseId,
      nurseName: row.nurse?.name ?? null,
      diabetesType: row.diabetesType as DiabetesType | null,
      hba1c: row.hba1c === null ? null : Number(row.hba1c),
      devices: row.bindings.map((binding) => binding.device),
    };
  }

  /**
   * 明文姓名（R28 打印头，裁定 A1(b)/Q7）。
   * 安全约定：
   *  1. 仅暴露 `name` 一个明文字段（打印头其余字段均非加密字段，详情接口已有）；
   *  2. 独立权限点 `glucose:print`（controller 层）+ 数据范围 assertInScope，跨科室 → 30002；
   *  3. **访问即留痕**：controller 挂 @Audit('PATIENT_NAME_PLAIN_VIEW')，每次调用一条（含 DENIED）；
   *  4. 解密失败（历史 `enc:hmac:` 不可逆密文等）返回 `name: null`，前端回退 nameMasked，
   *     不抛错（规格 §4 规则 15：不是错误，无对应错误码）。
   */
  async namePlain(user: AuthenticatedUser, id: string): Promise<PatientNamePlainResult> {
    const row = await this.prisma.patient.findUnique({
      where: { id },
      select: { nameCipher: true, departmentId: true, archivedAt: true },
    });
    if (!row || row.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: row.departmentId });
    return { name: decryptField(row.nameCipher) };
  }

  /**
   * 患者信息编辑（PATCH）。
   * 安全约定：
   *  1. 只有住院患者可编辑，出院 / 已归档一律拒绝；
   *  2. 患者当前科室与目标科室都必须落在数据范围内；
   *  3. 姓名 / 身份证 / 手机号只有显式给出新值才重新加密，未传则保留原值
   *     （密文不可逆，前端无法回填明文，只能「留空不改」）；
   *  4. 返回 changedFields（仅字段名），供审计留痕，不含任何患者信息。
   */
  async update(
    user: AuthenticatedUser,
    id: string,
    input: UpdatePatientInput,
  ): Promise<PatientUpdateResult> {
    const existing = await this.prisma.patient.findUnique({
      where: { id },
      select: {
        status: true,
        archivedAt: true,
        departmentId: true,
        nameCipher: true,
        idCardCipher: true,
        phoneCipher: true,
        gender: true,
        birthDate: true,
        bedNo: true,
        doctorId: true,
        nurseId: true,
        diabetesType: true,
        hba1c: true,
      },
    });
    if (!existing || existing.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }

    // 先按患者当前科室判权限，再按目标科室判一次，避免"借改科室跨出数据范围"
    assertInScope(user, RESOURCE.PATIENT, { departmentId: existing.departmentId });
    if (existing.status !== PATIENT_STATUS.INPATIENT) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }
    if (input.departmentId !== existing.departmentId) {
      assertInScope(user, RESOURCE.PATIENT, { departmentId: input.departmentId });
    }

    // 医护归属按「最终生效值」校验：只改了科室、没换医护时也会被拦下
    await this.assertStaffInDepartment(
      input.doctorId ?? undefined,
      input.departmentId,
      [ROLE_CODE.DOCTOR],
      'doctorId',
      '责任医生不属于所选科室',
    );
    await this.assertStaffInDepartment(
      input.nurseId ?? undefined,
      input.departmentId,
      NURSE_ROLE_CODES,
      'nurseId',
      '责任护士不属于所选科室',
    );

    const data: Prisma.PatientUncheckedUpdateInput = {};
    const changedFields: string[] = [];

    // ① 敏感字段：只有显式给值才写，密文相同视为未变更
    if (input.name !== undefined) {
      const cipher = encryptDeterministic(input.name);
      if (cipher !== existing.nameCipher) {
        data.nameCipher = cipher;
        data.nameMasked = maskName(input.name);
        changedFields.push('name');
      }
    }
    if (input.idCard !== undefined) {
      const cipher = input.idCard === null ? null : encryptDeterministic(input.idCard);
      if (cipher !== existing.idCardCipher) {
        data.idCardCipher = cipher;
        data.idCardMasked = input.idCard === null ? null : maskIdCard(input.idCard);
        changedFields.push('idCard');
      }
    }
    if (input.phone !== undefined) {
      const cipher = input.phone === null ? null : encryptDeterministic(input.phone);
      if (cipher !== existing.phoneCipher) {
        data.phoneCipher = cipher;
        data.phoneMasked = input.phone === null ? null : maskPhone(input.phone);
        changedFields.push('phone');
      }
    }

    // ② 非敏感字段：覆盖式提交，null 表示清空
    if (input.gender !== existing.gender) {
      data.gender = input.gender;
      changedFields.push('gender');
    }
    if (input.birthDate.getTime() !== existing.birthDate?.getTime()) {
      data.birthDate = input.birthDate;
      changedFields.push('birthDate');
    }
    const nextBedNo = input.bedNo?.trim() || null;
    if (nextBedNo !== existing.bedNo) {
      data.bedNo = nextBedNo;
      changedFields.push('bedNo');
    }
    if (input.departmentId !== existing.departmentId) {
      data.departmentId = input.departmentId;
      changedFields.push('departmentId');
    }
    const nextDoctorId = input.doctorId ?? null;
    if (nextDoctorId !== existing.doctorId) {
      data.doctorId = nextDoctorId;
      changedFields.push('doctorId');
    }
    const nextNurseId = input.nurseId ?? null;
    if (nextNurseId !== existing.nurseId) {
      data.nurseId = nextNurseId;
      changedFields.push('nurseId');
    }
    const nextDiabetesType = input.diabetesType ?? null;
    if (nextDiabetesType !== existing.diabetesType) {
      data.diabetesType = nextDiabetesType;
      changedFields.push('diabetesType');
    }
    const currentHba1c = existing.hba1c === null ? null : Number(existing.hba1c);
    const nextHba1c = input.hba1c ?? null;
    if (nextHba1c !== currentHba1c) {
      data.hba1c = nextHba1c === null ? null : new Prisma.Decimal(nextHba1c.toFixed(1));
      changedFields.push('hba1c');
    }

    if (changedFields.length === 0) {
      const row = await this.prisma.patient.findUniqueOrThrow({
        where: { id },
        select: PATIENT_PUBLIC_SELECT,
      });
      return { id, changedFields, item: toListItem(row) };
    }

    const row = await this.prisma.patient.update({
      where: { id },
      data,
      select: PATIENT_PUBLIC_SELECT,
    });
    return { id, changedFields, item: toListItem(row) };
  }

  /**
   * 办理住院（重新入院）：出院患者 → 住院患者。
   * 安全约定：
   *  1. 只有 DISCHARGED 可办理，其它状态 → 40004（PATIENT_INVALID_STATE）；
   *  2. 数据范围走 assertInScope（PATIENT），跨科室 → 30002；
   *  3. 审计由 controller 的 @Audit 统一留痕，detail 记 fromStatus / toStatus；
   *  4. 住院号沿用原值（院内唯一业务主键不变），床位不自动分配，由后续入院流程补齐。
   */
  async admit(user: AuthenticatedUser, id: string): Promise<PatientAdmitResult> {
    const existing = await this.prisma.patient.findUnique({
      where: { id },
      select: { status: true, archivedAt: true, departmentId: true, dischargeAt: true },
    });
    if (!existing || existing.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: existing.departmentId });
    if (existing.status !== PATIENT_STATUS.DISCHARGED) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }

    // 办理住院时间 = 本次操作时刻（业务时刻，明确赋值，不用默认值兜底）
    const admissionAt = new Date();
    let row: PatientPublicRow;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        // where 带 status 条件：并发重复点击时只有一次能命中，避免覆盖已入院记录；
        // 后到的事务在此抛 P2025 → 整体回滚，不会重复创建 Admission
        const updated = await tx.patient.update({
          where: { id, status: PATIENT_STATUS.DISCHARGED },
          data: {
            status: PATIENT_STATUS.INPATIENT,
            admissionAt,
            dischargeAt: null,
          },
          select: PATIENT_PUBLIC_SELECT,
        });

        // R24 双写（规格 §2.4）。防御性关闭：上一次住院记录/科室停留若仍是「进行中」
        // （出院功能缺失或历史数据不一致所致），用原出院时间关闭，保证不变量
        // 「每患者至多一条本次住院」；原出院时间为空时以本次办理时刻近似。
        const previousDischargedAt = existing.dischargeAt ?? admissionAt;
        await tx.admission.updateMany({
          where: { patientId: id, dischargedAt: null },
          data: { dischargedAt: previousDischargedAt },
        });
        await tx.admissionDepartment.updateMany({
          where: { patientId: id, endedAt: null },
          data: { endedAt: previousDischargedAt },
        });

        // 新一次住院 = max(seq)+1；事务内读 max 再写，并发安全由上方 status 条件保证
        const last = await tx.admission.findFirst({
          where: { patientId: id },
          orderBy: { seq: 'desc' },
          select: { seq: true },
        });
        await tx.admission.create({
          data: {
            patientId: id,
            seq: (last?.seq ?? 0) + 1,
            admittedAt: admissionAt,
            dischargedAt: null,
            departmentId: existing.departmentId,
            departmentStays: {
              create: {
                patientId: id,
                departmentId: existing.departmentId,
                startedAt: admissionAt,
                endedAt: null,
              },
            },
          },
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
      }
      throw error;
    }

    return {
      id,
      fromStatus: PATIENT_STATUS.DISCHARGED,
      toStatus: PATIENT_STATUS.INPATIENT,
      item: toListItem(row),
    };
  }

  /**
   * 住院记录树（R24，GET /patients/:id/admissions）——报表查询表单的下拉数据源。
   * 安全约定：
   *  1. 与 detail() 同口径：患者存在、未归档，assertInScope（跨科室 → 30002）；
   *  2. 属敏感查询，controller 挂 @Audit('ADMISSION_QUERY') 逐条留痕；
   *  3. 出参只有科室名与时间，无患者敏感明文。
   * 排序（裁定 Q6）：住院记录按 admittedAt 降序（NULLS LAST，本次住院天然最前）；
   * 每次住院内的科室停留按 startedAt 升序（NULLS FIRST）。
   */
  async admissions(user: AuthenticatedUser, id: string): Promise<AdmissionsResponse> {
    const patient = await this.prisma.patient.findUnique({
      where: { id },
      select: { status: true, archivedAt: true, departmentId: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });

    const rows = await this.prisma.admission.findMany({
      where: { patientId: id },
      select: {
        id: true,
        seq: true,
        admittedAt: true,
        dischargedAt: true,
        departmentStays: {
          select: {
            id: true,
            departmentId: true,
            startedAt: true,
            endedAt: true,
            department: { select: { name: true } },
          },
          orderBy: { startedAt: { sort: 'asc', nulls: 'first' } },
        },
      },
      orderBy: { admittedAt: { sort: 'desc', nulls: 'last' } },
    });

    const inpatient = patient.status === PATIENT_STATUS.INPATIENT;
    return {
      status: patient.status,
      admissions: rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        admittedAt: formatDateTime(row.admittedAt),
        dischargedAt: formatDateTime(row.dischargedAt),
        // isCurrent 只对住院患者成立：出院患者若存在 dischargedAt 为空的脏数据行，
        // 不得被前端当成「本次住院」（初始态判定以 status 为权威）
        isCurrent: inpatient && row.dischargedAt === null,
        departments: row.departmentStays.map((stay) => ({
          id: stay.id,
          departmentId: stay.departmentId,
          departmentName: stay.department.name,
          startedAt: formatDateTime(stay.startedAt),
          endedAt: formatDateTime(stay.endedAt),
        })),
      })),
    };
  }
}
