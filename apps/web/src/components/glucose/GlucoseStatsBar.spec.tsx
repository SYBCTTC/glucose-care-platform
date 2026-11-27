/**
 * 公共统计栏的**渲染层**测试。
 *
 * 钉住 R20 的视觉口径（迁移自原 `ReportStatsBar` 测试）：段落间距 20px、首项不带左间距、
 * `divider` 渲染竖线、`numeric` 走 `gc-num`、着色只作用于值本身。
 *
 * 业务口径（总计/合格/最高/最低怎么算出来的）不在这里——那是各页适配函数的职责，
 * 报表侧见 `buildReportStatsItems.spec.ts`。两层分开测，才能做到「换口径不动渲染、
 * 换渲染不动口径」。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GlucoseStatsBar, STATS_GAP_PX } from './GlucoseStatsBar';
import type { GlucoseStatsItem } from './GlucoseStatsBar';

/** 取渲染后的可见文本（markup 里值与后缀分处不同 span，断言必须落在去标签后的文本上） */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function render(items: GlucoseStatsItem[]): string {
  return renderToStaticMarkup(<GlucoseStatsBar items={items} />);
}

/** 报表页的四项形态（R20）：作为公共组件的典型输入 */
const FOUR_ITEMS: GlucoseStatsItem[] = [
  { label: '总计', value: '17', suffix: ' 次', numeric: true },
  { label: '合格次数', value: '10', suffix: ' 次', numeric: true, divider: true },
  { label: '最高血糖', value: '9.8', suffix: ' mmol/L', numeric: true, color: '#FF1516' },
  { label: '最低血糖', value: '-', numeric: false },
];

describe('GlucoseStatsBar — 公共统计栏渲染', () => {
  it('渲染 `label：value suffix`，冒号为中文全角', () => {
    const text = textOf(render(FOUR_ITEMS));

    expect(text).toContain('总计：17 次');
    expect(text).toContain('合格次数：10 次');
    expect(text).toContain('最高血糖：9.8 mmol/L');
    expect(text).toContain('最低血糖：-');
  });

  it('段落间距 20px：首项不带左间距，其余每项（含分隔符）各带一处，共 4 处', () => {
    const html = render(FOUR_ITEMS);

    // 第 2 项带 divider → 分隔符 1 处 + 自身 1 处；第 3/4 项各 1 处；首项 0 处
    expect(html.split(`margin-left:${STATS_GAP_PX}px`).length - 1).toBe(4);
  });

  it('单项时无任何左间距（首项豁免，避免整栏右移）', () => {
    const html = render([{ label: '总计', value: '17', numeric: true }]);

    expect(html).not.toContain('margin-left');
  });

  it('divider：该项前渲染竖线；无 divider 则不出现竖线', () => {
    expect(textOf(render(FOUR_ITEMS))).toContain('|');
    expect(textOf(render([FOUR_ITEMS[0], FOUR_ITEMS[2]]))).not.toContain('|');
  });

  it('numeric：值与后缀包在 gc-num 内（等宽数字，位数变化不跳动）', () => {
    const html = render([{ label: '总计', value: '17', suffix: ' 次', numeric: true }]);

    expect(html).toContain('gc-num');
  });

  it('非 numeric：不包 gc-num（High/Low/- 这类文案用等宽字体观感不一致）', () => {
    const html = render([{ label: '最高血糖', value: 'High', numeric: false }]);

    expect(html).not.toContain('gc-num');
  });

  it('着色只作用于值本身：suffix 不染色（整段染色会让单位也带告警色，同 D4 口径）', () => {
    const html = render([
      { label: '最高血糖', value: '9.8', suffix: ' mmol/L', numeric: true, color: '#FF1516' },
    ]);

    expect(html.split('#FF1516').length - 1).toBe(1);
    expect(textOf(html)).toContain('最高血糖：9.8 mmol/L');
  });

  it('不传 color：不输出内联 color（字典未加载时不着色，而非回退到硬编码色值）', () => {
    const html = render([{ label: '最高血糖', value: '4', numeric: false }]);

    expect(html).not.toContain('color:');
  });

  it('空数组：不抛异常、渲染为空文本（调用方据此决定是否显示统计区）', () => {
    expect(textOf(render([]))).toBe('');
  });

  it('省略 label：不渲染「label：」前缀，只输出值与后缀（P4-7 预警栏的纯「Y次」段）', () => {
    const html = render([
      { label: '总计', value: '17', suffix: '人', numeric: true },
      { value: '42', suffix: '次', numeric: true },
    ]);

    expect(textOf(html)).toContain('总计：17人');
    expect(textOf(html)).toContain('42次');
    // 无 label 项不产生第二个全角冒号
    expect(textOf(html).split('：')).toHaveLength(2);
  });

  it('省略 label 的项 key 回退 index：多项无 label 并存不抛 key 冲突', () => {
    const html = render([
      { value: '42', suffix: '次', numeric: true },
      { value: '7', suffix: '人', numeric: true },
    ]);

    expect(textOf(html)).toContain('42次');
    expect(textOf(html)).toContain('7人');
  });
});
