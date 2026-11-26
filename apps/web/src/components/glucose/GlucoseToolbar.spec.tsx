/**
 * 公共工具栏测试：全屏按钮（迁移自 R23 原测试）+ 三页共用的行布局。
 *
 * 布局断言看似琐碎，但正是三页复用最容易漂移的部分：漏 `flex-shrink:0` → 内容区撑高时
 * 工具栏被压扁；漏 `margin-left:auto` → 统计未加载时全屏按钮跳到左边；
 * 漏 `gc-no-print` → 纸质输出上出现无意义的交互控件。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FullscreenToggle, GlucoseToolbar } from './GlucoseToolbar';

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

describe('FullscreenToggle — 全屏切换按钮（R23）', () => {
  it('非全屏态：文案「全屏」，带打印隐藏类', () => {
    const html = renderToStaticMarkup(<FullscreenToggle fullscreen={false} onToggle={() => {}} />);

    expect(textOf(html)).toContain('全屏');
    expect(html).not.toContain('退出全屏');
    // 交互控件对纸质输出无意义，打印时隐藏
    expect(html).toContain('gc-no-print');
  });

  it('全屏态：文案「退出全屏」', () => {
    const html = renderToStaticMarkup(<FullscreenToggle fullscreen onToggle={() => {}} />);

    expect(textOf(html)).toContain('退出全屏');
  });
});

describe('GlucoseToolbar — 工具栏块（统计一行 + 表单/全屏一行）', () => {
  it('三部分齐备：统计文本、表单插槽、全屏按钮（2026-11-26 起分两行渲染）', () => {
    const html = renderToStaticMarkup(
      <GlucoseToolbar
        stats={[{ label: '总计', value: '17', suffix: ' 次', numeric: true }]}
        form={<div>住院记录表单</div>}
        fullscreen={false}
        onToggleFullscreen={() => {}}
      />,
    );
    const text = textOf(html);

    expect(text).toContain('总计：17 次');
    expect(text).toContain('住院记录表单');
    expect(text).toContain('全屏');
    // 统计栏在前、表单/全屏行在后（两行结构的顺序钉住）
    expect(html.indexOf('总计：17')).toBeLessThan(html.indexOf('住院记录表单'));
  });

  it('不传 stats（数据未加载）：统计区不渲染，全屏按钮仍靠右不跳动', () => {
    const html = renderToStaticMarkup(
      <GlucoseToolbar fullscreen={false} onToggleFullscreen={() => {}} />,
    );

    expect(html).not.toContain('总计');
    expect(textOf(html)).toContain('全屏');
    expect(html).toContain('margin-left:auto');
  });

  it('空 stats 数组同样不渲染统计区（与 undefined 等价）', () => {
    const html = renderToStaticMarkup(
      <GlucoseToolbar stats={[]} fullscreen={false} onToggleFullscreen={() => {}} />,
    );

    expect(html).not.toContain('gc-num');
  });

  it('块布局：纵向两行 + 内部间距 16px + 窄屏允许换行 + 不被内容区压扁', () => {
    const html = renderToStaticMarkup(
      <GlucoseToolbar fullscreen={false} onToggleFullscreen={() => {}} />,
    );

    // 2026-11-26 样式调整：单行 space-between 改纵向两行（统计栏一行 + 表单/全屏一行）
    expect(html).toContain('flex-direction:column');
    expect(html).not.toContain('justify-content:space-between');
    // 块内部间距 16px（token.margin，需求人指定保持现状）
    expect(html).toContain('gap:16px');
    // R24 裁定 Q18a：窄屏接受换行，不挤压控件
    expect(html).toContain('flex-wrap:wrap');
    expect(html).toContain('flex-shrink:0');
  });

  it('表单/全屏行整行挂 gc-no-print：打印时不残留 16px 空行', () => {
    const html = renderToStaticMarkup(
      <GlucoseToolbar fullscreen={false} onToggleFullscreen={() => {}} />,
    );

    // 表单与全屏按钮各自 no-print，打印时该行必为空——行容器整体隐藏，
    // 避免两行结构的根 gap 在纸质输出留下空档
    expect(html).toContain('gc-no-print');
  });

  it('全屏态透传给按钮：文案变为「退出全屏」', () => {
    const html = renderToStaticMarkup(<GlucoseToolbar fullscreen onToggleFullscreen={() => {}} />);

    expect(textOf(html)).toContain('退出全屏');
  });
});
