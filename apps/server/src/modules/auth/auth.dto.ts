/**
 * 账号相关入参契约统一从共享包导出，避免前后端两套口径。
 */
export { changePasswordSchema, loginSchema, passwordSchema } from '@gc/shared';
export type { ChangePasswordInput, LoginInput } from '@gc/shared';
