import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertFieldCryptoReady,
  cipherSchemeOf,
  decryptField,
  decryptWithKey,
  encryptDeterministic,
  encryptWithKey,
  isFieldCryptoConfigured,
  keyFingerprint,
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

describe('field-crypto — 换密钥（re-key）原语', () => {
  beforeEach(() => {
    // 故意把环境变量设成第三把钥：encryptWithKey/decryptWithKey 必须**只**认显式传入的密钥，
    // 若偷偷回落到 process.env，re-key 就会用错钥加密，存量数据当场损毁。
    setKey('test-key-env-should-not-be-used-000000');
  });

  it.each(SAMPLES)('往返：$label 用指定密钥加密后可用同一把钥解回', ({ value }) => {
    expect(decryptWithKey(encryptWithKey(value, KEY_A), KEY_A)).toBe(value);
  });

  it.each(SAMPLES)('确定性：$label 同一把钥连加密两次结果相同', ({ value }) => {
    expect(encryptWithKey(value, KEY_A)).toBe(encryptWithKey(value, KEY_A));
  });

  it('密钥隔离：A 钥密文用 B 钥解 → null，绝不返回错误明文', () => {
    const stored = encryptWithKey('欧阳明', KEY_A);

    expect(decryptWithKey(stored, KEY_B)).toBeNull();
  });

  it('显式密钥优先于环境变量：结果不受 PATIENT_FIELD_KEY 影响', () => {
    const stored = encryptWithKey('张三', KEY_A);
    setKey(KEY_B);

    expect(encryptWithKey('张三', KEY_A)).toBe(stored);
    expect(decryptWithKey(stored, KEY_A)).toBe('张三');
  });

  it('完整换钥链路：A 加密 → A 解密 → B 加密 → B 解密，明文无损', () => {
    for (const { value } of SAMPLES) {
      const underA = encryptWithKey(value, KEY_A);
      const plain = decryptWithKey(underA, KEY_A);
      expect(plain).toBe(value);

      const underB = encryptWithKey(plain as string, KEY_B);
      expect(underB).not.toBe(underA);
      expect(decryptWithKey(underB, KEY_B)).toBe(value);
      // 换钥后旧钥必须失效，否则等于没换
      expect(decryptWithKey(underB, KEY_A)).toBeNull();
    }
  });

  it('A→B→A 轮换回来得到**逐字节相同**的密文（确定性加密的无损轮换判据）', () => {
    for (const { value } of SAMPLES) {
      const original = encryptWithKey(value, KEY_A);
      const rotated = encryptWithKey(decryptWithKey(original, KEY_A) as string, KEY_B);
      const back = encryptWithKey(decryptWithKey(rotated, KEY_B) as string, KEY_A);

      expect(back).toBe(original);
    }
  });

  it('新旧钥交替调用不串味（派生缓存为多槽，不会因换钥而算错）', () => {
    const a1 = encryptWithKey('张三', KEY_A);
    const b1 = encryptWithKey('张三', KEY_B);
    // 反复交替，逼缓存淘汰/命中两条路径都走到
    for (let i = 0; i < 10; i += 1) {
      expect(encryptWithKey('张三', KEY_A)).toBe(a1);
      expect(encryptWithKey('张三', KEY_B)).toBe(b1);
    }
    expect(decryptWithKey(a1, KEY_A)).toBe('张三');
    expect(decryptWithKey(b1, KEY_B)).toBe('张三');
  });

  it('legacy（enc:base64）密文无需密钥即可还原，故 re-key 时也能被升级', () => {
    const legacy = `enc:${Buffer.from('张三', 'utf8').toString('base64')}`;

    expect(cipherSchemeOf(legacy)).toBe('legacy');
    expect(decryptWithKey(legacy, KEY_A)).toBe('张三');
    expect(decryptWithKey(legacy, KEY_B)).toBe('张三');
    expect(cipherSchemeOf(encryptWithKey(decryptWithKey(legacy, KEY_A) as string, KEY_B))).toBe('aes');
  });

  it('历史 HMAC 密文在 re-key 下仍不可逆 → null', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(decryptWithKey('enc:hmac:YWJjZGVmZ2hpamtsbW5vcA==', KEY_A)).toBeNull();
  });

  it('空密钥加密直接抛错，不静默降级成 base64', () => {
    // 降级成 base64 等于把患者明文写进库，re-key 场景下必须硬失败
    expect(() => encryptWithKey('张三', '')).toThrow(/空密钥/);
    expect(() => encryptWithKey('张三', '   ')).toThrow(/空密钥/);
  });

  it('空密钥解密 AES 密文 → null 并留警告，不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stored = encryptWithKey('张三', KEY_A);

    expect(decryptWithKey(stored, '')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['空串', ''],
  ])('decryptWithKey 对空输入 %s → null', (_label, input) => {
    expect(decryptWithKey(input, KEY_A)).toBeNull();
  });

  it('密文被篡改 → 换钥路径同样 GCM 校验失败返回 null', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(decryptWithKey(tamper(encryptWithKey('13800001234', KEY_A)), KEY_A)).toBeNull();
  });
});

describe('field-crypto — 密钥指纹', () => {
  it('稳定、8 位十六进制，且不含密钥原文', () => {
    const fp = keyFingerprint(KEY_A);

    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(keyFingerprint(KEY_A)).toBe(fp);
    expect(fp).not.toContain(KEY_A);
    expect(KEY_A).not.toContain(fp);
  });

  it('不同密钥指纹不同，可据此核对拿的是哪把钥', () => {
    expect(keyFingerprint(KEY_A)).not.toBe(keyFingerprint(KEY_B));
  });

  it('与 node:crypto 直接计算的结果一致（指纹算法可被运维独立复算）', () => {
    const expected = createHash('sha256').update(KEY_A, 'utf8').digest('hex').slice(0, 8);

    expect(keyFingerprint(KEY_A)).toBe(expected);
  });
});

// 脱敏规则的测试已移到 packages/shared/src/mask/index.spec.ts：
// 2026-11-17 起脱敏统一由 @gc/shared 提供，本模块只负责加解密。
