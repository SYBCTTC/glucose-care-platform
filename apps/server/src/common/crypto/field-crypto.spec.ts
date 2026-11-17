import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFieldCryptoReady,
  cipherSchemeOf,
  decryptField,
  encryptDeterministic,
  isFieldCryptoConfigured,
  maskIdCard,
  maskName,
  maskPhone,
} from './field-crypto';

/**
 * 患者敏感字段加密。
 *
 * 重点回归一：**确定性**——患者列表的姓名筛选靠密文等值匹配
 * （`where.nameCipher = encryptDeterministic(query.name)`），
 * 同明文必须得到同密文，否则搜索功能直接失效。
 * 重点回归二：**可逆**——这是从 HMAC 换成 AES 的主要收益，解密必须能还原明文。
 * 重点回归三：**不静默失败**——解密不了时返回 null 并留日志，
 * 绝不抛错让列表接口 500，也绝不返回错误的明文。
 */

const AES_PREFIX = 'enc:aes256gcm:v1:';
const KEY_A = 'test-key-a-0123456789-0123456789-abcdef';
const KEY_B = 'test-key-b-9876543210-9876543210-fedcba';

/** 真实形态的敏感字段样本（均为虚构演示数据） */
const SAMPLES = [
  { label: '两字姓名', value: '张三' },
  { label: '三字姓名', value: '欧阳明' },
  { label: '四字姓名', value: '司徒雷登' },
  { label: '手机号', value: '13800001234' },
  { label: '18 位身份证', value: '110101199003074512' },
  { label: '含生僻字', value: '䶮龘' },
  { label: '单字符', value: 'A' },
];

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.PATIENT_FIELD_KEY;
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.PATIENT_FIELD_KEY;
  } else {
    process.env.PATIENT_FIELD_KEY = originalKey;
  }
  vi.restoreAllMocks();
});

function setKey(key: string | undefined): void {
  if (key === undefined) {
    delete process.env.PATIENT_FIELD_KEY;
  } else {
    process.env.PATIENT_FIELD_KEY = key;
  }
}

/** 翻转密文负载的最后一个字节，模拟传输/存储损坏或人为篡改 */
function tamper(stored: string): string {
  const blob = Buffer.from(stored.slice(AES_PREFIX.length), 'base64');
  blob[blob.length - 1] ^= 0xff;
  return AES_PREFIX + blob.toString('base64');
}

describe('field-crypto — 配置了密钥（AES-256-GCM）', () => {
  beforeEach(() => {
    setKey(KEY_A);
  });

  it('isFieldCryptoConfigured 为 true，密文带版本前缀', () => {
    expect(isFieldCryptoConfigured()).toBe(true);
    expect(encryptDeterministic('张三')).toMatch(new RegExp(`^${AES_PREFIX.replace(/[.]/g, '\\.')}`));
    expect(cipherSchemeOf(encryptDeterministic('张三'))).toBe('aes');
  });

  it.each(SAMPLES)('确定性：$label 连加密两次结果完全相同', ({ value }) => {
    expect(encryptDeterministic(value)).toBe(encryptDeterministic(value));
  });

  it.each(SAMPLES)('可逆：$label 解密还原明文', ({ value }) => {
    expect(decryptField(encryptDeterministic(value))).toBe(value);
  });

  it('不同明文密文不同（不会退化成恒定值）', () => {
    const a = encryptDeterministic('张三');
    const b = encryptDeterministic('李四');
    expect(a).not.toBe(b);
  });

  it('密文与密钥绑定：换密钥后同一明文密文不同', () => {
    const withA = encryptDeterministic('张三');
    setKey(KEY_B);
    const withB = encryptDeterministic('张三');

    expect(withA).not.toBe(withB);
  });

  it('密文长度远小于 VarChar(512) 上限', () => {
    for (const { value } of SAMPLES) {
      expect(encryptDeterministic(value).length).toBeLessThan(512);
    }
    // 最长的 18 位身份证也留足余量
    expect(encryptDeterministic('110101199003074512').length).toBeLessThan(160);
  });

  it('密文被篡改 → GCM 校验失败，返回 null 且不抛错', () => {
    const stored = encryptDeterministic('13800001234');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => decryptField(tamper(stored))).not.toThrow();
    expect(decryptField(tamper(stored))).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('用另一把密钥解密 → 返回 null（不返回错误明文）', () => {
    const stored = encryptDeterministic('欧阳明');
    setKey(KEY_B);

    expect(decryptField(stored)).toBeNull();
  });

  it('密文被截断 → 返回 null，不抛错', () => {
    expect(decryptField(`${AES_PREFIX}c2hvcnQ=`)).toBeNull();
  });

  it('历史 HMAC 密文不可逆 → 返回 null 并留警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(decryptField('enc:hmac:YWJjZGVmZ2hpamtsbW5vcA==')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('密文是 AES 方案但运行时丢了密钥 → 返回 null', () => {
    const stored = encryptDeterministic('张三');
    setKey(undefined);

    expect(decryptField(stored)).toBeNull();
  });
});

describe('field-crypto — 未配置密钥（开发兜底）', () => {
  beforeEach(() => {
    setKey(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('isFieldCryptoConfigured 为 false，退回 enc:base64 且仍可解回明文', () => {
    expect(isFieldCryptoConfigured()).toBe(false);

    const stored = encryptDeterministic('张三');

    expect(stored).toBe(`enc:${Buffer.from('张三', 'utf8').toString('base64')}`);
    expect(cipherSchemeOf(stored)).toBe('legacy');
    expect(decryptField(stored)).toBe('张三');
  });

  it('密钥为空白串视同未配置', () => {
    setKey('   ');

    expect(isFieldCryptoConfigured()).toBe(false);
    expect(cipherSchemeOf(encryptDeterministic('张三'))).toBe('legacy');
  });

  it('assertFieldCryptoReady：生产环境抛错拒绝启动', () => {
    expect(() => assertFieldCryptoReady('production')).toThrow(/PATIENT_FIELD_KEY/);
  });

  it.each([['development'], ['test'], [undefined]])('assertFieldCryptoReady：%s 只警告不抛错', (env) => {
    expect(() => assertFieldCryptoReady(env)).not.toThrow();
  });
});

describe('field-crypto — 解密对异常输入不抛错', () => {
  beforeEach(() => {
    setKey(KEY_A);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空串', ''],
  ])('%s → null', (_label, input) => {
    expect(decryptField(input)).toBeNull();
  });

  it('无法识别的前缀 → null', () => {
    expect(decryptField('plaintext-张三')).toBeNull();
    expect(cipherSchemeOf('plaintext-张三')).toBe('unknown');
  });

  it('cipherSchemeOf 对空值返回 empty', () => {
    expect(cipherSchemeOf(null)).toBe('empty');
    expect(cipherSchemeOf('')).toBe('empty');
  });
});

describe('field-crypto — 启动自检在密钥就绪时放行', () => {
  it('配置了密钥则任何环境都不抛错', () => {
    setKey(KEY_A);

    expect(() => assertFieldCryptoReady('production')).not.toThrow();
    expect(() => assertFieldCryptoReady('development')).not.toThrow();
  });
});

describe('field-crypto — 脱敏规则（未改动，防回归）', () => {
  it.each([
    ['张三', '张*'],
    ['李', '李*'],
    ['欧阳明', '欧*明'],
    ['司徒雷登', '司*登'],
  ])('maskName(%s) = %s', (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });

  it.each([
    ['13800001234', '138****1234'],
    ['123456', '****'],
  ])('maskPhone(%s) = %s', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });

  it.each([
    ['110101199003074512', '110********12'],
    ['1234', '********'],
  ])('maskIdCard(%s) = %s', (input, expected) => {
    expect(maskIdCard(input)).toBe(expected);
  });

  it('脱敏值不含完整明文（等保：列表默认脱敏）', () => {
    const idCard = '110101199003074512';

    expect(maskIdCard(idCard)).not.toContain('19900307');
    expect(maskPhone('13800001234')).not.toContain('00001234');
  });
});
