import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

/**
 * 列表页状态跨「详情页往返」的持久化工具（决策 C1 · 方式B）。
 *
 * 背景：从患者管理 / 虚拟病区点进患者详情会卸载来源页，返回时来源页重新挂载、
 * 默认丢失 Tab / 筛选 / 视图模式 / 页码。方式B 把这些状态序列化后写入**当前历史
 * 条目的 history.state**（React Router 存 location.state 的位置，键名 `usr`），
 * 返回 `navigate(-1)` 时来源页从 history.state 还原。URL 保持干净（不写查询参数）。
 *
 * 关键约束：history.state 走浏览器结构化克隆，**Dayjs 实例不能直接存**——克隆后
 * 丢失原型方法（`.startOf` / `.format`），还原即崩，故日期区间必须序列化成 ISO 字符串。
 *
 * 还原是「增强体验」而非主流程：任何读取 / 解析失败都静默回退默认状态，绝不阻断列表。
 */

/** 快照结构版本：payload 形状变更时递增，旧版本快照直接丢弃（回退默认状态） */
const SNAPSHOT_VERSION = 1;

/** 参与状态记忆的列表页标识（用于守卫，避免跨页误读快照） */
export type ListPageKey = 'patients' | 'ward';

/** 序列化后的日期区间：ISO 字符串二元组，或 null（未选） */
export type SerializedRange = [string, string] | null;

/** 快照信封：外层带版本与页面标识，payload 由各列表页自定义 */
interface SnapshotEnvelope {
  __v: number;
  __page: ListPageKey;
  payload: unknown;
}

/** Dayjs 区间 → ISO 字符串区间（null 透传） */
export function serializeRange(range: [Dayjs, Dayjs] | null): SerializedRange {
  if (!range) {
    return null;
  }
  return [range[0].toISOString(), range[1].toISOString()];
}

/**
 * ISO 字符串区间 → Dayjs 区间。
 * 非数组 / 长度不符 / 元素非字符串 / 日期非法 → 一律 null（容错，绝不让还原崩页）。
 * 显式判字符串是因为 `dayjs(undefined)` 会返回「当前时间」而非 invalid，会误还原出区间。
 */
export function deserializeRange(value: unknown): [Dayjs, Dayjs] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const [rawStart, rawEnd] = value;
  if (typeof rawStart !== 'string' || typeof rawEnd !== 'string') {
    return null;
  }
  const start = dayjs(rawStart);
  const end = dayjs(rawEnd);
  if (!start.isValid() || !end.isValid()) {
    return null;
  }
  return [start, end];
}

/**
 * 把 payload 写入当前历史条目的 state：不新增历史、不改 URL、不触发 React 重渲染。
 * 保留 React Router 的 `idx` / `key`，仅覆盖 `usr`（即 location.state）。
 * 写入失败（隐私模式 / 超配额）静默降级为「不记忆」。
 */
export function writeListSnapshot(page: ListPageKey, payload: unknown): void {
  const envelope: SnapshotEnvelope = { __v: SNAPSHOT_VERSION, __page: page, payload };
  try {
    const current = (window.history.state ?? {}) as Record<string, unknown>;
    window.history.replaceState({ ...current, usr: envelope }, '');
  } catch {
    /* 还原是增强体验，写入失败不应阻断列表主流程 */
  }
}

/**
 * 读取当前历史条目里属于本页的快照 payload。
 * 版本不符 / 页面不符 / 结构损坏 → 返回 null（调用方回退默认状态）。
 */
export function readListSnapshot(page: ListPageKey): unknown {
  let usr: unknown;
  try {
    usr = (window.history.state as { usr?: unknown } | null)?.usr;
  } catch {
    return null;
  }
  if (!usr || typeof usr !== 'object') {
    return null;
  }
  const envelope = usr as Partial<SnapshotEnvelope>;
  if (envelope.__v !== SNAPSHOT_VERSION || envelope.__page !== page) {
    return null;
  }
  return envelope.payload;
}

/* ---- 还原时的安全取值：快照来自 history.state，可能损坏，逐字段兜底 ---- */

/** 取字符串：非字符串则用 fallback（默认空串） */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 取整数：非法 / 小于 min 则用 fallback（页码、每页条数用） */
export function asInt(value: unknown, fallback: number, min = 1): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num < min) {
    return fallback;
  }
  return Math.floor(num);
}

/** 取枚举：值不在允许集合内则用 fallback（status / tab / viewMode 用） */
export function asOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
