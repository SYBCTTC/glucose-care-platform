/**
 * PatientModalInfo 测试（P2-6 裁定 1a/1b 的展示口径主体）。
 *
 * web 测试跑在 node 环境（无 jsdom），用 renderToStaticMarkup 断言输出 HTML。
 * 出院/住院弹框本体依赖 antd Modal（portal，SSR 不渲染内容）与受控 Form，
 * 按 GlucoseReviewModal.spec 同一约定靠 typecheck + playwright 实测覆盖；
 * 信息区「label:value、每行 2 项、缺失展示 -、时间类 gc-num」的验收主体在本组件。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PatientModalInfo from './PatientModalInfo';

describe('PatientModalInfo — 弹框基本信息展示（P2-6）', () => {
  it('label:value 渲染，每行 2 项（Col span=12 各占一半）', () => {
    const html = renderToStaticMarkup(
      <PatientModalInfo
        items={[
          { label: '姓名', value: '张**' },
          { label: '性别', value: '男' },
          { label: '科室', value: '内分泌科' },
          { label: '责任护士', value: '赵护士' },
        ]}
      />,
    );

    expect(html).toContain('姓名');
    expect(html).toContain('张**');
    expect(html).toContain('责任护士');
    expect(html).toContain('赵护士');
    // 每行 2 项：span=12 → ant-col-12
    expect(html.split('ant-col-12').length - 1).toBe(4);
  });

  it('缺失值（null/undefined/空串）统一展示「-」', () => {
    const html = renderToStaticMarkup(
      <PatientModalInfo
        items={[
          { label: '责任医生', value: null },
          { label: '责任护士', value: undefined },
          { label: '床号', value: '' },
        ]}
      />,
    );

    expect(html.split('-').length - 1).toBeGreaterThanOrEqual(3);
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
  });

  it('numeric 项带 gc-num 等宽数字类（时间/编号），普通项不带', () => {
    const html = renderToStaticMarkup(
      <PatientModalInfo
        items={[
          { label: '出院时间', value: '2026-11-26', numeric: true },
          { label: '科室', value: '内分泌科' },
        ]}
      />,
    );

    expect(html.split('gc-num').length - 1).toBe(1);
    expect(html).toContain('2026-11-26');
  });
});
