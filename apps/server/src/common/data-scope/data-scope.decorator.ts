import { SetMetadata } from '@nestjs/common';
import type { ResourceType } from '@gc/shared';

export const DATA_SCOPE_KEY = 'auth:dataScope';

/**
 * 声明该接口涉及的数据资源类型，数据范围由 `buildScopeWhere` 统一施加。
 *
 * 用法：
 * ```ts
 * @Get('patients')
 * @RequirePermissions(PERMISSION.PATIENT_VIEW)
 * @RequireDataScope(RESOURCE.PATIENT)
 * async list(@Req() req) { ... }
 * ```
 *
 * 说明：本装饰器本身不拦截请求（数据过滤发生在 service 层），
 * 它的作用是**声明式登记资源类型**，让数据权限可被集中审计与检索，
 * 避免"某个接口忘了加科室过滤"这类漏网问题。
 */
export const RequireDataScope = (resource: ResourceType) => SetMetadata(DATA_SCOPE_KEY, resource);
