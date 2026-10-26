import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  formatDateTime,
  PATIENT_STATUS,
  RESOURCE,
  ROLE_CODE,
} from '@gc/shared';
import type {
  CreatePatientInput,
  FieldError,
  PatientListItem,
  PatientListQuery,
  PatientStatus,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { encryptDeterministic, maskIdCard, maskName, maskPhone } from '../../common/crypto/field-crypto';
import { assertInScope, buildScopeWhere } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

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
      const created = await this.prisma.patient.create({
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
      return { id: created.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
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
        select: {
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
            orderBy: { measuredAt: 'desc' },
            take: 1,
            select: { valueMmolL: true, mealContext: true, measuredAt: true },
          },
        },
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.patient.count({ where }),
    ]);

    return {
      items: rows.map((row) => {
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
          lastGlucoseValue: lastGlucose ? Number(lastGlucose.valueMmolL) : null,
          lastGlucoseMealContext: lastGlucose?.mealContext ?? null,
          lastGlucoseMeasuredAt: formatDateTime(lastGlucose?.measuredAt ?? null),
        };
      }),
      total,
    };
  }
}
