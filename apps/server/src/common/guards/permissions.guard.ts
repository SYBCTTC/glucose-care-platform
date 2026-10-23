import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@gc/shared';
import type { PermissionCode } from '@gc/shared';
import { BusinessException } from '../exceptions/business.exception';
import type { AuthenticatedUser } from '../types';

export const PERMISSIONS_KEY = 'auth:permissions';

/** 声明访问该接口所需的权限点（任一满足即可） */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * 权限守卫。注意：
 * 前端隐藏按钮只是体验，真正的安全边界在这里与 service 的数据权限过滤。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionCode[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new BusinessException(ERROR_CODES.SESSION_EXPIRED);
    }
    const allowed = required.some((permission) => user.permissions.includes(permission));
    if (!allowed) {
      // 精确到权限点，便于前端提示"缺少 XX 权限"
      throw new BusinessException(ERROR_CODES.MISSING_PERMISSION);
    }
    return true;
  }
}