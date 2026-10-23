import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Audit } from '../../common/decorators/audit.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { AuthService } from './auth.service';
import { changePasswordSchema, loginSchema } from './auth.dto';
import type { ChangePasswordInput, LoginInput } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
  ) {
    const result = await this.authService.login(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return ok(result);
  }

  @Post('logout')
  async logout(@Req() request: Request) {
    await this.authService.logout(request.user as AuthenticatedUser, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return ok(null);
  }

  @Get('profile')
  async profile(@Req() request: Request) {
    return ok(await this.authService.profile(request.user as AuthenticatedUser));
  }

  /**
   * 修改密码（首次登录强制修改与主动修改共用）。
   * 成功后前端必须主动登出并用新密码重新登录。
   */
  @Post('change-password')
  @Audit('PASSWORD_CHANGE')
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() request: Request,
  ) {
    await this.authService.changePassword(request.user as AuthenticatedUser, body);
    return ok(null);
  }
}