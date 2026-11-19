import { describe, expect, it } from 'vitest';
import { pickTimeSlotByTime, TIME_SLOT_CATEGORY, TIME_SLOTS, timeToMinutes } from './time-slots';
import type { TimeSlotOption } from './time-slots';

/**
 * 测试夹具：把 seed 清单补成接口下发形态。
 * 运行时已无静态兜底（getFallbackTimeSlots 已移除），这里仅为构造 pickTimeSlotByTime 的入参。
 */
const slots: TimeSlotOption[] = TIME_SLOTS.map((slot) => ({
  ...slot,
  timeScope: slot.startTime && slot.endTime ? `${slot.startTime}-${slot.endTime}` : null,
  enabled: true,
}));

describe('timeToMinutes', () => {
  it('正常时间转分钟数', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('07:30')).toBe(450);
    // '24:00' 是当日终点，普通时段用它收尾
    expect(timeToMinutes('24:00')).toBe(1440);
  });

  it('非法时间返回 null', () => {
    expect(timeToMinutes('7:3')).toBeNull();
    expect(timeToMinutes('24:01')).toBeNull();
    expect(timeToMinutes('25:00')).toBeNull();
    expect(timeToMinutes('ab:cd')).toBeNull();
  });
});

describe('pickTimeSlotByTime — 按检测时间归入普通时段', () => {
  it('区间左闭右开：起点归本时段，终点归下一时段', () => {
    expect(pickTimeSlotByTime(slots, '07:00')?.code).toBe('BREAKFAST_PRE');
    expect(pickTimeSlotByTime(slots, '06:59')?.code).toBe('FASTING');
    expect(pickTimeSlotByTime(slots, '22:00')?.code).toBe('BEDTIME');
    expect(pickTimeSlotByTime(slots, '23:59')?.code).toBe('BEDTIME');
  });

  it('普通时段必须 24 小时全覆盖：任意分钟都能命中', () => {
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      expect(pickTimeSlotByTime(slots, time), `未命中：${time}`).not.toBeNull();
    }
  });

  it('只从普通时段里选：特殊/强化即使有时间区间也不参与', () => {
    const withRange = [
      {
        ...slots[0],
        code: 'INTENSIVE_AM',
        name: '强化-上午',
        type: TIME_SLOT_CATEGORY.INTENSIVE,
        startTime: '00:00',
        endTime: '24:00',
      },
      { ...slots[0], code: 'RANDOM', name: '随机', type: TIME_SLOT_CATEGORY.SPECIAL, startTime: null, endTime: null },
      ...slots,
    ];

    // 强化排在数组最前，但 08:30 仍应命中普通时段「早餐后」
    expect(pickTimeSlotByTime(withRange, '08:30')?.code).toBe('BREAKFAST_POST');
  });

  it('停用时段不参与匹配', () => {
    const disabled = slots.map((slot) =>
      slot.code === 'FASTING' ? { ...slot, enabled: false } : slot,
    );

    expect(pickTimeSlotByTime(disabled, '03:00')).toBeNull();
  });

  it('ignoreEnabled=true 时停用时段也参与匹配（血糖报表归组用）', () => {
    const disabled = slots.map((slot) =>
      slot.code === 'FASTING' ? { ...slot, enabled: false } : slot,
    );

    // 不传 / 显式 false → 保持既有行为（录入场景不该把停用时段当默认值）
    expect(pickTimeSlotByTime(disabled, '03:00', { ignoreEnabled: false })).toBeNull();
    // true → 停用时段的历史血糖仍落回原本所属的列
    expect(pickTimeSlotByTime(disabled, '03:00', { ignoreEnabled: true })?.code).toBe('FASTING');
  });

  it('ignoreEnabled 只放宽 enabled，不填补区间空洞：仍返回 null', () => {
    // 这条断言解释了服务端为何必须有「归组失败 → 落 RANDOM 列」的兜底
    const withHole = slots.filter((slot) => slot.code !== 'FASTING');

    expect(pickTimeSlotByTime(withHole, '03:00', { ignoreEnabled: true })).toBeNull();
  });

  it('无命中或时间非法返回 null', () => {
    expect(pickTimeSlotByTime([], '08:00')).toBeNull();
    expect(pickTimeSlotByTime(slots, '8:00')).toBeNull();
  });
});

describe('TIME_SLOTS 默认数据', () => {
  it('普通时段首尾相接且覆盖 00:00~24:00', () => {
    const normal = TIME_SLOTS.filter((slot) => slot.type === TIME_SLOT_CATEGORY.NORMAL).sort(
      (a, b) => Number(timeToMinutes(a.startTime ?? '')) - Number(timeToMinutes(b.startTime ?? '')),
    );

    expect(normal.length).toBeGreaterThan(0);
    let cursor = 0;
    for (const slot of normal) {
      expect(timeToMinutes(slot.startTime ?? '')).toBe(cursor);
      cursor = Number(timeToMinutes(slot.endTime ?? ''));
    }
    expect(cursor).toBe(1440);
  });

  it('特殊/强化时段没有区间与控糖目标', () => {
    const others = TIME_SLOTS.filter((slot) => slot.type !== TIME_SLOT_CATEGORY.NORMAL);

    expect(others.length).toBeGreaterThan(0);
    for (const slot of others) {
      expect(slot.startTime).toBeNull();
      expect(slot.endTime).toBeNull();
      expect(slot.valueDown).toBeNull();
      expect(slot.valueUp).toBeNull();
    }
  });
});
