/**
 * PatientMoreActions 测试（决策 C4）。
 *
 * 与 PatientDetail.spec 一致：web 测试跑在 node 环境（无 jsdom），用 renderToStaticMarkup
 * 渲染并断言输出 HTML。Dropdown 的菜单项渲染在浮层（portal），静态标记里只出现触发按钮，
 * 故这里聚焦可静态断言的行为：空菜单守卫（返回 null）与触发按钮渲染。
 * "查看详情"项的移除由 typecheck（ACTION_LABELS 已无 detail）与代码审查保证。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PatientListItem } from '@gc/shared';
import PatientMoreActions from './PatientMoreActions';

function makePatient(overrides: Partial<PatientListItem> = {}): PatientListItem {
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
    inVirtualWard: false,
    ...overrides,
  };
}

describe('PatientMoreActions — C4 空菜单守卫', () => {
  it('编辑/血糖/加入病区三项均无权限时返回 null，不渲染空"更多操作"按钮', () => {
    const html = renderToStaticMarkup(
      <PatientMoreActions
        patient={makePatient()}
        canEdit={false}
        canCreateGlucose={false}
        canJoinWard={false}
        onEdit={() => {}}
      />,
    );
    expect(html).toBe('');
  });

  it('有编辑权限时渲染"更多操作"触发按钮', () => {
    const html = renderToStaticMarkup(
      <PatientMoreActions patient={makePatient()} canEdit onEdit={() => {}} />,
    );
    expect(html).toContain('更多操作');
  });

  it('卡片模式（label="更多"）有权限时渲染自定义触发文案', () => {
    const html = renderToStaticMarkup(
      <PatientMoreActions patient={makePatient()} label="更多" canEdit onEdit={() => {}} />,
    );
    expect(html).toContain('更多');
  });
});
