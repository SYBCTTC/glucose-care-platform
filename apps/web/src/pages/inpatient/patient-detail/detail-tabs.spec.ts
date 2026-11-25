import { describe, expect, it } from 'vitest';
import {
  buildDetailTabNavigation,
  DETAIL_DEFAULT_TAB,
  DETAIL_PATH_PREFIX,
  DETAIL_ROUTE_PATH,
  DETAIL_TAB_PATH,
  GLUCOSE_TAB_PATH,
  MAIN_TAB_PATH,
  resolveDetailTab,
} from './detail-tabs';

const BASE = `${DETAIL_PATH_PREFIX}0e6a1f2c-0000-4000-8000-000000000000`;

describe('resolveDetailTab — 由 pathname 派生选中的 Tab', () => {
  it('5 条子路径各自派生出正确的主/子 Tab', () => {
    expect(resolveDetailTab(`${BASE}/glucose/report`)).toEqual({
      main: 'glucose',
      glucose: 'report',
    });
    expect(resolveDetailTab(`${BASE}/glucose/record`)).toEqual({
      main: 'glucose',
      glucose: 'record',
    });
    expect(resolveDetailTab(`${BASE}/glucose/trend`)).toEqual({
      main: 'glucose',
      glucose: 'trend',
    });
    expect(resolveDetailTab(`${BASE}/target`)).toEqual({ main: 'target', glucose: 'report' });
    expect(resolveDetailTab(`${BASE}/admission`)).toEqual({
      main: 'admission',
      glucose: 'report',
    });
  });

  it('裸详情 URL 回落默认「血糖数据 → 血糖报告」（与 index 重定向目标一致）', () => {
    expect(resolveDetailTab(BASE)).toEqual({ main: 'glucose', glucose: 'report' });
    expect(resolveDetailTab(`${BASE}/`)).toEqual({ main: 'glucose', glucose: 'report' });
  });

  it('未知子路径回落默认：不会出现「两层 Tab 都不亮」的空档', () => {
    // 这类 URL 由 `*` 兜底路由重定向，但重定向生效前的一帧也要有正确高亮
    expect(resolveDetailTab(`${BASE}/not-a-real-tab`)).toEqual({
      main: 'glucose',
      glucose: 'report',
    });
    expect(resolveDetailTab(`${BASE}/glucose/unknown`)).toEqual({
      main: 'glucose',
      glucose: 'report',
    });
    // 裁定 M：原「基本信息」子路径 /basic 已改名为 /target 且**刻意不做重定向**，
    // 旧链接（收藏夹 / 聊天记录里的 URL）落到这里 → 回落默认页，与 `*` 兜底路由行为一致，
    // 不会出现「Tab 栏在、内容区空白、无高亮」的空档
    expect(resolveDetailTab(`${BASE}/basic`)).toEqual({ main: 'glucose', glucose: 'report' });
  });

  it('非详情页路径回落默认，不抛异常', () => {
    expect(resolveDetailTab('/inpatient/patients')).toEqual({
      main: 'glucose',
      glucose: 'report',
    });
    expect(resolveDetailTab('/')).toEqual({ main: 'glucose', glucose: 'report' });
  });

  it('尾斜杠不影响匹配', () => {
    expect(resolveDetailTab(`${BASE}/target/`)).toEqual({ main: 'target', glucose: 'report' });
    expect(resolveDetailTab(`${BASE}/glucose/trend/`)).toEqual({
      main: 'glucose',
      glucose: 'trend',
    });
  });

  it('回落值与 DETAIL_DEFAULT_TAB 指向同一个页面', () => {
    expect(MAIN_TAB_PATH[resolveDetailTab(BASE).main]).toBe(DETAIL_DEFAULT_TAB);
    expect(GLUCOSE_TAB_PATH[resolveDetailTab(BASE).glucose]).toBe(DETAIL_TAB_PATH.glucoseReport);
  });
});

describe('buildDetailTabNavigation — Tab 跳转的两个硬约束', () => {
  const fromState = { from: '/inpatient/ward' };

  it('拼出指向子路径的绝对 URL', () => {
    expect(buildDetailTabNavigation('p1', DETAIL_TAB_PATH.target, fromState).to).toBe(
      `${DETAIL_PATH_PREFIX}p1/target`,
    );
    expect(buildDetailTabNavigation('p1', DETAIL_TAB_PATH.glucoseTrend, fromState).to).toBe(
      `${DETAIL_PATH_PREFIX}p1/glucose/trend`,
    );
  });

  it('replace 恒为 true：Tab 切换不污染浏览器历史（R15 / 风险 4）', () => {
    for (const subPath of Object.values(DETAIL_TAB_PATH)) {
      expect(buildDetailTabNavigation('p1', subPath, fromState).options.replace).toBe(true);
    }
  });

  it('state 原样透传：丢了它 handleBack 会退化成兜底跳患者管理（风险 1）', () => {
    expect(buildDetailTabNavigation('p1', DETAIL_TAB_PATH.target, fromState).options.state).toBe(
      fromState,
    );
    // 从虚拟病区进来时 from 必须保住，否则返回会去错页
    const wardState = { from: '/inpatient/ward' };
    expect(
      buildDetailTabNavigation('p1', DETAIL_TAB_PATH.glucoseRecord, wardState).options.state,
    ).toEqual(wardState);
    // 直接访问 URL 时 state 为 null，也要原样传（不能替换成 undefined 或 {}）
    expect(buildDetailTabNavigation('p1', DETAIL_TAB_PATH.target, null).options.state).toBeNull();
  });
});

describe('路径常量自洽性 — 防两处漂移', () => {
  it('DETAIL_ROUTE_PATH 的静态前缀与 DETAIL_PATH_PREFIX 一致', () => {
    // 拼绝对路径用 PREFIX、登记路由用 ROUTE_PATH；两者不一致会导致跳到不存在的路由
    expect(DETAIL_ROUTE_PATH).toBe(`${DETAIL_PATH_PREFIX}:id`);
  });

  it('MAIN_TAB_PATH / GLUCOSE_TAB_PATH 的值都来自 DETAIL_TAB_PATH', () => {
    const known = Object.values(DETAIL_TAB_PATH) as string[];
    for (const path of [...Object.values(MAIN_TAB_PATH), ...Object.values(GLUCOSE_TAB_PATH)]) {
      expect(known).toContain(path);
    }
  });

  it('默认落点是血糖报告（需求 1）', () => {
    expect(DETAIL_DEFAULT_TAB).toBe(DETAIL_TAB_PATH.glucoseReport);
  });
});
