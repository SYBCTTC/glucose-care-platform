import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPasswordStrength } from './password';

/**
 * 账号安全契约（前后端共享）。
 * 密码策略依据等保三级"身份鉴别"要求，规则实现见 `./password`，此处只做契约包装。
 */

/** 密码强度：≥8 位，且小写/大写/数字/符号四类至少命中三项 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(PASSWORD_MAX_LENGTH, `密码最多 ${PASSWORD_MAX_LENGTH} 位`)
  .superRefine((value, ctx) => {
    const result = checkPasswordStrength(value);
    if (!result.passed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.reasons[0] });
    }
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, '请输入用户名').max(64, '用户名过长'),
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, '请输入原密码'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 登录成功返回的用户信息 */
export interface AuthProfile {
  id: string;
  username: string;
  displayName: string;
  departmentId: string | null;
  departmentName: string | null;
  roles: string[];
  permissions: string[];
}

export interface LoginResult {
  accessToken: string;
  /** 令牌有效期（秒），前端用于会话超时提示 */
  expiresIn: number;
  profile: AuthProfile;
}
