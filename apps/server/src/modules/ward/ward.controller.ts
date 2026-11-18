import { Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { patientIdSchema, PERMISSION, RESOURCE, wardListQuerySchema } from '@gc/shared';
import type { WardListQuery } from '@gc/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok, page } from '../../common/utils/response';
import { WardService } from './ward.service';

/**
 * 虚拟病区。
 *
 * 路由前缀 `/ward`，与前端路由 `/inpatient/ward`、权限点 `ward:*` 命名一致。
 * 三个接口都标 `@RequireDataScope(RESOURCE.PATIENT)`：数据权限**沿用患者域**，
 * 不新增资源类型，因此 `scope.util.ts` 与 `ROLE_DATA_SCOPE` 一字未改，
 * 设备管理员（NONE 档）自动被拒 30006。
 *
 * ⚠️ 路径参数必须叫 `:id`：`AuditLogInterceptor` 只从 `params.id` 取审计对象 ID，
 * 叫别的名字（如 `:patientId`）会让 `targetId` 恒为空——**包括越权 DENIED 行**，
 * 事后无法按患者追溯。`targetIdFrom` 也救不了，它只在成功路径生效。
 */
@Controller('ward')
export class WardController {
  constructor(private readonly wardService: WardService) {}

  /**
   * 当前 / 历史虚拟病区列表，由 `tab` 区分。
   * 不记审计：与 `GET /patients/inpatient` 一致，列表只出脱敏值、非敏感查询。
   */
  @Get('patients')
  @RequirePermissions(PERMISSION.WARD_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  async list(
    @Req() request: Request,
    @Query(new ZodValidationPipe(wardListQuerySchema)) query: WardListQuery,
  ) {
    const result = await this.wardService.list(request.user as AuthenticatedUser, query);
    return page(result.items, result.total, query.page, query.pageSize);
  }

  /**
   * 加入虚拟病区。历史 Tab 的「加入虚拟病区」（= 重新加入）走同一接口，
   * 新建一条记录、旧历史行保留（决策 7a）。
   */
  @Post('patients/:id')
  @RequirePermissions(PERMISSION.WARD_MANAGE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_WARD_JOIN', { targetType: 'PATIENT' })
  async join(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.wardService.join(request.user as AuthenticatedUser, params.id);
    return ok(result);
  }

  /** 移出虚拟病区。不校验患者状态：出院患者也应能被移出 */
  @Delete('patients/:id')
  @RequirePermissions(PERMISSION.WARD_MANAGE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_WARD_REMOVE', { targetType: 'PATIENT' })
  async leave(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.wardService.leave(request.user as AuthenticatedUser, params.id);
    return ok(result);
  }
}
