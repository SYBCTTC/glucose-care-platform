import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ERROR_CODES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  checkPasswordStrength,
  formatDateTime,
  resolveDataScope,
} from '@gc/shared';
import type { PermissionCode, RoleCode } from '@gc/shared';
import * as bcrypt from 'bcryptjs';
import dayjs from 'dayjs';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser, JwtPayload, UserProfile } from '../../common/types';
import type { ChangePasswordInput, LoginInput } from './auth.dto';

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

const VALID_ROLE_CODES = new Set<string>(Object.keys(ROLE_LABELS));
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: LoginInput, ctx: RequestContext) {
    const maxFailedAttempts = Number(this.config.get('LOGIN_MAX_FAILED_ATTEMPTS', 5));
    const lockMinutes = Number(this.config.get('LOGIN_LOCK_MINUTES', 30));
    const windowStart = dayjs().subtract(lockMinutes, 'minute').toDate();

    // 登录失败次数从审计日志统计（复用审计表，避免新增表）
    const failedAttempts = await this.prisma.auditLog.count({
      where: {
        action: 'LOGIN_FAILED',
        targetKey: input.username,
        createdAt: { gte: windowStart },
      },
    });
    if (failedAttempts >= maxFailedAttempts) {
      throw new BusinessException(
        ERROR_CODES.ACCOUNT_LOCKED,
        `密码错误次数过多，账号已临时锁定 ${lockMinutes} 分钟，请联系系统管理员`,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { username: input.username },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    });

    const passwordMatched = user
      ? await bcrypt.compare(input.password, user.passwordHash)
      : false;

    if (!user || !passwordMatched) {
      await this.prisma.auditLog.create({
        data: {
          action: 'LOGIN_FAILED',
          targetType: 'USERNAME',
          targetKey: input.username,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          result: 'FAILED',
          detail: { reason: 'invalid_credentials' },
        },
      });
      // 统一提示，不暴露"用户名存在"信息
      throw new BusinessException(ERROR_CODES.INVALID_CREDENTIALS);
    }

    if (user.status !== 'ACTIVE') {
      throw new BusinessException(ERROR_CODES.ACCOUNT_DISABLED);
    }

    const permissions = resolvePermissions(user.roles.map((item) => item.role.code));
    const roles = resolveRoles(user.roles.map((item) => item.role.code));
    const dataScope = resolveDataScope(roles);
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      displayName: user.name,
      departmentId: user.departmentId,
      departmentName: user.department.name,
      permissions,
      roles,
      dataScope,
      mustChangePassword: user.mustChangePassword,
    };

    const [accessToken] = await Promise.all([
      this.jwt.signAsync(payload),
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          operatorId: user.id,
          operatorName: user.name,
          departmentId: user.departmentId,
          action: 'LOGIN',
          targetType: 'USER',
          targetId: user.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          result: 'SUCCESS',
        },
      }),
    ]);

    const profile: AuthenticatedUser = {
      ...payload,
      userId: payload.sub,
      permissionVersion: user.updatedAt.toISOString(),
    };
    return { accessToken, expiresAt: this.resolveExpiresAt(), profile };
  }

  /** token 过期时间，供前端做到期提示与静默续期判断 */
  private resolveExpiresAt(): string {
    const raw = String(this.config.get('JWT_EXPIRES_IN', '30m'));
    const matched = /^(\d+)\s*([mhd])$/.exec(raw.trim());
    if (!matched) {
      return dayjs().add(30, 'minute').toISOString();
    }
    const unit = matched[2] === 'm' ? 'minute' : matched[2] === 'h' ? 'hour' : 'day';
    return dayjs().add(Number(matched[1]), unit).toISOString();
  }

  async logout(user: AuthenticatedUser, ctx: RequestContext): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        operatorId: user.userId,
        operatorName: user.displayName,
        departmentId: user.departmentId,
        action: 'LOGOUT',
        targetType: 'USER',
        targetId: user.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        result: 'SUCCESS',
      },
    });
  }

  /** 当前登录用户信息（含权限点，前端用于菜单与按钮显隐） */
  async profile(user: AuthenticatedUser): Promise<UserProfile> {
    const fresh = await this.prisma.user.findUnique({
      where: { id: user.userId },
      include: {
        department: true,
        roles: { include: { role: true } },
      },
    });
    if (!fresh || fresh.status !== 'ACTIVE') {
      throw new BusinessException(ERROR_CODES.SESSION_EXPIRED);
    }
    return {
      userId: fresh.id,
      username: fresh.username,
      displayName: fresh.name,
      departmentId: fresh.departmentId,
      departmentName: fresh.department.name,
      permissions: resolvePermissions(fresh.roles.map((item) => item.role.code)),
      roles: resolveRoles(fresh.roles.map((item) => item.role.code)),
      dataScope: resolveDataScope(fresh.roles.map((item) => item.role.code)),
      mustChangePassword: fresh.mustChangePassword,
      permissionVersion: fresh.updatedAt.toISOString(),
      lastLoginAt: formatDateTime(fresh.lastLoginAt),
    };
  }

  /**
   * 修改密码（含首次登录强制修改）。
   *
   * 已知遗留：改密后旧 JWT 无法立即失效（令牌不含权限版本），
   * 由前端主动登出兜底；P2 的 `pv` 机制落地后服务端即可强制作废（见 docs/ROADMAP.md）。
   * 缓解：强制改密期间签发的令牌 `mustChangePassword = true`，
   * 旧令牌即使被复用也会被 `MustChangePasswordGuard` 拦在业务接口之外。
   */
  async changePassword(user: AuthenticatedUser, input: ChangePasswordInput): Promise<void> {
    const fresh = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!fresh || fresh.status !== 'ACTIVE') {
      throw new BusinessException(ERROR_CODES.SESSION_EXPIRED);
    }

    if (!(await bcrypt.compare(input.oldPassword, fresh.passwordHash))) {
      throw new BusinessException(ERROR_CODES.WRONG_CURRENT_PASSWORD);
    }

    const strength = checkPasswordStrength(input.newPassword, {
      forbidden: [fresh.username, fresh.name],
    });
    if (!strength.passed) {
      throw new BusinessException(ERROR_CODES.WEAK_PASSWORD, strength.reasons[0]);
    }

    if (await bcrypt.compare(input.newPassword, fresh.passwordHash)) {
      throw new BusinessException(ERROR_CODES.PASSWORD_REUSE);
    }

    await this.prisma.user.update({
      where: { id: fresh.id },
      data: {
        passwordHash: bcrypt.hashSync(input.newPassword, BCRYPT_ROUNDS),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
  }
}

/** 从角色码展开权限点；非法角色码直接忽略，避免脏数据扩大权限 */
export function resolvePermissions(roleCodes: string[]): PermissionCode[] {
  const permissions = new Set<PermissionCode>();
  for (const code of roleCodes) {
    if (!VALID_ROLE_CODES.has(code)) {
      continue;
    }
    for (const permission of ROLE_PERMISSIONS[code as RoleCode] ?? []) {
      permissions.add(permission);
    }
  }
  return [...permissions];
}

/** 保留合法角色码；非法角色码直接丢弃（与权限展开同一套白名单） */
export function resolveRoles(roleCodes: string[]): RoleCode[] {
  return roleCodes.filter((code): code is RoleCode => VALID_ROLE_CODES.has(code));
}