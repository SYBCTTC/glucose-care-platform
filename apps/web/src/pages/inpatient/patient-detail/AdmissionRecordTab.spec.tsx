import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdmissionOption } from '@gc/shared';
import { ADMISSION_COLUMNS, AdmissionDateCell, renderAdmissionCell } from './AdmissionRecordTab';

/**
 * 出入院记录 Tab 展示逻辑测试（规格 docs/specs/patient-admission-records.md §6）。
 *
 * 沿用本仓 web 测试口径：**node 环境 + `renderToStaticMarkup`**（无 jsdom），
 * 只测展示型子组件与列 render 纯函数；容器组件 `AdmissionRecordTab` 依赖
 * `useParams` / `useOutletContext` / 请求，由 typecheck + playwright e2e 覆盖
 * （同 PatientGlucoseTargetTab.spec 的分工约定）。
 */

function makeRow(overrides: Partial<AdmissionOption> = {}): AdmissionOption {
  return {
    id: 'a1',
    seq: 2,
    admittedAt: '2026-11-17 08:00:00',
    dischargedAt: '2026-11-26 13:43:18',
    isCurrent: false,
    departmentName: '内分泌科',
    patientNo: 'P2026000035',
    doctorName: '王医生',
    nurseName: '李护士',
    operatorName: '李护士',
    departments: [],
    ...overrides,
  };
}

/** 按列 key 取单元格输出：有 render 直接调用，纯 dataIndex 列（科室）读原值 */
function renderColumn(key: string, row: AdmissionOption): string {
  const column = ADMISSION_COLUMNS.find((item) => item.key === key);
  if (!column) {
    throw new Error(`列 ${key} 不存在`);
  }
  // 模拟 antd 的取值口径：dataIndex 列把行内实际值作为 render 第一参
  // （ColumnsType 是 ColumnGroupType | ColumnType 联合，dataIndex 需先收窄）
  const dataIndex = 'dataIndex' in column ? (column.dataIndex as keyof AdmissionOption) : null;
  const value = dataIndex ? (row[dataIndex] as string | null) : null;
  const node = typeof column.render === 'function' ? column.render(value, row, 0) : value;
  return typeof node === 'string' ? node : renderToStaticMarkup(<>{node}</>);
}

describe('AdmissionDateCell — 日期列拼接（需求规则 3）', () => {
  it('完整区间：开始 至 结束，gc-num 等宽', () => {
    const html = renderToStaticMarkup(
      <AdmissionDateCell admittedAt="2026-11-17 08:00:00" dischargedAt="2026-11-26 13:43:18" />,
    );
    expect(html).toContain('2026-11-17 08:00:00 至 2026-11-26 13:43:18');
    expect(html).toContain('gc-num');
  });

  it('在院行（dischargedAt 为 null）：显示「至 -」', () => {
    const html = renderToStaticMarkup(
      <AdmissionDateCell admittedAt="2026-11-26 13:46:27" dischargedAt={null} />,
    );
    expect(html).toContain('2026-11-26 13:46:27 至 -');
  });

  it('存量行 admittedAt 为 null（裁定 Q7 口径）：显示「- 至 …」不残缺', () => {
    const html = renderToStaticMarkup(
      <AdmissionDateCell admittedAt={null} dischargedAt="2026-11-26 13:43:18" />,
    );
    expect(html).toContain('- 至 2026-11-26 13:43:18');
  });
});

describe('renderAdmissionCell — 快照列空值口径（裁定 1：旧行显「-」）', () => {
  it('null 与空串都显示「-」', () => {
    expect(renderToStaticMarkup(<>{renderAdmissionCell(null)}</>)).toBe('-');
    expect(renderToStaticMarkup(<>{renderAdmissionCell('')}</>)).toBe('-');
  });

  it('有值原样展示；numeric 加 gc-num', () => {
    expect(renderToStaticMarkup(<>{renderAdmissionCell('王医生')}</>)).toContain('王医生');
    const numeric = renderToStaticMarkup(<>{renderAdmissionCell('P0001', true)}</>);
    expect(numeric).toContain('P0001');
    expect(numeric).toContain('gc-num');
  });
});

describe('ADMISSION_COLUMNS — 表头与列渲染（需求规则 2）', () => {
  it('六个表头齐备且顺序一致：日期/科室/住院号/责任医生/责任护士/操作人', () => {
    expect(ADMISSION_COLUMNS.map((column) => column.title)).toEqual([
      '日期',
      '科室',
      '住院号',
      '责任医生',
      '责任护士',
      '操作人',
    ]);
  });

  it('完整行：六列均展示当次值', () => {
    const row = makeRow();
    expect(renderColumn('date', row)).toContain('2026-11-17 08:00:00 至 2026-11-26 13:43:18');
    expect(renderColumn('departmentName', row)).toContain('内分泌科');
    expect(renderColumn('patientNo', row)).toContain('P2026000035');
    expect(renderColumn('doctorName', row)).toContain('王医生');
    expect(renderColumn('nurseName', row)).toContain('李护士');
    expect(renderColumn('operatorName', row)).toContain('李护士');
  });

  it('存量旧行（快照四列为 null）：科室/日期照常，四列显「-」', () => {
    const row = makeRow({
      patientNo: null,
      doctorName: null,
      nurseName: null,
      operatorName: null,
    });
    expect(renderColumn('patientNo', row)).toBe('-');
    expect(renderColumn('doctorName', row)).toBe('-');
    expect(renderColumn('nurseName', row)).toBe('-');
    expect(renderColumn('operatorName', row)).toBe('-');
    expect(renderColumn('departmentName', row)).toContain('内分泌科');
  });

  it('在院行（isCurrent）：日期列以「至 -」收尾', () => {
    const row = makeRow({ dischargedAt: null, isCurrent: true });
    expect(renderColumn('date', row)).toContain('至 -');
  });
});
