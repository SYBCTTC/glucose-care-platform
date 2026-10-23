/**
 * 密码强度策略（等保三级「身份鉴别」）。
 *
 * 规则（院方口径）：长度 8–64，且包含小写字母、大写字母、数字、特殊符号中的**至少三项**，
 * 且不得包含用户名或姓名。前后端共用同一实现，避免两套口径。
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
/** 四类字符中至少命中的类别数 */
export const PASSWORD_REQUIRED_CATEGORIES = 3;

export const PASSWORD_RULE_TEXT = `至少 ${PASSWORD_MIN_LENGTH} 位，且包含小写字母、大写字母、数字、特殊符号中的至少三项，且不能包含用户名`;

export interface PasswordCheckOptions {
  /** 禁止包含的片段（如用户名、姓名），大小写不敏感 */
  forbidden?: Array<string | null | undefined>;
}

export interface PasswordCheckResult {
  passed: boolean;
  /** 命中的字符类别数：小写 / 大写 / 数字 / 符号 */
  categories: number;
  /** 不满足的原因（中文，直接面向用户） */
  reasons: string[];
}

const CATEGORY_TESTS: Array<{ label: string; test: RegExp }> = [
  { label: '小写字母', test: /[a-z]/ },
  { label: '大写字母', test: /[A-Z]/ },
  { label: '数字', test: /\d/ },
  { label: '特殊符号', test: /[^A-Za-z0-9]/ },
];

export function checkPasswordStrength(
  password: string,
  options: PasswordCheckOptions = {},
): PasswordCheckResult {
  const value = password ?? '';
  const reasons: string[] = [];

  if (value.length < PASSWORD_MIN_LENGTH) {
    reasons.push(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    reasons.push(`密码最多 ${PASSWORD_MAX_LENGTH} 位`);
  }

  const categories = CATEGORY_TESTS.filter((item) => item.test.test(value)).length;
  if (categories < PASSWORD_REQUIRED_CATEGORIES) {
    reasons.push(`密码需包含小写字母、大写字母、数字、特殊符号中的至少 ${PASSWORD_REQUIRED_CATEGORIES} 项`);
  }

  for (const forbidden of options.forbidden ?? []) {
    if (forbidden && forbidden.length > 0 && value.toLowerCase().includes(forbidden.toLowerCase())) {
      reasons.push('密码不能包含用户名或姓名');
      break;
    }
  }

  return { passed: reasons.length === 0, categories, reasons };
}
