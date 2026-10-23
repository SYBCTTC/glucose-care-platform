import { describe, expect, it } from 'vitest';
import { checkPasswordStrength } from './password';

describe('checkPasswordStrength', () => {
  it('四类全含通过', () => {
    expect(checkPasswordStrength('Gc@2026pass').passed).toBe(true);
  });

  it('恰好三类通过（小写+大写+数字）', () => {
    const result = checkPasswordStrength('Abcdefg123');
    expect(result.passed).toBe(true);
    expect(result.categories).toBe(3);
  });

  it('仅两类（字母+数字）不通过', () => {
    const result = checkPasswordStrength('abcdefg123');
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain('至少 3 项');
  });

  it('长度不足 8 位不通过', () => {
    const result = checkPasswordStrength('Ab1@c');
    expect(result.passed).toBe(false);
    expect(result.reasons.some((item) => item.includes('至少 8 位'))).toBe(true);
  });

  it('超过 64 位不通过', () => {
    expect(checkPasswordStrength('Ab1@'.repeat(30)).passed).toBe(false);
  });

  it('包含用户名不通过（大小写不敏感）', () => {
    // "drwang@2026" 不含完整用户名 "dr.wang"，应通过
    expect(checkPasswordStrength('drwang@2026', { forbidden: ['dr.wang'] }).passed).toBe(true);
    // 含完整用户名（大小写不敏感）应拒绝
    expect(checkPasswordStrength('Dr.Wang@2026', { forbidden: ['dr.wang'] }).passed).toBe(false);
    expect(checkPasswordStrength('Abc王医生123', { forbidden: ['王医生'] }).passed).toBe(false);
  });

  it('空密码不通过', () => {
    expect(checkPasswordStrength('').passed).toBe(false);
  });
});
