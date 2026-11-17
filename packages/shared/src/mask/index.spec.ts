import { describe, expect, it } from 'vitest';
import { maskIdCard, maskName, maskPatientNo, maskPhone } from './index';

/**
 * 脱敏是全仓唯一实现（2026-11-17 起 `apps/server` 的 `field-crypto` 不再自带副本）。
 *
 * 两条不变量比逐个样例更重要，任何改动都必须守住：
 *  1. **绝不回显完整原值**——原 `safeMask` 在长度恰等于 keepHead+keepTail 时星号数为 0，
 *     `maskPhone('1380000')` 直接返回 `'1380000'`，等于没脱敏；
 *  2. **输出长度等于输入长度**——原 `field-crypto` 的实现对短输入会拼出更长的串
 *     （`maskIdCard('12345')` → `'123********45'`），既泄漏头尾又让界面错位。
 */
describe('mask — 通用不变量', () => {
  const samples = [
    ['张三', maskName],
    ['张三丰', maskName],
    ['欧阳明', maskName],
    ['李', maskName],
    ['110101199003074512', maskIdCard],
    ['12345', maskIdCard],
    ['13800001234', maskPhone],
    ['1380000', maskPhone],
    ['138000', maskPhone],
    ['P2026000001', maskPatientNo],
    ['123456', maskPatientNo],
    ['12345', maskPatientNo],
  ] as const;

  it.each(samples)('%s 脱敏后不等于原值', (raw, fn) => {
    const masked = fn(raw);
    expect(masked).not.toBe(raw);
    expect(masked).toContain('*');
  });

  it.each(samples)('%s 脱敏后长度不变', (raw, fn) => {
    expect(fn(raw)).toHaveLength(raw.length);
  });

  it('空值与纯空白返回空串，不抛错', () => {
    for (const fn of [maskName, maskIdCard, maskPhone, maskPatientNo]) {
      expect(fn('')).toBe('');
      expect(fn('   ')).toBe('');
      expect(fn(null)).toBe('');
      expect(fn(undefined)).toBe('');
    }
  });

  it('首尾空白先 trim 再脱敏', () => {
    expect(maskPhone('  13800001234  ')).toBe('138****1234');
  });
});

describe('maskName', () => {
  it('单字姓：保留姓，名字全遮（不保留末字）', () => {
    expect(maskName('张三')).toBe('张*');
    expect(maskName('张三丰')).toBe('张**');
    expect(maskName('爱新觉罗玄烨')).toBe('爱*****');
  });

  it('复姓：保留前两字', () => {
    expect(maskName('欧阳明')).toBe('欧阳*');
    expect(maskName('欧阳娜娜')).toBe('欧阳**');
    expect(maskName('司马懿')).toBe('司马*');
    expect(maskName('诸葛亮')).toBe('诸葛*');
    expect(maskName('上官婉儿')).toBe('上官**');
  });

  it('两个单字姓连写不会被误判为复姓', () => {
    // 原实现用百家姓单字字符集重复两次判复姓，会把这类名字误判
    expect(maskName('黄王明')).toBe('黄**');
    expect(maskName('于时雨')).toBe('于**');
  });

  it('遮掩后等于原值时改为全遮（单字名、复姓本身）', () => {
    expect(maskName('李')).toBe('*');
    expect(maskName('欧阳')).toBe('**');
  });
});

describe('maskIdCard', () => {
  it('保留前 3 后 4', () => {
    expect(maskIdCard('110101199003074512')).toBe('110***********4512');
    expect(maskIdCard('11010119900307451X')).toBe('110***********451X');
  });

  it('长度不足时全遮，不泄漏头尾', () => {
    expect(maskIdCard('1234567')).toBe('*******');
    expect(maskIdCard('12345')).toBe('*****');
  });
});

describe('maskPhone', () => {
  it('11 位手机号保留前 3 后 4', () => {
    expect(maskPhone('13800001234')).toBe('138****1234');
  });

  it('长度恰好等于保留位数时全遮（原实现会原样回显）', () => {
    expect(maskPhone('1380000')).toBe('*******');
  });

  it('短于最小长度时全遮', () => {
    expect(maskPhone('138000')).toBe('******');
  });
});

describe('maskPatientNo', () => {
  it('保留后 4 位', () => {
    expect(maskPatientNo('P2026000001')).toBe('*******0001');
    expect(maskPatientNo('123456')).toBe('**3456');
  });

  it('长度不足时全遮', () => {
    expect(maskPatientNo('12345')).toBe('*****');
  });
});
