import { createHmac } from 'node:crypto';

/**
 * 患者敏感字段的确定性密文 / 脱敏工具。
 *
 * 为什么需要"确定性"：姓名筛选采用密文等值匹配，同一明文必须得到同一密文。
 * - 未配置 `PATIENT_FIELD_KEY`（本地开发）：沿用 seed 的 `enc:base64`，仅为演示，**不是加密**。
 * - 配置密钥后：使用 HMAC-SHA256 生成确定性密文，支持等值查询，但不可逆。
 *   若后续需要解密，请替换为 AES-SIV 或国密 SM4（同样具备确定性）。
 *
 * 注意：此处不使用随机 IV 的 AES-GCM/CBC——随机 IV 无法做等值查询。
 */
export function encryptDeterministic(plain: string): string {
  const key = process.env.PATIENT_FIELD_KEY;
  if (!key) {
    return `enc:${Buffer.from(plain, 'utf8').toString('base64')}`;
  }
  const digest = createHmac('sha256', key).update(plain, 'utf8').digest('base64');
  return `enc:hmac:${digest}`;
}

/** 姓名脱敏：两字及以内保留首字，三字及以上保留首尾 */
export function maskName(name: string): string {
  return name.length <= 2 ? `${name.charAt(0)}*` : `${name.charAt(0)}*${name.slice(-1)}`;
}

/** 手机号脱敏：保留前 3 后 4 */
export function maskPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '****';
}

/** 身份证脱敏：保留前 3 后 2 */
export function maskIdCard(idCard: string): string {
  return idCard.length >= 5 ? `${idCard.slice(0, 3)}********${idCard.slice(-2)}` : '********';
}
