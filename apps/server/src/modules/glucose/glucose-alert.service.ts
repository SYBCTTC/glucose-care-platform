import { Injectable } from '@nestjs/common';
import { formatDateTime, GLUCOSE_ALERT_RESULT_CODES, PATIENT_STATUS, RESOURCE } from '@gc/shared';
import type { GlucoseAlertItem, GlucoseAlertListResponse, GlucoseAlertQuery } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { encryptDeterministic } from '../../common/crypto/field-crypto';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { PatientGlucoseTargetService } from '../patient/patient-glucose-target.service';

/**
 * P4-7：跨患者血糖预警查询（住院管理-预警管理，docs/specs/glucose-alerts.md）。
 *
 * 口径（规格已冻结）：
 *  - 预警 = **落库 resultType**（'2' 高 / '0' 低，裁定 R1-Q1），查询时不重判、不读预警值表；
 *    作废记录一律排除（`voidedAt: null`，AGENTS.md §5.2 读路径铁律）；
 *  - 患者维度条件与 `buildScopeWhere(PATIENT)` AND 合并（科室档用户天然只见本科室）；
 *  - valueGt/valueLt 数值区间 AND 叠加（裁定 R1-Q2），gt ≥ lt 不强拦、允许空结果（裁定 R2-Q4）；
 *  - 统计随全部筛选、不受分页影响（裁定 R2-Q1）：patientCount 为去重患者数；
 *  - 「控糖范围」列查询时实时解析（批量，禁止 N+1），解析失败 null → 前端 '-'；
 *  - 姓名筛选走确定性密文等值（同患者管理）；响应 name 恒为 nameMasked 脱敏文。
 *
 * 权限/数据范围/审计由 controller 装饰器负责（alert:view + PATIENT + GLUCOSE_ALERT_QUERY），
 * 本服务不重复鉴权。
 */
@Injectable()
export class GlucoseAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: PatientGlucoseTargetService,
  ) {}

  async list(user: AuthenticatedUser, query: GlucoseAlertQuery): Promise<GlucoseAlertListResponse> {
    const where = this.buildWhere(user, query);

    const [rows, total, highCount, lowCount, patientRows] = await Promise.all([
      this.prisma.glucoseRecord.findMany({
        where,
        select: {
          id: true,
          patientId: true,
          resultType: true,
          valueMmolL: true,
          measuredAt: true,
          mealContext: true,
          patient: {
            select: {
              patientNo: true,
              nameMasked: true,
              gender: true,
              bedNo: true,
              department: { select: { name: true } },
              doctor: { select: { name: true } },
              nurse: { select: { name: true } },
            },
          },
        },
        // 检测时间倒序（同血糖记录页）；同刻按 id 升序保证翻页稳定
        orderBy: [{ measuredAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.glucoseRecord.count({ where }),
      // type 已指定时另一侧恒为 0，跳过无谓计数（统计口径 = 当前筛选含 type）
      query.type === 'low'
        ? 0
        : this.prisma.glucoseRecord.count({
            where: { ...where, resultType: GLUCOSE_ALERT_RESULT_CODES.high },
          }),
      query.type === 'high'
        ? 0
        : this.prisma.glucoseRecord.count({
            where: { ...where, resultType: GLUCOSE_ALERT_RESULT_CODES.low },
          }),
      // 去重患者数：只取 patientId + distinct，行数即人数（一人多条/兼有高低只计 1）
      this.prisma.glucoseRecord.findMany({
        where,
        select: { patientId: true },
        distinct: ['patientId'],
      }),
    ]);

    // 控糖范围批量解析（当页患者一次 IN 查询 + 全局回退一次），禁止逐条调用
    const { byPatientSlot, global } = await this.targets.resolveResultTypeThresholdsBatch(
      rows.map((row) => row.patientId),
    );

    const items: GlucoseAlertItem[] = rows.map((row) => ({
      id: row.id,
      departmentName: row.patient.department?.name ?? null,
      bedNo: row.patient.bedNo,
      name: row.patient.nameMasked,
      gender: row.patient.gender,
      patientNo: row.patient.patientNo,
      // where 已约束 resultType ∈ {'0','2'}，不存在第三种取值
      alertType: row.resultType === GLUCOSE_ALERT_RESULT_CODES.high ? 'high' : 'low',
      // '0'/'2' 必有读数（阈值判定前提）；Number(null)=0 仅为类型兜底，正常不可达
      valueMmolL: Number(row.valueMmolL),
      measuredAt: formatDateTime(row.measuredAt) ?? '',
      mealContext: row.mealContext,
      targetRange: byPatientSlot.get(`${row.patientId}|${row.mealContext ?? ''}`) ?? global,
      doctorName: row.patient.doctor?.name ?? null,
      nurseName: row.patient.nurse?.name ?? null,
    }));

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      stats: { patientCount: patientRows.length, totalCount: total, highCount, lowCount },
      // 审计回显（AUDIT_DETAIL_ALLOW_LIST 白名单提取，同 R27 记录列表口径）
      rangeFrom: formatDateTime(query.startTime) ?? '',
      rangeTo: formatDateTime(query.endTime) ?? '',
      count: rows.length,
      alertType: query.type ?? 'all',
    };
  }

  /** 预警维度 where：血糖记录条件 + 患者维度条件（数据范围收敛 + 筛选项） */
  private buildWhere(
    user: AuthenticatedUser,
    query: GlucoseAlertQuery,
  ): Prisma.GlucoseRecordWhereInput {
    const patientWhere: Prisma.PatientWhereInput = {
      ...(buildScopeWhere(user, RESOURCE.PATIENT) as unknown as Prisma.PatientWhereInput),
    };
    if (query.admissionStatus !== 'all') {
      patientWhere.status =
        query.admissionStatus === 'inpatient'
          ? PATIENT_STATUS.INPATIENT
          : PATIENT_STATUS.DISCHARGED;
    }
    if (query.departmentId) {
      patientWhere.departmentId = query.departmentId;
    }
    if (query.doctorId) {
      patientWhere.doctorId = query.doctorId;
    }
    if (query.patientNo) {
      patientWhere.patientNo = { contains: query.patientNo, mode: 'insensitive' };
    }
    if (query.bedNo) {
      patientWhere.bedNo = { contains: query.bedNo, mode: 'insensitive' };
    }
    if (query.name) {
      // 姓名密文确定性等值（与患者管理同实现，密文不支持模糊）
      patientWhere.nameCipher = encryptDeterministic(query.name);
    }

    return {
      voidedAt: null,
      resultType: query.type
        ? GLUCOSE_ALERT_RESULT_CODES[query.type]
        : { in: Object.values(GLUCOSE_ALERT_RESULT_CODES) },
      measuredAt: { gte: query.startTime, lte: query.endTime },
      ...(query.valueGt !== undefined || query.valueLt !== undefined
        ? {
            valueMmolL: {
              ...(query.valueGt !== undefined && { gt: query.valueGt }),
              ...(query.valueLt !== undefined && { lt: query.valueLt }),
            },
          }
        : {}),
      patient: patientWhere,
    };
  }
}
