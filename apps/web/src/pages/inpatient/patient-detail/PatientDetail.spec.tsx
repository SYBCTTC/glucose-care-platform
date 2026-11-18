/**
 * 患者详情展示组件测试。
 *
 * 测试环境说明：与 permission-route.spec 一致，web 测试跑在 node 环境（无 jsdom），
 * 用 react-dom/server 的 renderToStaticMarkup 渲染**纯展示子组件**（PatientBasicInfo /
 * PatientDetailTabs）并断言输出 HTML。页面壳 index.tsx 含异步拉取与路由依赖，靠 typecheck + 手工 e2e 验证。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PatientDetail } from '@gc/shared';
import PatientBasicInfo from './PatientBasicInfo';
import PatientDetailTabs from './PatientDetailTabs';

function makeDetail(overrides: Partial<PatientDetail> = {}): PatientDetail {
  return {
    id: 'p1',
    nameMasked: '张**',
    patientNo: 'P0001',
    gender: 'MALE',
    bedNo: '12床',
    departmentId: 'd1',
    departmentName: '内分泌科',
    doctorId: 'doc1',
    doctorName: '李医生',
    status: 'INPATIENT',
    admissionAt: '2026-03-01 08:00:00',
    dischargeAt: null,
    archivedAt: null,
    age: 45,
    lastGlucoseResultType: null,
    lastGlucoseValue: null,
    lastGlucoseMealContext: null,
    lastGlucoseMeasuredAt: null,
    inVirtualWard: true,
    idCardMasked: '110***********1234',
    phoneMasked: '138****1234',
    birthDate: '1981-01-01',
    remark: null,
    nurseId: 'n1',
    nurseName: '赵护士',
    diabetesType: 'TYPE_2',
    hba1c: 7.5,
    devices: [],
    ...overrides,
  };
}

describe('PatientBasicInfo — 基本信息区渲染', () => {
  it('展示姓名/性别/年龄（仅值）与脱敏身份证/手机号、责任护士等 label：值字段', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo detail={makeDetail()} canAddGlucose={false} onAddGlucose={() => {}} />,
    );
    expect(html).toContain('张**'); // 姓名（脱敏）
    expect(html).toContain('男'); // getGenderLabel('MALE')
    expect(html).toContain('45 岁'); // formatAge(45)
    expect(html).toContain('110***********1234'); // 脱敏身份证（决策 A2）
    expect(html).toContain('138****1234'); // 脱敏手机号（决策 A2）
    expect(html).toContain('赵护士'); // 责任护士（A1 新字段）
    expect(html).toContain('李医生'); // 责任医生
    expect(html).toContain('内分泌科'); // 科室
    expect(html).toContain('P0001'); // 住院号
    expect(html).toContain('住院'); // PATIENT_STATUS_LABELS.INPATIENT
  });

  it('住院 + 有权限（canAddGlucose）时展示"添加血糖"按钮', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo detail={makeDetail()} canAddGlucose onAddGlucose={() => {}} />,
    );
    expect(html).toContain('添加血糖');
  });

  it('出院或无权限（canAddGlucose=false）时不渲染"添加血糖"按钮（决策 D5）', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail({ status: 'DISCHARGED' })}
        canAddGlucose={false}
        onAddGlucose={() => {}}
      />,
    );
    expect(html).not.toContain('添加血糖');
    expect(html).toContain('出院'); // 状态 label 仍正确
  });

  it('责任护士缺失（nurseName=null）时正常渲染、不显示护士姓名', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail({ nurseName: null })}
        canAddGlucose={false}
        onAddGlucose={() => {}}
      />,
    );
    expect(html).toContain('责任护士');
    expect(html).not.toContain('赵护士');
  });
});

describe('PatientDetailTabs — 默认占位（决策 A4/E1）', () => {
  it('默认进入 血糖数据 → 血糖报告，主/子 Tab 与占位文案齐备', () => {
    const html = renderToStaticMarkup(<PatientDetailTabs />);
    // 主 Tab（下划线）
    expect(html).toContain('血糖数据');
    expect(html).toContain('基本信息');
    expect(html).toContain('出入院记录');
    // 子 Tab（背景色）
    expect(html).toContain('血糖报告');
    expect(html).toContain('血糖记录');
    expect(html).toContain('趋势图');
    // 占位内容
    expect(html).toContain('建设中');
  });
});
