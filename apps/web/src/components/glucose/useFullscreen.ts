import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { theme } from 'antd';

/**
 * 血糖数据三页（报告 / 记录 / 趋势图）共用的**全屏态**管理。
 *
 * 为什么抽 hook 而不是只抽按钮：全屏这件事在 R23 里分散在 4 处——按钮、根节点的
 * `position:fixed` 覆盖样式、ESC 监听、换患者时重置。只复用按钮的话，另外 3 处仍要在
 * 每页各写一遍，而它们恰恰是最容易写漏的（漏 ESC → 用户被困在全屏里；漏重置 →
 * 换患者后新页面莫名其妙还是全屏）。收拢到一个 hook，三页拿到的行为天然一致。
 *
 * 不用浏览器 Fullscreen API（R23 裁定）：antd 弹层挂在 body 上，该模式下会不可见，
 * 且纯 CSS 覆盖层无兼容性问题、明暗主题天然跟随 token。
 */

/** 构造覆盖样式所需的 token 子集（收窄类型让纯函数可脱离 antd 主题单测） */
export interface FullscreenToken {
  zIndexPopupBase: number;
  colorBgContainer: string;
  padding: number;
}

/**
 * 全屏覆盖样式（纯函数，导出供单测）。
 *
 * 非全屏返回**空对象**而非 undefined：调用方直接 `{...baseStyle, ...overlayStyle}` 合并，
 * 不必判空。zIndex 取 `token.zIndexPopupBase` 不写魔法数字——它低于 message/弹层的
 * 实际层级（popup 基准之上还有增量），保证全屏中操作反馈不被覆盖层遮挡。
 */
export function buildFullscreenOverlayStyle(
  fullscreen: boolean,
  token: FullscreenToken,
): CSSProperties {
  if (!fullscreen) {
    return {};
  }
  return {
    position: 'fixed',
    inset: 0,
    zIndex: token.zIndexPopupBase,
    background: token.colorBgContainer,
    padding: token.padding,
  };
}

export interface UseFullscreenOptions {
  /**
   * 全屏态切换后的尺寸变化回调（趋势图接 `chart.resize()`）。
   *
   * 为什么需要：ECharts 按容器像素尺寸绘制，`fixed; inset:0` 改变容器大小后画布不会
   * 自动跟随，不 resize 就会出现「图表停在旧尺寸、四周留白」。回调在
   * `requestAnimationFrame` 里触发——等浏览器完成一次布局，此时读到的才是新尺寸。
   *
   * 用 ref 持有而非进依赖数组：调用方传内联箭头函数时不会导致 effect 反复重挂。
   */
  onResize?: (fullscreen: boolean) => void;
}

export interface FullscreenApi {
  fullscreen: boolean;
  /** 切换（工具栏按钮用） */
  toggle: () => void;
  /** 退出全屏。换患者时调用：同一路由不同 `:id` 不会重挂载组件，state 需手动重置 */
  exit: () => void;
  /** 全屏时的 fixed 覆盖样式；非全屏为空对象。与调用方自身布局样式合并使用 */
  overlayStyle: CSSProperties;
}

export function useFullscreen(options: UseFullscreenOptions = {}): FullscreenApi {
  const { onResize } = options;
  const { token } = theme.useToken();
  // 纯视图状态：不持久化、不影响请求/分页/勾选（R23）
  const [fullscreen, setFullscreen] = useState(false);

  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  // ESC 退出：仅全屏态挂监听，退出即卸载（不给非全屏态留无谓的 keydown 开销）
  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  // 尺寸变化通知：等一帧让 fixed 布局生效后再回调，否则图表读到的是旧尺寸
  useEffect(() => {
    const frame = requestAnimationFrame(() => onResizeRef.current?.(fullscreen));
    return () => cancelAnimationFrame(frame);
  }, [fullscreen]);

  const toggle = useCallback(() => setFullscreen((prev) => !prev), []);
  const exit = useCallback(() => setFullscreen(false), []);

  return {
    fullscreen,
    toggle,
    exit,
    overlayStyle: buildFullscreenOverlayStyle(fullscreen, token),
  };
}
