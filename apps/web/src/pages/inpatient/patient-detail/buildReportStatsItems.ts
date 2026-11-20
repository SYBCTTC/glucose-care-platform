import { GLUCOSE_RESULT_CODE_HIGH, GLUCOSE_RESULT_CODE_LOW } from '@gc/shared';
import type { DictItemOption, GlucoseReportStats } from '@gc/shared';
import type { GlucoseStatsItem } from '@/components/glucose/GlucoseStatsBar';

/**
 * 报表统计口径（R20）→ 公共统计栏 `items` 的适配。
 *
 * 为什么放在页面侧而不是公共模块：`GlucoseReportStats` 是**报表接口专属出参**
 * （服务端按查询范围全量计算，与分页无关），趋势图将来的口径大概率是
 * TIR / 达标率 / 日均值，记录列表可能又是另一套。把「认识 report 类型」的适配
 * 放进公共目录，公共模块就被反向绑定到某一个接口上了。
 *
 * 口径（docs/specs/glucose-report.md R20，逐条对应原 ReportStatsBar 实现）：
 *  - 总计 = `DictItem.counted=true` 码集的记录数；合格 = `'1'` 正常条数；
 *  - 最高：存在 `'4'`(High) → 展示字典 label，否则数值最大值 `toFixed(1)` + ` mmol/L`；最低对称（`'3'`/Low）；
 *  - 极值颜色取**该记录自身 resultType** 的字典色，High/Low 文案色取 `'4'`/`'3'` 字典色；
 *  - 无数据时照常展示 `总计：0 次`、极值 `-`（裁定 3a）；
 *  - 字典未加载时回退 code 原文、不着色（同 `ReportCell` 口径），不硬编码 'High'/'Low' 文案。
 *
 * 纯函数，导出供单测（`buildReportStatsItems.spec.ts`）。
 */
export function buildReportStatsItems(
  stats: GlucoseReportStats,
  resultTypes: DictItemOption[],
): GlucoseStatsItem[] {
  const extreme = (
    label: string,
    hasExtreme: boolean,
    extremeCode: string,
    value: number | null,
    resultType: string | null,
  ): GlucoseStatsItem => {
    const dict = resultTypes.find((option) => option.code === extremeCode);
    if (hasExtreme) {
      // 有 High/Low 记录时展示字典 label 而非数值（数值此时无意义），文案色取该码字典色
      return {
        label,
        value: dict?.label ?? extremeCode,
        color: dict?.color ?? undefined,
        numeric: false,
      };
    }
    if (value !== null) {
      const valueDict = resultTypes.find((option) => option.code === resultType);
      return {
        label,
        value: value.toFixed(1),
        suffix: ' mmol/L',
        color: valueDict?.color ?? undefined,
        numeric: true,
      };
    }
    return { label, value: '-', numeric: false };
  };

  return [
    { label: '总计', value: String(stats.total), suffix: ' 次', numeric: true },
    // divider：R20 的视觉分组——总计与后续三项之间用竖线断开
    {
      label: '合格次数',
      value: String(stats.qualified),
      suffix: ' 次',
      numeric: true,
      divider: true,
    },
    extreme(
      '最高血糖',
      stats.hasHigh,
      GLUCOSE_RESULT_CODE_HIGH,
      stats.maxValueMmolL,
      stats.maxResultType,
    ),
    extreme(
      '最低血糖',
      stats.hasLow,
      GLUCOSE_RESULT_CODE_LOW,
      stats.minValueMmolL,
      stats.minResultType,
    ),
  ];
}
