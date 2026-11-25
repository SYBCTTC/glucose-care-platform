import { theme } from 'antd';
import type { ThemeConfig } from 'antd';
import type { RoleCode } from '@gc/shared';

/**
 * 设计令牌唯一来源。
 * 取值来自 docs/UI-DESIGN-TOKENS.md，新增/修改色值必须先改文档再改本文件。
 */

export type ThemeMode = 'light' | 'dark';
export type FontScale = 'standard' | 'large';

/** 1. 主色与派生色（VI 青 #6ad3d8） */
export const brandColor = {
  /** 院方 VI 主色：用于链接、选中态、图表主序列 */
  primary: '#6ad3d8',
  primaryHover: '#57c7cd',
  primaryActive: '#41a9af',
  /**
   * 主色明度过高（与白字对比度仅 1.76:1），
   * 主按钮文字、主色标签文字一律使用该深墨色，实测对比度 11.9:1，满足 WCAG AA。
   */
  primaryInk: '#08333a',
  /** 正文链接需压暗，保证白底可读 */
  link: '#1f8f96',
  linkDark: '#7fdfe4',
  /** 浅底（选中行、标签底） */
  bg: 'rgba(106, 211, 216, 0.12)',
  bgHover: 'rgba(106, 211, 216, 0.2)',
  border: '#b7e7ea',
} as const;

/** 4. 功能色 */
export const functionalColor = {
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
} as const;

/** 5.1 血糖区间语义色（低/正常/高，阈值来自后端系统配置） */
export const glucoseColor = {
  low: '#4BB2ED',
  /** 偏低：与 Low 同色（数值低 vs 类型低，语义不同但同色） */
  lowish: '#4BB2ED',
  normal: '#389E0D',
  /** 偏高：与 High 同色 */
  highish: '#FF1516',
  high: '#FF1516',
  /** 目标范围内 TIR（CGM 预留） */
  tir: '#52c41a',
} as const;

/** 5.2 记录状态 */
export const recordStatusColor = {
  NORMAL: '#389e0d',
  PENDING_REVIEW: '#faad14',
  REJECTED: '#8c8c8c',
} as const;

/** 5.3 数据来源 */
export const channelColor = {
  MANUAL: '#1677ff',
  DEVICE: '#13c2c2',
  VENDOR_API: '#722ed1',
  CGM: '#eb2f96',
} as const;

/** 5.4 设备状态 */
export const deviceStatusColor = {
  ONLINE: '#52c41a',
  OFFLINE: '#bfbfbf',
  FAULT: '#ff4d4f',
  MAINTAIN: '#faad14',
  SCRAPPED: '#8c8c8c',
} as const;

/** 5.5 角色标签色（Antd Tag 预设色名，保证与主题一致） */
export const roleTagColor: Record<RoleCode, string> = {
  DOCTOR: 'blue',
  NURSE: 'cyan',
  NURSE_HEAD: 'purple',
  DEVICE_ADMIN: 'gold',
  SYS_ADMIN: 'red',
};

/** 9. 布局尺寸 */
export const layoutSize = {
  siderWidth: 208,
  siderCollapsedWidth: 80,
  headerHeight: 56,
  contentPadding: 16,
  cardGap: 16,
  cardPadding: 24,
  contentMinWidth: 1024,
  // 方案 B：深色高对比侧栏（暗色模式）——底色压深、文字提亮，选中态浅青药丸 + 深青字
  siderBg: '#0b1f33',
  siderTriggerBg: '#0a1a2b',
  siderText: 'rgba(255, 255, 255, 0.92)',
  // 浅色模式对应侧栏（与右上角明暗开关联动）
  siderBgLight: '#ffffff',
  siderTriggerBgLight: '#f0f0f0',
  siderTextLight: 'rgba(0, 0, 0, 0.85)',
} as const;

/** 12. 图表配色序列 */
export const chartPalette = ['#6ad3d8', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96'];

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", Arial, sans-serif';

/** 大字号档（适老）：整体 +2px，标题同步放大 */
const largeFontTokens = {
  fontSize: 16,
  fontSizeSM: 14,
  fontSizeLG: 18,
  fontSizeHeading1: 32,
  fontSizeHeading2: 26,
  fontSizeHeading3: 22,
  fontSizeHeading4: 18,
  fontSizeHeading5: 16,
} satisfies NonNullable<ThemeConfig['token']>;

/**
 * 生成 Antd 主题配置。
 * 页面禁止硬编码色值，组件层一律消费 token；自定义场景用 global.css 的 --gc-* 变量。
 */
export function getThemeConfig(mode: ThemeMode, fontScale: FontScale): ThemeConfig {
  const isDark = mode === 'dark';
  return {
    algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      // 1. 主色
      colorPrimary: brandColor.primary,
      colorPrimaryHover: brandColor.primaryHover,
      colorPrimaryActive: brandColor.primaryActive,
      colorLink: isDark ? brandColor.linkDark : brandColor.link,
      colorInfo: brandColor.primary,
      // 3. 中性色
      colorBgLayout: isDark ? '#141414' : '#f5f7fa',
      colorBgContainer: isDark ? '#1f1f1f' : '#ffffff',
      colorBgElevated: isDark ? '#1f1f1f' : '#ffffff',
      colorBorder: isDark ? '#303030' : '#d9d9d9',
      colorBorderSecondary: isDark ? '#434343' : '#f0f0f0',
      // 4. 功能色
      colorSuccess: functionalColor.success,
      colorWarning: functionalColor.warning,
      colorError: functionalColor.error,
      // 6. 字体
      fontFamily,
      fontSize: 14,
      lineHeight: 1.5715,
      // 8. 圆角
      borderRadius: 6,
      borderRadiusLG: 8,
      borderRadiusSM: 4,
      // 10. 控件高度
      controlHeight: 32,
      controlHeightLG: 40,
      controlHeightSM: 24,
      // 13. 动效
      motionDurationFast: '0.1s',
      motionDurationMid: '0.2s',
      motionDurationSlow: '0.3s',
      ...(fontScale === 'large' ? largeFontTokens : {}),
    },
    components: {
      // 主色过浅，主按钮文字改深墨色以满足对比度
      Button: { primaryColor: brandColor.primaryInk },
      Layout: {
        siderBg: isDark ? layoutSize.siderBg : layoutSize.siderBgLight,
        triggerBg: isDark ? layoutSize.siderTriggerBg : layoutSize.siderTriggerBgLight,
        triggerColor: isDark ? layoutSize.siderText : layoutSize.siderTextLight,
        headerBg: isDark ? '#141414' : '#ffffff',
        headerHeight: layoutSize.headerHeight,
        headerPadding: '0 16px',
        bodyBg: isDark ? '#141414' : '#f5f7fa',
      },
      Table: {
        headerBg: isDark ? '#262626' : '#fafafa',
        borderColor: isDark ? '#303030' : '#f0f0f0',
        headerSplitColor: isDark ? '#303030' : '#f0f0f0',
        rowHoverBg: isDark ? 'rgba(255, 255, 255, 0.06)' : brandColor.bg,
        rowSelectedBg: isDark ? 'rgba(106, 211, 216, 0.24)' : brandColor.bgHover,
        cellPaddingBlock: 12,
      },
      Card: {
        headerFontSize: 16,
      },
      Menu: {
        // 暗色模式（方案 B）：深色高对比——底色压深、文字提亮、选中浅青药丸 + 深青字
        darkItemBg: isDark ? layoutSize.siderBg : '#0b1f33',
        darkSubMenuItemBg: isDark ? '#0a1a2b' : '#000c17',
        darkItemColor: isDark ? layoutSize.siderText : 'rgba(255, 255, 255, 0.65)',
        darkItemHoverColor: isDark ? '#ffffff' : '#ffffff',
        darkItemSelectedBg: brandColor.primary,
        darkItemSelectedColor: brandColor.primaryInk,
        // 浅色模式：白底深字，选中浅青底 + 深青字（与明暗开关联动）
        itemBg: isDark ? '#ffffff' : layoutSize.siderBgLight,
        subMenuItemBg: isDark ? '#f0f5f5' : '#f0f5f5',
        itemColor: isDark ? 'rgba(0, 0, 0, 0.85)' : layoutSize.siderTextLight,
        itemHoverColor: isDark ? 'rgba(0, 0, 0, 0.88)' : 'rgba(0, 0, 0, 0.88)',
        itemSelectedBg: brandColor.bg,
        itemSelectedColor: brandColor.primaryInk,
      },
      Tag: {
        defaultBg: isDark ? 'rgba(255, 255, 255, 0.08)' : '#fafafa',
      },
    },
  };
}

export type GlucoseLevel = 'LOW' | 'NORMAL' | 'HIGH';

/**
 * 血糖区间判定：阈值必须由后端下发，禁止硬编码 3.9 / 16.7。
 *
 * ⚠️ 2026-11-25 起后端判定阈值取**患者该时段的控糖目标**（缺行回退全局 SystemConfig），
 * 已不是单一全局值；`resultType` 一律由服务端算好下发，前端**不应**再用本函数自行比大小
 * （否则会与库里的 resultType 打架）。保留本函数只为「后端已下发一组阈值、需在前端做同口径
 * 着色」的场景，例如趋势图用接口返回的 `thresholds`。当前仓库暂无调用方。
 */
export function getGlucoseLevel(
  value: number,
  thresholds: { low: number; high: number },
): GlucoseLevel {
  if (value < thresholds.low) return 'LOW';
  if (value > thresholds.high) return 'HIGH';
  return 'NORMAL';
}

/** 区间 → CSS 变量（页面只用变量，不写死色值） */
export const glucoseLevelColorVar: Record<GlucoseLevel, string> = {
  LOW: 'var(--gc-color-glucose-low)',
  NORMAL: 'var(--gc-color-glucose-normal)',
  HIGH: 'var(--gc-color-glucose-high)',
};

/** 色 + 文双通道：色弱医护也能判读（不依赖颜色单一通道） */
export const glucoseLevelLabel: Record<GlucoseLevel, string> = {
  LOW: '低',
  NORMAL: '正常',
  HIGH: '高',
};
