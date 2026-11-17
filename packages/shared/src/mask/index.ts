/**
 * 患者敏感字段脱敏（等保三级要求）。
 *
 * 约定：
 * 1. 列表/详情默认只返回脱敏值，完整值需单独接口 + 权限点 + 审计留痕；
 * 2. 脱敏规则前后端共用，避免前端漏脱敏导致密文/明文出现在界面上；
 * 3. 入参为空或过短时按"全遮掩"处理，绝不回显原始值。
 */

const MASK = '*';

/**
 * 保留头尾、中间遮掩。
 *
 * ⚠️ 必须保证**至少遮掩一个字符**：原实现只判 `raw.length < minLength`，
 * 当长度恰好等于 `keepHead + keepTail` 时星号数为 0，会把原值**原样返回**
 * （实测 `maskPhone('1380000')` → `'1380000'`，等于没脱敏）。2026-11-17 修正。
 * 长度不足以既保留头尾又遮掩时，一律全遮掩——宁可少显示，不可泄漏。
 */
function safeMask(value: string, keepHead: number, keepTail: number, minLength: number): string {
  const raw = value.trim();
  if (!raw) {
    return '';
  }
  if (raw.length < minLength || raw.length <= keepHead + keepTail) {
    return MASK.repeat(raw.length);
  }
  const head = keepHead > 0 ? raw.slice(0, keepHead) : '';
  const tail = keepTail > 0 ? raw.slice(-keepTail) : '';
  return `${head}${MASK.repeat(raw.length - keepHead - keepTail)}${tail}`;
}

/**
 * 常见复姓表（两字姓）。
 *
 * ⚠️ 原实现用 `/^[赵钱孙李…]{2}/`（百家姓**单字**字符集重复两次）判复姓，
 * 与注释「复姓保留前两字」不符：真正的复姓一个都识别不出
 * （实测 `欧阳明` → `欧**`、`司马懿` → `司**`、`诸葛亮` → `诸**`），
 * 反而把两个单字姓连写的名字误判成复姓（`黄王明` → `黄王*`、`于时雨` → `于时*`）。
 * 2026-11-17 改为显式复姓表。
 */
const COMPOUND_SURNAMES = [
  '欧阳',
  '太史',
  '端木',
  '上官',
  '司马',
  '东方',
  '独孤',
  '南宫',
  '万俟',
  '闻人',
  '夏侯',
  '诸葛',
  '尉迟',
  '公羊',
  '赫连',
  '澹台',
  '皇甫',
  '宗政',
  '濮阳',
  '公冶',
  '太叔',
  '申屠',
  '公孙',
  '慕容',
  '仲孙',
  '钟离',
  '长孙',
  '宇文',
  '司徒',
  '鲜于',
  '司空',
  '闾丘',
  '子车',
  '亓官',
  '司寇',
  '巫马',
  '公西',
  '颛孙',
  '壤驷',
  '公良',
  '漆雕',
  '乐正',
  '宰父',
  '谷梁',
  '拓跋',
  '夹谷',
  '轩辕',
  '令狐',
  '段干',
  '百里',
  '呼延',
  '东郭',
  '南门',
  '羊舌',
  '微生',
  '梁丘',
  '左丘',
  '西门',
  '第五',
] as const;

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

/**
 * 姓名：`张三丰` → `张**`（保留姓氏）；复姓保留前两字，`欧阳明` → `欧阳*`。
 *
 * 一律**不保留名字末字**：原 `field-crypto` 的实现是 `张*丰`（保留首尾），
 * 三字名只遮一个字，配合科室/床号/住院号足以反推身份，2026-11-17 统一到本实现。
 * 遮掩后若等于原值（单字名、或复姓本身只有两字），改为全遮掩——脱敏不得回显完整姓名。
 */
export function maskName(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) {
    return '';
  }
  const keep = COMPOUND_SURNAMES.some((surname) => raw.startsWith(surname)) ? 2 : 1;
  if (keep >= raw.length) {
    return MASK.repeat(raw.length);
  }
  return `${raw.slice(0, keep)}${MASK.repeat(raw.length - keep)}`;
}

/** 住院号/门诊号：保留后 4 位 */
export function maskPatientNo(value?: string | null): string {
  if (!value) {
    return '';
  }
  return safeMask(value, 0, 4, 6);
}
