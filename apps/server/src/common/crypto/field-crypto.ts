import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from 'node:crypto';

/**
 * 患者敏感字段（姓名 / 身份证 / 手机号）的加密、解密与脱敏。
 * **全仓唯一实现**：业务代码与 `prisma/seed.ts` 都必须走这里，禁止另写一份
 * （seed 曾自带 `cipher()` 副本，会绕过加密直接写 base64，已于 2026-11-17 收口）。
 *
 * ## 算法：确定性 AES-256-GCM（SIV 式构造）
 *
 * 为什么必须是**确定性**的：患者列表的姓名筛选走密文等值匹配
 * （`where.nameCipher = encryptDeterministic(query.name)`）。随机 IV 的教科书式 AES
 * 每次密文都不同，会让姓名搜索直接失效。
 *
 * 构造方式：nonce 不随机，而是由明文经 HMAC-SHA256 派生（取前 12 字节）。
 * 于是「同明文 → 同 nonce → 同密文」，等值查询成立；不同明文的 nonce 也不同，
 * 不会出现 GCM 最忌讳的「同 key 同 nonce 加密不同明文」。这等价于 RFC 5297 的 SIV 思路，
 * 但只用 Node 内置 crypto 实现，不引入新依赖。
 *
 * 已知代价（需求人 2026-11-17 已知悉并接受）：相同明文的密文相同，
 * 因此能看出「两条记录同名 / 同手机号」。要消除这一点需改为随机 IV + 独立盲索引列，
 * 属表结构变更，见 docs/COMPLIANCE-CHECKLIST.md。
 *
 * ## 密文格式（带版本前缀，便于将来换算法时共存与迁移）
 *
 * - `enc:aes256gcm:v1:<base64(nonce[12] ‖ tag[16] ‖ ciphertext)>` —— 当前方案，可逆
 * - `enc:hmac:<base64>` —— 历史方案，HMAC-SHA256，**不可逆**，无法迁移只能重录
 * - `enc:<base64>` —— 未配置密钥时的开发兜底，**不是加密**，生产禁止（见 assertFieldCryptoReady）
 *
 * ## 密钥
 *
 * 从环境变量 `PATIENT_FIELD_KEY` 读取，经 HKDF-SHA256 派生出两把独立子密钥
 * （加密钥与 nonce 钥，info 不同）。**禁止**把密钥写进代码、配置文件或提交到仓库。
 * 换密钥等于让全部存量密文失效，必须先解密再用新密钥重加密（见 prisma/reencrypt-patient-fields.ts）。
 */

/** 当前方案前缀 */
const AES_PREFIX = 'enc:aes256gcm:v1:';
/** 历史 HMAC 方案前缀（不可逆） */
const HMAC_PREFIX = 'enc:hmac:';
/** 未配置密钥时的开发兜底前缀 */
const LEGACY_PREFIX = 'enc:';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** HKDF 盐：固定值即可（密钥的随机性来自 PATIENT_FIELD_KEY 本身） */
const HKDF_SALT = 'gc-patient-field-v1';

interface DerivedKeys {
  /** AES-256-GCM 加密钥 */
  encKey: Buffer;
  /** 派生确定性 nonce 用的 HMAC 钥，必须与加密钥分离 */
  nonceKey: Buffer;
}

/** 派生结果按密钥原文缓存，避免每次加解密都跑 HKDF */
let keyCache: { secret: string; keys: DerivedKeys } | null = null;

function deriveKeys(secret: string): DerivedKeys {
  if (keyCache !== null && keyCache.secret === secret) {
    return keyCache.keys;
  }
  const keys: DerivedKeys = {
    encKey: Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, 'gc-field-enc', KEY_BYTES)),
    nonceKey: Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, 'gc-field-nonce', KEY_BYTES)),
  };
  keyCache = { secret, keys };
  return keys;
}

/** 是否已配置字段加密密钥 */
export function isFieldCryptoConfigured(): boolean {
  const secret = process.env.PATIENT_FIELD_KEY;
  return secret !== undefined && secret.trim() !== '';
}

let insecureWarned = false;

/** 未配置密钥时只警告一次，避免批量写入刷屏 */
function warnInsecureOnce(): void {
  if (insecureWarned) {
    return;
  }
  insecureWarned = true;
  console.warn(
    '[field-crypto] ⚠️ 未配置 PATIENT_FIELD_KEY，敏感字段正以 base64 形式存储（**不是加密**）。' +
      '仅可用于本地开发；生产环境启动会被 assertFieldCryptoReady 拦下。',
  );
}

/**
 * 启动期自检：生产环境缺密钥直接拒绝启动。
 *
 * 为什么要拦：缺密钥时加密函数会静默降级成 base64，
 * 表面上"能跑"，实际患者姓名/证件号等于明文入库，等保测评必挂且事后难发现。
 */
export function assertFieldCryptoReady(nodeEnv: string | undefined): void {
  if (isFieldCryptoConfigured()) {
    return;
  }
  const reason = '未配置 PATIENT_FIELD_KEY，患者敏感字段无法加密';
  if (nodeEnv === 'production') {
    throw new Error(`[field-crypto] ${reason}；生产环境禁止启动，请先配置密钥`);
  }
  warnInsecureOnce();
}

/**
 * 加密（确定性）：同一明文恒定得到同一密文，以支持姓名等值查询。
 *
 * 未配置密钥时退回 `enc:<base64>` 开发兜底——**这不是加密**，
 * 生产环境由 `assertFieldCryptoReady` 在启动期拦住，不会走到这里。
 */
export function encryptDeterministic(plain: string): string {
  const secret = process.env.PATIENT_FIELD_KEY;
  if (secret === undefined || secret.trim() === '') {
    warnInsecureOnce();
    return `${LEGACY_PREFIX}${Buffer.from(plain, 'utf8').toString('base64')}`;
  }

  const { encKey, nonceKey } = deriveKeys(secret);
  const nonce = createHmac('sha256', nonceKey).update(plain, 'utf8').digest().subarray(0, NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${AES_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64')}`;
}

/**
 * 解密。
 *
 * 返回 `null` 而不是抛错的场景（均会打警告日志，便于发现数据问题）：
 *  - 空值；
 *  - `enc:hmac:` 历史密文：HMAC 不可逆，明文已丢失，只能让医护重新录入；
 *  - `enc:aes256gcm:v1:` 但未配置密钥、密文被截断、或密钥不匹配（GCM 校验失败）；
 *  - 无法识别的前缀。
 *
 * 之所以不抛错：本函数用于展示路径，单行数据异常不应让整个列表接口 500。
 * 但**绝不静默**——每种情况都留日志。
 *
 * ⚠️ 目前尚无接口调用本函数：把明文回显到详情页属独立需求，
 * 按 AGENTS.md §5.3 必须同时加"访问即留痕"的审计，需单独出规格。
 */
export function decryptField(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined || stored === '') {
    return null;
  }

  if (stored.startsWith(AES_PREFIX)) {
    const secret = process.env.PATIENT_FIELD_KEY;
    if (secret === undefined || secret.trim() === '') {
      console.warn('[field-crypto] 密文为 AES 方案但未配置 PATIENT_FIELD_KEY，无法解密');
      return null;
    }
    const blob = Buffer.from(stored.slice(AES_PREFIX.length), 'base64');
    if (blob.length <= NONCE_BYTES + TAG_BYTES) {
      console.warn('[field-crypto] AES 密文长度异常（被截断或损坏），跳过解密');
      return null;
    }
    const nonce = blob.subarray(0, NONCE_BYTES);
    const tag = blob.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ciphertext = blob.subarray(NONCE_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', deriveKeys(secret).encKey, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // GCM 校验失败：密钥换过、或密文被篡改。不打印密文内容，避免泄漏
      console.warn('[field-crypto] AES-GCM 校验失败（密钥不匹配或密文被篡改），跳过解密');
      return null;
    }
  }

  if (stored.startsWith(HMAC_PREFIX)) {
    console.warn('[field-crypto] 命中历史 HMAC 密文，该方案不可逆，无法还原明文');
    return null;
  }

  if (stored.startsWith(LEGACY_PREFIX)) {
    return Buffer.from(stored.slice(LEGACY_PREFIX.length), 'base64').toString('utf8');
  }

  console.warn('[field-crypto] 无法识别的密文前缀，跳过解密');
  return null;
}

/** 密文方案标识，供迁移脚本统计与校验使用 */
export function cipherSchemeOf(stored: string | null | undefined): 'aes' | 'hmac' | 'legacy' | 'empty' | 'unknown' {
  if (stored === null || stored === undefined || stored === '') {
    return 'empty';
  }
  if (stored.startsWith(AES_PREFIX)) {
    return 'aes';
  }
  if (stored.startsWith(HMAC_PREFIX)) {
    return 'hmac';
  }
  if (stored.startsWith(LEGACY_PREFIX)) {
    return 'legacy';
  }
  return 'unknown';
}

// 脱敏函数（maskName / maskPhone / maskIdCard）已于 2026-11-17 移除，
// 统一使用 `@gc/shared` 的 `mask` 模块（全仓唯一实现，前后端共用）。
//
// 此处曾有一套同名但规则不同的副本，两者对同一输入产出不同结果：
//   maskIdCard('110101199003074512')  本文件 '110********12'（前3后2） vs shared '110***********4512'（前3后4）
//   maskName('张三丰')                本文件 '张*丰'（保留首尾）        vs shared '张**'（只保留姓）
//   maskIdCard('12345')               本文件 '123********45'（长度膨胀且泄漏头尾） vs shared '*****'
// 保留首尾的写法对三字名只遮一个字，配合科室/床号/住院号足以反推身份，故统一到 shared 的规则。
//
// ⚠️ 不要在这里重新加脱敏函数：`*Masked` 是**落库字段**，两套实现并存会让存量行与新行格式不一致。
// 需要脱敏一律 `import { maskName, maskPhone, maskIdCard } from '@gc/shared'`。
