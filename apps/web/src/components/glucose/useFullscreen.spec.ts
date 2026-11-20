/**
 * `useFullscreen` 的纯函数部分测试。
 *
 * hook 本体（ESC 监听、rAF 尺寸通知）依赖浏览器环境，而 web 测试跑在 node（无 jsdom）里
 * 无法触发事件，靠 typecheck + 手工 e2e 验证（同 `detail-tabs.ts` 的口径）；
 * 这里钉住**覆盖样式的构造规则**——它是全屏视觉的全部来源，写错就是整页错位。
 */
import { describe, expect, it } from 'vitest';
import { buildFullscreenOverlayStyle } from './useFullscreen';

const TOKEN = {
  zIndexPopupBase: 1000,
  colorBgContainer: 'rgb(255,255,255)',
  padding: 16,
};

describe('buildFullscreenOverlayStyle — 全屏覆盖样式', () => {
  it('非全屏：返回空对象（调用方可直接展开合并，不必判空）', () => {
    expect(buildFullscreenOverlayStyle(false, TOKEN)).toEqual({});
  });

  it('全屏：fixed 覆盖整个视口（不用浏览器 Fullscreen API，antd 弹层挂 body 会不可见）', () => {
    const style = buildFullscreenOverlayStyle(true, TOKEN);

    expect(style.position).toBe('fixed');
    expect(style.inset).toBe(0);
  });

  it('zIndex / 背景 / 内边距全部取 token，不写魔法数字', () => {
    const style = buildFullscreenOverlayStyle(true, TOKEN);

    expect(style.zIndex).toBe(TOKEN.zIndexPopupBase);
    expect(style.background).toBe(TOKEN.colorBgContainer);
    expect(style.padding).toBe(TOKEN.padding);
  });

  it('跟随 token 变化：暗色主题下背景与内边距自动切换（无需组件内判主题）', () => {
    const dark = {
      zIndexPopupBase: 1000,
      colorBgContainer: 'rgb(20,20,20)',
      padding: 24,
    };
    const style = buildFullscreenOverlayStyle(true, dark);

    expect(style.background).toBe('rgb(20,20,20)');
    expect(style.padding).toBe(24);
  });
});
