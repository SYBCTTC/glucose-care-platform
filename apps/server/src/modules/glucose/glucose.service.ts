import { Injectable } from '@nestjs/common';
import {
  DEFAULT_ALERT_RANGE,
  ERROR_CODES,
  formatDateTime,
  GLUCOSE_ENTRY_DETECT,
  PATIENT_STATUS,
  RESOURCE,
} from '@gc/shared';
import type { CreateGlucoseInput, FieldError, GlucoseCreateResult } from '@gc/shared';
import { Prisma } from '@prisma/client';
import { assertInScope } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { PATIENT_PUBLIC_SELECT, toListItem } from '../patient/patient.service';

/**
 * 按阈值判定数值型结果类型（0 偏低 / 1 正常 / 2 偏高）。
 *
 * 阈值暂用 @gc/shared 的 DEFAULT_ALERT_RANGE 占位常量，
 * 接口就绪后应改为读取 SystemConfig（alert.low / alert.high），禁止分散硬编码。
 */
function resolveResultType(valueMmolL: number): string {
  if (valueMmolL < DEFAULT_ALERT_RANGE.low) {
    return '0';
  }
  if (valueMmolL <= DEFAULT_ALERT_RANGE.high) {
    return '1';
  }
  return '2';
}

@Injectable()
export class GlucoseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 添加血糖（手工录入）。
   *
   * 安全约定：
   *  1. 患者必须存在、未归档、且在住院中（出院患者不录入血糖）→ 40001 / 40004；
   *  2. 数据范围走 assertInScope（PATIENT），跨科室 → 30002；
   *  3. 记录者只校验"用户存在且在职"，不校验角色/科室：
   *     操作人下拉是本科室医护（DY-OPERATOR），但系统管理员等账号不在其中，
   *     默认值（当前登录账号）不能因此被拒；审计日志仍记录真实操作人与记录者；
   *  4. 结果类型 0/1/2 一律由服务端判定，前端只能提交「检测」或 3~9。
   */
  async create(
    user: AuthenticatedUser,
    patientId: string,
    input: CreateGlucoseInput,
  ): Promise<GlucoseCreateResult> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, status: true, archivedAt: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });
    if (patient.status !== PATIENT_STATUS.INPATIENT) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }

    await this.assertOperatorExists(input.operatorId);

    const isDetect = input.resultType === GLUCOSE_ENTRY_DETECT;
    // Zod 已保证「检测」时血糖值必填，其余类型血糖值/试纸为空
    const valueMmolL = isDetect ? (input.valueMmolL as number) : null;

    const record = await this.prisma.glucoseRecord.create({
      data: {
        patientId,
        resultType: isDetect ? resolveResultType(valueMmolL as number) : input.resultType,
        valueMmolL: valueMmolL === null ? null : new Prisma.Decimal(valueMmolL.toFixed(1)),
        mealContext: input.mealContext,
        measuredAt: input.measuredAt,
        operatorId: input.operatorId,
        testStrip: isDetect ? (input.testStrip ?? null) : null,
        remark: input.remark?.trim() ? input.remark.trim() : null,
      },
      select: { id: true, resultType: true, valueMmolL: true, measuredAt: true },
    });

    const row = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: PATIENT_PUBLIC_SELECT,
    });
    if (!row) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }

    return {
      id: record.id,
      resultType: record.resultType,
      valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
      measuredAt: formatDateTime(record.measuredAt) ?? '',
      item: toListItem(row),
    };
  }

  /** 记录者必须是存在且在职的用户；否则按字段级校验错误返回 */
  private async assertOperatorExists(operatorId: string): Promise<void> {
    const operator = await this.prisma.user.findFirst({
      where: { id: operatorId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!operator) {
      const details: FieldError[] = [{ field: 'operatorId', message: '记录者不存在或已停用' }];
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }
  }
}
