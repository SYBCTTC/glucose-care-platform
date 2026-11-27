import { Typography } from 'antd';

/**
 * 血糖数据三页共用的**统计栏**（字段可配置）。
 *
 * 为什么做成 items 而不是固定四项：报告页的口径是「总计 / 合格次数 / 最高 / 最低」
 * （R20，服务端按查询范围全量计算），但趋势图将来大概率要 TIR / 达标率 / 日均值，
 * 记录列表也可能要「本页条数」。把字段写死在公共组件里，每加一个口径就要改公共组件、
 * 三页一起回归；改成 items 后各页自己决定展示什么，公共组件只负责排版与着色规则。
 *
 * 本组件**不取数、不认识任何业务类型**：数据由调用方算好传进来（报告页见
 * `buildReportStatsItems`），这样它才能同时服务三个口径不同的页面。
 */

/** 统计栏段落间距：需求人明确指定 20px（R20），非 token 档位故立常量注明出处 */
export const STATS_GAP_PX = 20;

export interface GlucoseStatsItem {
  /**
   * 字段名，如「总计」「最高血糖」；同时作为 React key，同一栏内不可重复。
   * 可省略（P4-7 预警统计栏有纯「Y次」段）：省略时不渲染「label：」前缀，key 回退 index。
   */
  label?: string;
  /** 已格式化好的值文本，如 `17`、`9.4`、`High`、`-`。组件不做任何数值加工 */
  value: string;
  /**
   * 值的着色。**必须取字典色**（如 DY-RESULT 的 `color`），禁止硬编码色值
   * （ui-design-tokens 规则）；不传 = 用正文色。
   */
  color?: string;
  /** 值后缀（如 ` 次`、` mmol/L`），紧跟值之后、不参与着色 */
  suffix?: string;
  /**
   * 值是否用等宽数字（`gc-num`）。数值型统计应开启（位数变化时不跳动）；
   * 文案型（`High`/`Low`/`-`）应关闭——等宽字体渲染中文/字母的观感与正文不一致。
   * 默认 false。
   */
  numeric?: boolean;
  /** 该项前渲染竖线分隔符 `|`（R20 的视觉分组：总计与后续三项之间断开） */
  divider?: boolean;
}

/**
 * 渲染口径（与 R20 原实现逐像素一致，迁移时由测试钉住）：
 *  - 首项不带左间距，其余每项（含分隔符）各带 `margin-left:20px`；
 *  - `label：value suffix`，冒号为中文全角；
 *  - `numeric` 时值与后缀一起包在 `gc-num` 内，着色只作用于值本身
 *    （整段染色会让单位也带上告警色，读起来像异常值——同 ReportCell 的 D4 口径）。
 *
 * 导出仅为单测（同 `ReportCell` 的理由：外层页面依赖 Outlet context 与网络请求）。
 */
export function GlucoseStatsBar({ items }: { items: GlucoseStatsItem[] }) {
  return (
    <Typography.Text type="secondary">
      {items.map((item, index) => {
        const gapStyle = index === 0 && !item.divider ? undefined : { marginLeft: STATS_GAP_PX };
        return (
          <span key={item.label ?? `item-${index}`}>
            {item.divider ? <span style={{ marginLeft: STATS_GAP_PX }}>|</span> : null}
            <span style={gapStyle}>
              {item.label ? `${item.label}：` : null}
              {item.numeric ? (
                <span className="gc-num">
                  <span style={{ color: item.color }}>{item.value}</span>
                  {item.suffix}
                </span>
              ) : (
                <span style={{ color: item.color }}>{item.value}</span>
              )}
            </span>
          </span>
        );
      })}
    </Typography.Text>
  );
}
