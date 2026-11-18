import dayjs from 'dayjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asInt,
  asOneOf,
  asString,
  deserializeRange,
  readListSnapshot,
  serializeRange,
  writeListSnapshot,
} from './list-nav-state';

describe('serializeRange / deserializeRange — Dayjs 区间与 history.state 的序列化往返', () => {
  it('null 区间透传为 null', () => {
    expect(serializeRange(null)).toBeNull();
    expect(deserializeRange(null)).toBeNull();
  });

  it('Dayjs 区间序列化为 ISO 字符串，再还原为等值 Dayjs', () => {
    const start = dayjs('2026-03-01T00:00:00.000Z');
    const end = dayjs('2026-03-15T00:00:00.000Z');
    const serialized = serializeRange([start, end]);

    expect(serialized).toEqual([start.toISOString(), end.toISOString()]);

    const restored = deserializeRange(serialized);
    expect(restored).not.toBeNull();
    expect(restored?.[0].toISOString()).toBe(start.toISOString());
    expect(restored?.[1].toISOString()).toBe(end.toISOString());
  });

  it('还原后 Dayjs 方法可用（结构化克隆不会丢原型，这正是不能直接存 Dayjs 的原因）', () => {
    const restored = deserializeRange(serializeRange([dayjs('2026-03-01'), dayjs('2026-03-15')]));
    expect(restored?.[0].startOf('day').format('YYYY-MM-DD')).toBe('2026-03-01');
  });

  it('损坏输入一律 null：非数组 / 长度不符 / 元素非字符串 / 非法日期', () => {
    expect(deserializeRange('nope')).toBeNull();
    expect(deserializeRange([1, 2])).toBeNull();
    expect(deserializeRange(['2026-03-01'])).toBeNull();
    expect(deserializeRange(['not-a-date', '2026-03-15'])).toBeNull();
    expect(deserializeRange(undefined)).toBeNull();
  });
});

describe('writeListSnapshot / readListSnapshot — 写入并读回当前历史条目', () => {
  // web 测试环境是 node（无 jsdom，见 permission-route.spec 说明），
  // 用最小 history mock 验证读写与守卫逻辑，不依赖真实浏览器历史。
  function stubHistory(initialState: unknown = null): void {
    let state = initialState;
    vi.stubGlobal('window', {
      history: {
        get state() {
          return state;
        },
        replaceState(next: unknown) {
          state = next;
        },
      },
    });
  }

  beforeEach(() => stubHistory());
  afterEach(() => vi.unstubAllGlobals());

  it('同页往返：写入后能原样读回 payload', () => {
    const payload = { status: 'INPATIENT', page: 3 };
    writeListSnapshot('patients', payload);
    expect(readListSnapshot('patients')).toEqual(payload);
  });

  it('跨页守卫：patients 的快照不会被 ward 读到', () => {
    writeListSnapshot('patients', { status: 'INPATIENT' });
    expect(readListSnapshot('ward')).toBeNull();
  });

  it('无快照时读回 null（首次进入列表页）', () => {
    expect(readListSnapshot('patients')).toBeNull();
  });

  it('usr 被写成非对象（损坏）时读回 null，不抛错', () => {
    stubHistory({ usr: 'garbage' });
    expect(readListSnapshot('patients')).toBeNull();
  });

  it('版本不符的旧快照被丢弃（结构升级后不回灌脏数据）', () => {
    stubHistory({ usr: { __v: 999, __page: 'patients', payload: { page: 9 } } });
    expect(readListSnapshot('patients')).toBeNull();
  });

  it('写入保留 history.state 其他键（不破坏 React Router 的 idx/key）', () => {
    stubHistory({ idx: 2, key: 'abc' });
    writeListSnapshot('ward', { tab: 'CURRENT' });
    const state = window.history.state as Record<string, unknown>;
    expect(state.idx).toBe(2);
    expect(state.key).toBe('abc');
    expect(readListSnapshot('ward')).toEqual({ tab: 'CURRENT' });
  });

  it('history 写入抛错时静默降级（隐私模式/超配额不阻断列表）', () => {
    vi.stubGlobal('window', {
      history: {
        get state() {
          return null;
        },
        replaceState() {
          throw new Error('QuotaExceeded');
        },
      },
    });
    expect(() => writeListSnapshot('patients', { page: 1 })).not.toThrow();
  });

  it('history 读取抛错时返回 null（不崩页）', () => {
    vi.stubGlobal('window', {
      history: {
        get state() {
          throw new Error('SecurityError');
        },
      },
    });
    expect(readListSnapshot('patients')).toBeNull();
  });
});

describe('asString / asInt / asOneOf — 还原时的安全取值', () => {
  it('asString：非字符串回退', () => {
    expect(asString('abc')).toBe('abc');
    expect(asString(123)).toBe('');
    expect(asString(null, 'ALL')).toBe('ALL');
  });

  it('asInt：非法 / 越界回退，合法向下取整', () => {
    expect(asInt(3, 1)).toBe(3);
    expect(asInt('5', 1)).toBe(5);
    expect(asInt(0, 1)).toBe(1);
    expect(asInt(-2, 20)).toBe(20);
    expect(asInt(NaN, 7)).toBe(7);
    expect(asInt(undefined, 7)).toBe(7);
    expect(asInt(2.9, 1)).toBe(2);
  });

  it('asOneOf：不在集合内回退', () => {
    const allowed = ['CARD', 'LIST'] as const;
    expect(asOneOf('LIST', allowed, 'CARD')).toBe('LIST');
    expect(asOneOf('TABLE', allowed, 'CARD')).toBe('CARD');
    expect(asOneOf(null, allowed, 'CARD')).toBe('CARD');
  });
});
