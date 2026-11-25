import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createGlucoseSchema,
  glucosePrintSchema,
  glucoseRecordParamsSchema,
  glucoseRecordQuerySchema,
  glucoseReportQuerySchema,
  glucoseTrendQuerySchema,
  patientIdSchema,
  PERMISSION,
  RESOURCE,
} from '@gc/shared';
import type {
  CreateGlucoseInput,
  GlucosePrintInput,
  GlucoseRecordQuery,
  GlucoseReportQuery,
  GlucoseTrendQuery,
} from '@gc/shared';
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

  /**
   * R27：血糖记录列表（平铺分页，只读 + review/编辑入口，docs/specs/glucose-record.md）。
   *
   * ⚠️ 路由顺序：必须声明在 `:id/glucose/:recordId` **之前**，否则 `records` 会被 `:recordId` 捕获。
   * 权限口径同报表（`patient:view`，不新增权限点）；审计 GLUCOSE_RECORD_QUERY（裁定 Q1：
   * 独立动作，可与报表查询区分过滤），detail 的 `rangeFrom`/`rangeTo`/`count` 由 service
   * 回显、拦截器按既有白名单提取，**无需改白名单**。
   */
  @Get(':id/glucose/records')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_RECORD_QUERY', { targetType: 'PATIENT' })
  async records(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Query(new ZodValidationPipe(glucoseRecordQuerySchema)) query: GlucoseRecordQuery,
  ) {
    const result = await this.glucoseService.records(
      request.user as AuthenticatedUser,
      params.id,
      query,
    );
    return ok(result);
  }

  /**
   * P3-7：血糖趋势（原始测量点散点/折线，只读，docs/specs/glucose-trend.md）。
   *
   * ⚠️ 路由顺序：必须声明在 `:id/glucose/:recordId` **之前**，否则 `trend` 会被 `:recordId` 捕获。
   * 权限口径同报表/记录（`patient:view`，不新增权限点）；审计 GLUCOSE_TREND_VIEW（裁定：独立动作，
   * 可与报表/记录查询区分过滤）。detail 的 `rangeFrom`/`rangeTo`/`count` 由 service 回显、
   * 拦截器按既有白名单提取，**无需改白名单**。
   * ⚠️ GLUCOSE_TREND_VIEW 枚举值需人工先加进 schema.prisma 并迁移（AI 禁改 schema/migration，
   * 见 docs/specs/glucose-trend.md §11）；迁移应用前审计写入会被 PG 拒绝、拦截器吞错（接口仍正常返回）。
   */
  @Get(':id/glucose/trend')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_TREND_VIEW', { targetType: 'PATIENT' })
  async trend(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Query(new ZodValidationPipe(glucoseTrendQuerySchema)) query: GlucoseTrendQuery,
  ) {
    const result = await this.glucoseService.trend(
      request.user as AuthenticatedUser,
      params.id,
      query,
    );
    return ok(result);
  }

  /**
   * R28：血糖数据打印留痕（POST，纯留痕端点，docs/specs/glucose-print.md）。
   *
   * 前端在预览 Modal 点「打印」时调用，成功后才触发 `window.print`（裁定 Q11：
   * 浏览器无法感知是否实际出纸，以点击为准；打开预览不记）。不生成文件、不返回血糖数据。
   * 权限 `glucose:print`（裁定 Q5/A3，独立权限点）；审计 GLUCOSE_PRINT（裁定 Q10：
   * 单一动作，detail.printType 区分 report/record/trend），`rangeFrom`/`rangeTo`/`count`
   * 走既有白名单，`printType` 需登记 AUDIT_DETAIL_ALLOW_LIST（先例 mealContexts）。
   */
  @Post(':id/glucose/print')
  @RequirePermissions(PERMISSION.GLUCOSE_PRINT)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_PRINT', { targetType: 'PATIENT' })
  async print(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Body(new ZodValidationPipe(glucosePrintSchema)) body: GlucosePrintInput,
  ) {
    const result = await this.glucoseService.print(
      request.user as AuthenticatedUser,
      params.id,
      body,
    );
    return ok(result);
  }

  /**
   * R25：单条血糖详情（review/编辑弹框回填）。
   *
   * ⚠️ 路由顺序：必须声明在 `:id/glucose/report` **之后**，否则 `report` 会被 `:recordId` 捕获。
   * 权限：`patient:view` 即可读（裁定 Q9：无编辑权限者也能点开只读 review）。
   * 审计：**不挂 @Audit**（裁定 Q4）——报表查询已按患者逐条留痕，点击编辑再留属重复噪音；
   * 数据范围照常校验（service 内 assertPatientReadable）。
   */
  @Get(':id/glucose/:recordId')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  async detail(
    @Req() request: Request,
    @Param(new ZodValidationPipe(glucoseRecordParamsSchema))
    params: { id: string; recordId: string },
  ) {
    const result = await this.glucoseService.detail(
      request.user as AuthenticatedUser,
      params.id,
      params.recordId,
    );
    return ok(result);
  }

  /**
   * R25：编辑血糖。请求体复用 `createGlucoseSchema`（字段与校验和添加完全一致，不造第二份契约）。
   * 审计 GLUCOSE_UPDATE：targetId 取 `params.id`（患者），detail 的 `changedFields`
   * 由 service 回显、拦截器按既有白名单提取（只记字段名，裁定 Q5）。
   */
  @Patch(':id/glucose/:recordId')
  @RequirePermissions(PERMISSION.GLUCOSE_UPDATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_UPDATE', { targetType: 'PATIENT' })
  async update(
    @Req() request: Request,
    @Param(new ZodValidationPipe(glucoseRecordParamsSchema))
    params: { id: string; recordId: string },
    @Body(new ZodValidationPipe(createGlucoseSchema)) body: CreateGlucoseInput,
  ) {
    const result = await this.glucoseService.update(
      request.user as AuthenticatedUser,
      params.id,
      params.recordId,
      body,
    );
    return ok(result);
  }

  /**
   * R25：作废血糖（软删除，裁定 Q1a）。HTTP 语义用 DELETE，实现是置 voidedAt/voidedById，
   * **不物理删行**（医疗记录不得物理删除，等保三级）。
   * 权限 `glucose:delete` 仅护士长/系统管理员（裁定 Q8）。
   * 审计 GLUCOSE_VOID：detail 记 `glucoseRecordId`（白名单新增，先例 wardRecordId）。
   */
  @Delete(':id/glucose/:recordId')
  @RequirePermissions(PERMISSION.GLUCOSE_DELETE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_VOID', { targetType: 'PATIENT' })
  async voidRecord(
    @Req() request: Request,
    @Param(new ZodValidationPipe(glucoseRecordParamsSchema))
    params: { id: string; recordId: string },
  ) {
    const result = await this.glucoseService.voidRecord(
      request.user as AuthenticatedUser,
      params.id,
      params.recordId,
    );
    return ok(result);
  }
}
