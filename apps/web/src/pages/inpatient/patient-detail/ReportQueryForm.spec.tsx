/**
 * R24 报表查询表单测试：联动状态机纯函数 + label 构造 + 受控组件渲染。
 *
 * 纯函数是 18 项裁定中联动规则（Q5~Q13/Q15/Q17）的验收主体；
 * 组件渲染沿用 `renderToStaticMarkup` 口径（无 jsdom，交互靠手工 e2e）。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { PATIENT_STATUS } from '@gc/shared';
import type { AdmissionsResponse } from '@gc/shared';
import {
  ADMISSION_ALL,
  FALLBACK_FORM_STATE,
  ReportQueryForm,
  buildAdmissionLabel,
  buildAdmissionOptions,
  buildDepartmentLabel,
  buildDepartmentOptions,
  deriveAdmissionSelection,
  deriveQueryDefaults,
  deriveStaySelection,
  deriveTimeBounds,
  isRangeInverted,
  toReportRange,
} from './ReportQueryForm';
import type { ReportQueryFormState } from './ReportQueryForm';

/**
 * 夹具：住院患者、两次住院——
 * 第 2 次在院（转科一次：心内科已结束 → 内分泌科进行中）；第 1 次已出院（单科室）。
 */
function fixture(status: string = PATIENT_STATUS.INPATIENT): AdmissionsResponse {
  return {
    status: status as AdmissionsResponse['status'],
    admissions: [
      {
        id: 'a-2',
        seq: 2,
        admittedAt: '2026-11-01 09:00:00',
        dischargedAt: null,
        isCurrent: status === PATIENT_STATUS.INPATIENT,
        departments: [
          {
            id: 'ad-2a',
            departmentId: 'd-cardio',
            departmentName: '心内科',
            startedAt: '2026-11-01 09:00:00',
            endedAt: '2026-11-10 08:00:00',
          },
          {
            id: 'ad-2b',
            departmentId: 'd-endo',
            departmentName: '内分泌科',
            startedAt: '2026-11-10 08:00:00',
            endedAt: null,
          },
        ],
      },
      {
        id: 'a-1',
        seq: 1,
        admittedAt: '2026-10-01 08:00:00',
        dischargedAt: '2026-10-20 10:00:00',
        isCurrent: false,
        departments: [
          {
            id: 'ad-1',
            departmentId: 'd-endo',
            departmentName: '内分泌科',
            startedAt: '2026-10-01 08:00:00',
            endedAt: '2026-10-20 10:00:00',
          },
        ],
      },
    ],
  };
}

/* -------------------- 初始默认态（裁定 Q15） -------------------- */

describe('deriveQueryDefaults — 初始默认态', () => {
  it('在院 → 本次住院 + 进行中科室 + 该科室开始时间，结束时间为空（在科中）', () => {
    expect(deriveQueryDefaults(fixture())).toEqual({
      admissionId: 'a-2',
      departmentStayId: 'ad-2b',
      startTime: '2026-11-10 08:00:00',
      endTime: null,
    });
  });

  it('出院 → 全部 + 科室清空 + 时间无限制', () => {
    expect(deriveQueryDefaults(fixture(PATIENT_STATUS.DISCHARGED))).toEqual({
      ...FALLBACK_FORM_STATE,
    });
  });

  it('防御：status 在院但无 isCurrent 记录（脏数据）→ 退化为全部', () => {
    const data = fixture(PATIENT_STATUS.DISCHARGED);
    data.status = PATIENT_STATUS.INPATIENT as AdmissionsResponse['status'];
    expect(deriveQueryDefaults(data).admissionId).toBe(ADMISSION_ALL);
  });
});

/* -------------------- 住院记录切换联动（需求规则 2/3，裁定 Q9/Q10） -------------------- */

describe('deriveAdmissionSelection — 切换住院记录', () => {
  it('选历史住院 → 科室默认第一条（入院科室），时间 = 该科室起止', () => {
    expect(deriveAdmissionSelection(fixture(), 'a-1')).toEqual({
      admissionId: 'a-1',
      departmentStayId: 'ad-1',
      startTime: '2026-10-01 08:00:00',
      endTime: '2026-10-20 10:00:00',
    });
  });

  it('选本次住院 → 科室默认进行中记录', () => {
    expect(deriveAdmissionSelection(fixture(), 'a-2').departmentStayId).toBe('ad-2b');
  });

  it('选「全部」→ 科室清空、时间清空无限制', () => {
    expect(deriveAdmissionSelection(fixture(), ADMISSION_ALL)).toEqual({
      ...FALLBACK_FORM_STATE,
    });
  });

  it('防御：未知住院 id → 退化为全部', () => {
    expect(deriveAdmissionSelection(fixture(), 'a-404')).toEqual({ ...FALLBACK_FORM_STATE });
  });
});

/* -------------------- 科室记录切换联动（裁定 Q10/Q11 + §11-1） -------------------- */

describe('deriveStaySelection — 切换/清空科室记录', () => {
  const base: ReportQueryFormState = {
    admissionId: 'a-2',
    departmentStayId: 'ad-2b',
    startTime: '2026-11-10 08:00:00',
    endTime: null,
  };

  it('选中已结束的历史停留 → 时间 = 该停留起止（「全部」场景同样联动，裁定 Q10）', () => {
    expect(deriveStaySelection(fixture(), { ...base, admissionId: ADMISSION_ALL }, 'ad-2a')).toEqual({
      admissionId: ADMISSION_ALL,
      departmentStayId: 'ad-2a',
      startTime: '2026-11-01 09:00:00',
      endTime: '2026-11-10 08:00:00',
    });
  });

  it('清空 + 已选具体住院 → 时间回退为该住院记录起止（§11-1）', () => {
    expect(deriveStaySelection(fixture(), base, null)).toEqual({
      admissionId: 'a-2',
      departmentStayId: null,
      startTime: '2026-11-01 09:00:00',
      endTime: null, // 在院：本次住院 dischargedAt 为空
    });
  });

  it('清空 + 「全部」→ 时间清空、无限制（裁定 Q11）', () => {
    expect(
      deriveStaySelection(fixture(), { ...base, admissionId: ADMISSION_ALL }, null),
    ).toEqual({
      admissionId: ADMISSION_ALL,
      departmentStayId: null,
      startTime: null,
      endTime: null,
    });
  });
});

/* -------------------- 时间上下限（裁定 Q12，三层回退） -------------------- */

describe('deriveTimeBounds — 时间控件上下限', () => {
  it('已选科室记录 → [startedAt, endedAt]；进行中上限 = 今天 23:59:59', () => {
    const ended = deriveTimeBounds(fixture(), {
      admissionId: 'a-2',
      departmentStayId: 'ad-2a',
      startTime: null,
      endTime: null,
    });
    expect(ended.min?.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-11-01 09:00:00');
    expect(ended.max?.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-11-10 08:00:00');

    const active = deriveTimeBounds(fixture(), {
      admissionId: 'a-2',
      departmentStayId: 'ad-2b',
      startTime: null,
      endTime: null,
    });
    expect(active.max?.isSame(dayjs().endOf('day'))).toBe(true);
  });

  it('科室清空 + 已选住院 → 回退为住院记录范围', () => {
    const bounds = deriveTimeBounds(fixture(), {
      admissionId: 'a-1',
      departmentStayId: null,
      startTime: null,
      endTime: null,
    });
    expect(bounds.min?.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-10-01 08:00:00');
    expect(bounds.max?.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-10-20 10:00:00');
  });

  it('「全部」+ 科室清空 → 无限制', () => {
    expect(deriveTimeBounds(fixture(), { ...FALLBACK_FORM_STATE })).toEqual({
      min: null,
      max: null,
    });
  });
});

/* -------------------- label 构造（裁定 Q5/Q7/Q8） -------------------- */

describe('buildAdmissionLabel / buildDepartmentLabel', () => {
  it('本次住院 → 固定文案；历史 → 第N次 (起 ~ 止)；日期空 → 只显次数（Q7）', () => {
    const data = fixture();
    expect(buildAdmissionLabel(data.admissions[0])).toBe('本次住院');
    expect(buildAdmissionLabel(data.admissions[1])).toBe('第1次 (2026-10-01 ~ 2026-10-20)');
    expect(
      buildAdmissionLabel({ ...data.admissions[1], admittedAt: null, dischargedAt: null }),
    ).toBe('第1次');
  });

  it('科室：完整区间 / 进行中「至今」/ 只止 / 无日期', () => {
    expect(buildDepartmentLabel(fixture().admissions[1].departments[0])).toBe(
      '内分泌科 (2026-10-01 ~ 2026-10-20)',
    );
    expect(buildDepartmentLabel(fixture().admissions[0].departments[1])).toBe(
      '内分泌科 (2026-11-10 ~ 至今)',
    );
    expect(
      buildDepartmentLabel({
        id: 'x',
        departmentId: 'd',
        departmentName: '心内科',
        startedAt: null,
        endedAt: '2026-11-10 08:00:00',
      }),
    ).toBe('心内科 (~ 2026-11-10)');
    expect(
      buildDepartmentLabel({
        id: 'x',
        departmentId: 'd',
        departmentName: '心内科',
        startedAt: null,
        endedAt: null,
      }),
    ).toBe('心内科');
  });
});

/* -------------------- 下拉选项集（需求规则 2/3，裁定 Q6） -------------------- */

describe('buildAdmissionOptions / buildDepartmentOptions', () => {
  it('住院选项保持接口降序，「全部」恒为末项', () => {
    const options = buildAdmissionOptions(fixture());
    expect(options.map((option) => option.value)).toEqual(['a-2', 'a-1', ADMISSION_ALL]);
    expect(options[0].label).toBe('本次住院');
  });

  it('科室选项：具体住院 = 该住院停留；「全部」= 跨住院平铺（每段一条）', () => {
    expect(buildDepartmentOptions(fixture(), 'a-2').map((option) => option.value)).toEqual([
      'ad-2a',
      'ad-2b',
    ]);
    expect(
      buildDepartmentOptions(fixture(), ADMISSION_ALL).map((option) => option.value),
    ).toEqual(['ad-2a', 'ad-2b', 'ad-1']);
  });
});

/* -------------------- 查询范围与校验（裁定 Q13） -------------------- */

describe('toReportRange / isRangeInverted', () => {
  it('null → undefined（该侧不限）', () => {
    expect(
      toReportRange({
        admissionId: ADMISSION_ALL,
        departmentStayId: null,
        startTime: '2026-11-01 09:00:00',
        endTime: null,
      }),
    ).toEqual({ startTime: '2026-11-01 09:00:00', endTime: undefined });
  });

  it('开始 > 结束 → 阻止查询；单侧为空不判反', () => {
    expect(
      isRangeInverted({
        admissionId: ADMISSION_ALL,
        departmentStayId: null,
        startTime: '2026-11-30 00:00:00',
        endTime: '2026-11-01 00:00:00',
      }),
    ).toBe(true);
    expect(
      isRangeInverted({
        admissionId: ADMISSION_ALL,
        departmentStayId: null,
        startTime: '2026-11-01 00:00:00',
        endTime: '2026-11-30 00:00:00',
      }),
    ).toBe(false);
    expect(
      isRangeInverted({
        admissionId: ADMISSION_ALL,
        departmentStayId: null,
        startTime: null,
        endTime: '2026-11-30 00:00:00',
      }),
    ).toBe(false);
  });
});

/* -------------------- 受控组件渲染 -------------------- */

describe('ReportQueryForm — 渲染', () => {
  it('数据未就绪：控件禁用、打印隐藏', () => {
    const html = renderToStaticMarkup(
      <ReportQueryForm
        data={null}
        loading
        state={null}
        onChange={() => {}}
        onSearch={() => {}}
        onReset={() => {}}
      />,
    );
    expect(html).toContain('gc-no-print');
    // antd 双汉字按钮自动插空格（autoInsertSpace），渲染为「查 询」「重 置」
    expect(html).toContain('查 询');
    expect(html).toContain('重 置');
    // antd Button disabled 渲染为 disabled 属性
    expect(html).toContain('disabled');
  });

  it('就绪态：渲染选中 label 与时间值', () => {
    const html = renderToStaticMarkup(
      <ReportQueryForm
        data={fixture()}
        loading={false}
        state={deriveQueryDefaults(fixture())}
        onChange={() => {}}
        onSearch={() => {}}
        onReset={() => {}}
      />,
    );
    expect(html).toContain('本次住院');
    expect(html).toContain('内分泌科 (2026-11-10 ~ 至今)');
    expect(html).toContain('2026-11-10 08:00:00');
    expect(html).not.toContain('disabled');
  });
});
