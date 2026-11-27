import { Controller, Get, Query, Req } from '@nestjs/common';
import { glucoseAlertQuerySchema, PERMISSION, RESOURCE } from '@gc/shared';
import type { GlucoseAlertQuery } from '@gc/shared';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { GlucoseAlertService } from './glucose-alert.service';

/**
 * P4-7：跨患者血糖预警列表（住院管理-预警管理，docs/specs/glucose-alerts.md）。
 *
 * 不挂在 `/patients/:id` 下：预警是跨患者聚合视图，数据范围在查询 where 里用
 * `buildScopeWhere(PATIENT)` 收敛（科室档用户天然只见本科室；NONE 档由守卫拒 30006）。
 */
@Controller('glucose')
export class GlucoseAlertController {
  constructor(private readonly alertService: GlucoseAlertService) {}

  /**
   * 敏感查询（等保三级）：alert:view 权限 + PATIENT 数据范围 + GLUCOSE_ALERT_QUERY 审计。
   *
   * ⚠️ GLUCOSE_ALERT_QUERY 枚举迁移需**人工执行**（规格 §2，裁定 R2-Q3）：
   * 执行前接口可用，但审计行不落表（拦截器吞枚举错误，同 GLUCOSE_TREND_VIEW 先例）。
   */
  @Get('alerts')
  @RequirePermissions(PERMISSION.ALERT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_ALERT_QUERY')
  async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(glucoseAlertQuerySchema)) query: GlucoseAlertQuery,
  ) {
    const user = (request as Request & { user: AuthenticatedUser }).user;
    const result = await this.alertService.list(user, query);
    return ok(result);
  }
}
