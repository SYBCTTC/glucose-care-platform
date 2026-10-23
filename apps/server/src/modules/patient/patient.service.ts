import { Injectable } from '@nestjs/common';
import { formatDateTime, PATIENT_STATUS, RESOURCE } from '@gc/shared';
import type { PatientListItem, PatientListQuery, PatientStatus } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { encryptDeterministic } from '../../common/crypto/field-crypto';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

export interface PatientListResult {
  items: PatientListItem[];
  total: number;
}

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
