import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createGlucoseSchema,
  glucoseReportQuerySchema,
  patientIdSchema,
  PERMISSION,
  RESOURCE,
} from '@gc/shared';
import type { CreateGlucoseInput, GlucoseReportQuery } from '@gc/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { GlucoseService } from './glucose.service';

/**
 * 血糖记录（手工录入）。
 * 路由挂在 /patients/:id 之下：血糖永远属于某个患者，
 * 与 patient 模块共用同一套鉴权、数据范围与审计口径。
 */
@Controller('patients')
export class GlucoseController {
  constructor(private readonly glucoseService: GlucoseService) {}

  @Post(':id/glucose')
  @RequirePermissions(PERMISSION.GLUCOSE_CREATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_CREATE')
  async create(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createGlucoseSchema)) body: CreateGlucoseInput,
  ) {
    const result = await this.glucoseService.create(
      request.user as AuthenticatedUser,
      params.id,
      body,
    );
    return ok(result);
  }

  /**
   * 血糖报告（日期 × 时段矩阵，只读）。
   *
   * 权限口径：**不新增** `glucose:view`——血糖查看现状已由 `patient:view` 覆盖；
   * 挂患者下的子资源复用 `RESOURCE.PATIENT`（PERMISSION-DESIGN.md §4 裁定，虚拟病区同例）。
   *
   * 审计：查询患者血糖属敏感操作，逐次留痕（AGENTS.md §5.2）。路由含 `:id`，
   * 拦截器自动取 `params.id` 作 targetId，无需 `targetIdFrom`；detail 的
   * `rangeFrom`/`rangeTo`/`count` 由 service 回显、拦截器按既有白名单提取，**无需改白名单**。
   */
  @Get(':id/glucose/report')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_REPORT_VIEW', { targetType: 'PATIENT' })
  async report(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Query(new ZodValidationPipe(glucoseReportQuerySchema)) query: GlucoseReportQuery,
  ) {
    const result = await this.glucoseService.report(
      request.user as AuthenticatedUser,
      params.id,
      query,
    );
    return ok(result);
  }
}
