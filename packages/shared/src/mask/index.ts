/**
 * 患者敏感字段脱敏（等保三级要求）。
 *
 * 约定：
 * 1. 列表/详情默认只返回脱敏值，完整值需单独接口 + 权限点 + 审计留痕；
 * 2. 脱敏规则前后端共用，避免前端漏脱敏导致密文/明文出现在界面上；
 * 3. 入参为空或过短时按"全遮掩"处理，绝不回显原始值。
 */

const MASK = '*';

function safeMask(value: string, keepHead: number, keepTail: number, minLength: number): string {
  const raw = value.trim();
  if (!raw) {
    return '';
  }
  if (raw.length < minLength) {
    return MASK.repeat(raw.length);
  }
  const head = raw.slice(0, keepHead);
  const tail = keepTail > 0 ? raw.slice(-keepTail) : '';
  return `${head}${MASK.repeat(raw.length - keepHead - keepTail)}${tail}`;
}

/** 身份证号：320***********1234（保留前 3 后 4） */
export function maskIdCard(value?: string | null): string {
  if (!value) {
    return '';
  }
  return safeMask(value, 3, 4, 8);
}

/** 手机号/联系方式：138****1234（保留前 3 后 4） */
export function maskPhone(value?: string | null): string {
  if (!value) {
    return '';
  }
  return safeMask(value, 3, 4, 7);
}

/** 姓名：张*（保留姓氏）；复姓保留前两字 */
export function maskName(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) {
    return '';
  }
  if (raw.length <= 1) {
    return raw;
  }
  const keep = /^[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹]{2}/.test(
    raw,
  )
    ? 2
    : 1;
  return `${raw.slice(0, keep)}${MASK.repeat(raw.length - keep)}`;
}

/** 住院号/门诊号：保留后 4 位 */
export function maskPatientNo(value?: string | null): string {
  if (!value) {
    return '';
  }
  return safeMask(value, 0, 4, 6);
}
