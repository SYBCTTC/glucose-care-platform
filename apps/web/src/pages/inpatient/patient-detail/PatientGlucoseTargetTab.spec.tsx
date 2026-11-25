import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TargetRangeValue, ThresholdValue } from './PatientGlucoseTargetTab';

/**
 * 控糖目标展示组件测试（规格 §6.2、裁定 K / R）。
 *
 * 沿用本仓 web 测试口径：**node 环境 + `renderToStaticMarkup`**（无 jsdom），
 * 只渲染不依赖路由 / 网络 / Outlet context 的展示型子组件并断言 HTML。
 * 容器组件 `PatientGlucoseTargetTab` 依赖 `useParams` / `useOutletContext` / 请求，
 * 由 typecheck + 手工 e2e 覆盖；其可判定逻辑已抽到 `glucose-target-view.ts` 单独测。
 */

describe('TargetRangeValue — 时段目标区间展示', () => {
  it('有值：加 gc-num（等宽数字）并补 1 位小数（裁定 R）', () => {
    const html = renderToStaticMarkup(<TargetRangeValue valueDown={4.4} valueUp={7} />);
    expect(html).toContain('gc-num');
    expect(html).toContain('4.4-7.0 mmol/L');
  });

  it('缺行：显示「未设置」，且**不加** gc-num（它不是数值，等宽字体无意义）', () => {
    const html = renderToStaticMarkup(<TargetRangeValue valueDown={null} valueUp={null} />);
    expect(html).toContain('未设置');
    expect(html).not.toContain('gc-num');
  });

  it('缺行时用弱化色，与有值项形成视觉区分（裁定 K：不能显示 0 或空白）', () => {
    const html = renderToStaticMarkup(<TargetRangeValue valueDown={null} valueUp={null} />);
    // colorTextTertiary 由主题 token 下发，这里只断言确实带了内联颜色而非默认色
    expect(html).toContain('color:');
    expect(html).not.toContain('0.0-0.0');
  });

  it('半配置（契约允许、库里不会出现）同样显示未设置，不渲染出「4.4-未设置」这类残缺文案', () => {
    const html = renderToStaticMarkup(<TargetRangeValue valueDown={4.4} valueUp={null} />);
    expect(html).toContain('未设置');
    expect(html).not.toContain('4.4');
  });
});

describe('ThresholdValue — 预警值展示', () => {
  it('有值：加 gc-num 并补 1 位小数', () => {
    const html = renderToStaticMarkup(<ThresholdValue value={3.9} />);
    expect(html).toContain('gc-num');
    expect(html).toContain('3.9 mmol/L');
  });

  it('整数补 .0（17 → 17.0），与时段区间口径一致', () => {
    const html = renderToStaticMarkup(<ThresholdValue value={17} />);
    expect(html).toContain('17.0 mmol/L');
  });

  it('null（该行不存在）：显示未设置且不加 gc-num', () => {
    const html = renderToStaticMarkup(<ThresholdValue value={null} />);
    expect(html).toContain('未设置');
    expect(html).not.toContain('gc-num');
  });
});
