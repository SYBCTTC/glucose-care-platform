import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ERROR_CODES } from '@gc/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import type { AuthenticatedUser, JwtPayload } from '../../common/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', ''),
    });
  }

  /**
   * 这里只做身份确认与权限/数据范围还原。
   *
   * 过渡说明（方案 B 落地前）：权限与数据范围仍随 JWT 下发，
   * 因此改权限需等 token 过期或重新登录；P2 将改为「JWT 只带 sub + pv，
   * 权限由服务端按 pv 缓存解析」，实现变更即时生效。
   *
   * 旧版 token 缺少 roles/dataScope 时一律要求重新登录，避免按默认值放大权限。
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    if (!payload.roles || !payload.dataScope) {
      throw new BusinessException(ERROR_CODES.SESSION_EXPIRED);
    }
    return {
      userId: payload.sub,
      username: payload.username,
      displayName: payload.displayName,
      departmentId: payload.departmentId,
      departmentName: payload.departmentName,
      permissions: payload.permissions ?? [],
      roles: payload.roles,
      dataScope: payload.dataScope,
      // 旧版 token 无此字段时按"无需改密"处理（改造前签发的 token 本就已完成首次登录）
      mustChangePassword: payload.mustChangePassword ?? false,
    };
  }
}