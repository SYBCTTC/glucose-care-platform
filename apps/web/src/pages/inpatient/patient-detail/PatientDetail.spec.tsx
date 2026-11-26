/**
 * 患者详情展示组件测试。
 *
 * 测试环境说明：与 permission-route.spec 一致，web 测试跑在 node 环境（无 jsdom），
 * 用 react-dom/server 的 renderToStaticMarkup 渲染展示型子组件并断言输出 HTML。
 * `PatientDetailTabs` 自 R10 起两层 Tab 都由 URL 派生，故需包一层 `MemoryRouter`
 * （node 环境可用；`useNavigate` 只在 onChange 时调用，渲染期不触发导航）。
 * 页面壳 index.tsx 的异步拉取用 `vi.mock('./usePatientDetail')` 同步化后测试（风险 7：
 * loading / 403 / 加载失败分支不得渲染 `<Outlet/>` 内容，否则越权患者的报表请求仍会发出）。
 * `GlucoseReportTab` 含数据请求与 Outlet context，靠 typecheck + 手工 e2e 验证；
 * Tab 派生逻辑本身是纯函数，单测见 `detail-tabs.spec.ts`。
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PatientDetail } from '@gc/shared';
import DetailPlaceholder from './DetailPlaceholder';
import PatientBasicInfo from './PatientBasicInfo';
import PatientDetailTabs from './PatientDetailTabs';
import PatientDetailPage from './index';

/** 壳组件的详情拉取结果（mock 后可同步切换 loading / 403 / 失败 / 成功四个分支） */
const detailState = vi.hoisted(() => ({
  current: {
    data: null as PatientDetail | null,
    loading: true,
    error: null as string | null,
    forbidden: false,
  },
}));

vi.mock('./usePatientDetail', () => ({
  usePatientDetail: () => detailState.current,
}));

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

/** P2-6：PatientBasicInfo 新增「更多操作」下拉 props，测试统一给默认值 */
const noMoreActions = {
  canDischarge: false,
  canAdmit: false,
  onDischarge: () => {},
  onAdmit: () => {},
} as const;

describe('PatientBasicInfo — 基本信息区渲染', () => {
  it('展示姓名/性别/年龄（仅值）与脱敏身份证/手机号、责任护士等 label：值字段', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail()}
        canAddGlucose={false}
        onAddGlucose={() => {}}
        {...noMoreActions}
      />,
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
      <PatientBasicInfo
        detail={makeDetail()}
        canAddGlucose
        onAddGlucose={() => {}}
        {...noMoreActions}
      />,
    );
    expect(html).toContain('添加血糖');
  });

  it('出院或无权限（canAddGlucose=false）时不渲染"添加血糖"按钮（决策 D5）', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail({ status: 'DISCHARGED' })}
        canAddGlucose={false}
        onAddGlucose={() => {}}
        {...noMoreActions}
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
        {...noMoreActions}
      />,
    );
    expect(html).toContain('责任护士');
    expect(html).not.toContain('赵护士');
  });
});

/**
 * P2-6「更多操作」下拉（裁定 Q3/6）。菜单项渲染在浮层（portal），静态标记里
 * 只出现触发按钮（同 PatientMoreActions.spec 口径）：这里断言触发按钮的有无。
 */
describe('PatientBasicInfo — 更多操作下拉（P2-6）', () => {
  it('住院患者 + patient:discharge → 渲染"更多操作"触发按钮', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail()}
        canAddGlucose={false}
        onAddGlucose={() => {}}
        {...noMoreActions}
        canDischarge
      />,
    );
    expect(html).toContain('更多操作');
  });

  it('出院患者 + patient:admit → 渲染"更多操作"触发按钮（无"添加血糖"）', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail({ status: 'DISCHARGED' })}
        canAddGlucose={false}
        onAddGlucose={() => {}}
        {...noMoreActions}
        canAdmit
      />,
    );
    expect(html).toContain('更多操作');
    expect(html).not.toContain('添加血糖');
  });

  it('两项均无权限 → 整个下拉不渲染（裁定 6：菜单为空时隐藏）', () => {
    const html = renderToStaticMarkup(
      <PatientBasicInfo
        detail={makeDetail()}
        canAddGlucose={false}
        onAddGlucose={() => {}}
        {...noMoreActions}
      />,
    );
    expect(html).not.toContain('更多操作');
  });
});

/**
 * 在指定 pathname 下渲染 Tabs 区。
 * `PatientDetailTabs` 现在两层 Tab 都由 URL 派生（R10），必须包一层 Router；
 * `MemoryRouter` 在 node 环境可用，且 `useNavigate` 只在 onChange 时调用，渲染期不会触发导航。
 */
function renderTabs(pathname: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <PatientDetailTabs
        outletContext={{
          glucoseVersion: 0,
          statusVersion: 0,
          // R25：context 契约新增两项（本测试只渲染 Tabs 壳，给稳定空值即可）
          onGlucoseChanged: () => {},
          patient: { id: 'p1', nameMasked: '林*', status: 'INPATIENT' },
          // R28：完整详情（打印头数据源）；本测试只渲染 Tabs 壳，最小占位即可
          patientDetail: { id: 'p1', nameMasked: '林*', status: 'INPATIENT' } as PatientDetail,
        }}
      />
    </MemoryRouter>,
  );
}

describe('PatientDetailTabs — 双层 Tab 由 URL 驱动（R10）', () => {
  const BASE = '/inpatient/patients/p1';

  it('血糖子页：主 Tab 三项 + 血糖子 Tab 三项齐备', () => {
    const html = renderTabs(`${BASE}/glucose/report`);
    // 主 Tab（下划线）。第二项 2026-11-25 由「基本信息」改名为「控糖目标」（裁定 M）
    expect(html).toContain('血糖数据');
    expect(html).toContain('控糖目标');
    expect(html).toContain('出入院记录');
    // 子 Tab（背景色）
    expect(html).toContain('血糖报告');
    expect(html).toContain('血糖记录');
    expect(html).toContain('趋势图');
  });

  it('裸详情 URL 回落默认：仍按「血糖数据」渲染子 Tab（与 index 重定向目标一致）', () => {
    const html = renderTabs(BASE);
    expect(html).toContain('血糖报告');
    expect(html).toContain('趋势图');
  });

  it('控糖目标 Tab：不渲染血糖子 Tab（子 Tab 只属于「血糖数据」）', () => {
    const html = renderTabs(`${BASE}/target`);
    expect(html).toContain('控糖目标');
    expect(html).not.toContain('血糖记录');
    expect(html).not.toContain('趋势图');
  });

  it('旧「基本信息」路径 /basic 已失效（裁定 M 刻意不做重定向）：回落默认页而非空白', () => {
    const html = renderTabs(`${BASE}/basic`);
    // 回落默认 = 血糖数据 / 血糖报告，因此会渲染血糖子 Tab（与 /target 的行为明显不同）
    expect(html).toContain('血糖报告');
    // 主 Tab 栏仍完整，不会出现「Tab 栏在、无高亮、内容区空白」的空档
    expect(html).toContain('控糖目标');
  });

  it('出入院记录 Tab：同样不渲染血糖子 Tab', () => {
    const html = renderTabs(`${BASE}/admission`);
    expect(html).toContain('出入院记录');
    expect(html).not.toContain('血糖报告');
  });

  it('未知子路径回落默认，不出现「两层 Tab 都不亮」的空档', () => {
    const html = renderTabs(`${BASE}/not-a-real-tab`);
    expect(html).toContain('血糖报告');
  });

  it('内容区交给 <Outlet/>：占位文案不再由本组件渲染', () => {
    // 占位已下沉到各子路由的 DetailPlaceholder；此处无匹配路由，Outlet 渲染 null
    const html = renderTabs(`${BASE}/glucose/record`);
    expect(html).not.toContain('建设中');
  });

  it('血糖报告子 Tab：渲染四个展示项勾选且默认全勾选（R22 规则 1/2）', () => {
    const html = renderTabs(`${BASE}/glucose/report`);

    expect(html).toContain('常规血糖');
    expect(html).toContain('强化血糖');
    expect(html).toContain('检测时间');
    expect(html).toContain('操作人');
    // 默认全勾选（规则 3 的"至少一项"约束天然满足）
    expect(html.split('ant-checkbox-checked').length - 1).toBe(4);
  });

  it('其他血糖子 Tab：不渲染展示项勾选（R22 规则 2）', () => {
    expect(renderTabs(`${BASE}/glucose/record`)).not.toContain('常规血糖');
    expect(renderTabs(`${BASE}/glucose/trend`)).not.toContain('常规血糖');
  });

  it('主 Tab 非血糖数据：同样不渲染展示项勾选（R22 规则 2）', () => {
    expect(renderTabs(`${BASE}/target`)).not.toContain('常规血糖');
    expect(renderTabs(`${BASE}/admission`)).not.toContain('常规血糖');
  });
});

describe('DetailPlaceholder — 未实现内容页占位', () => {
  it('渲染「XXX（建设中）」且不发请求', () => {
    const html = renderToStaticMarkup(<DetailPlaceholder label="血糖记录" />);
    expect(html).toContain('血糖记录（建设中）');
  });
});

/**
 * 风险 7（glucose-report.md §12.1）：<Outlet/> 必须留在 data 已加载分支内。
 * 若提到 loading / !data 分支之外，患者 403/404 时报表子路由仍会挂载并发出
 * /glucose/report 请求（越权探测面 + 多余审计）。用哨兵子路由直接断言挂载与否。
 */
function renderShell(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/inpatient/patients/p1/glucose/report']}>
      <Routes>
        <Route path="/inpatient/patients/:id" element={<PatientDetailPage />}>
          <Route path="glucose/report" element={<div>REPORT_SENTINEL</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('PatientDetailPage 壳 — loading / 失败分支不渲染 <Outlet/> 内容（风险 7）', () => {
  it('loading：只有 Spin，报表子路由不挂载、Tab 栏不渲染', () => {
    detailState.current = { data: null, loading: true, error: null, forbidden: false };
    const html = renderShell();
    expect(html).toContain('ant-spin');
    expect(html).not.toContain('REPORT_SENTINEL');
    expect(html).not.toContain('血糖数据');
  });

  it('403 越权：显示「无权查看该患者」，报表子路由不挂载（不发 /glucose/report 请求）', () => {
    detailState.current = {
      data: null,
      loading: false,
      error: '无权访问该患者',
      forbidden: true,
    };
    const html = renderShell();
    expect(html).toContain('无权查看该患者');
    expect(html).not.toContain('REPORT_SENTINEL');
    expect(html).not.toContain('血糖数据');
  });

  it('其它加载失败：显示「无法加载患者详情」，报表子路由不挂载', () => {
    detailState.current = {
      data: null,
      loading: false,
      error: '患者不存在或已被删除',
      forbidden: false,
    };
    const html = renderShell();
    expect(html).toContain('无法加载患者详情');
    expect(html).not.toContain('REPORT_SENTINEL');
  });

  it('data 已加载：基本信息区 + Tab 栏 + <Outlet/> 内容一并渲染', () => {
    detailState.current = {
      data: makeDetail(),
      loading: false,
      error: null,
      forbidden: false,
    };
    const html = renderShell();
    expect(html).toContain('张**'); // 基本信息摘要区
    expect(html).toContain('血糖数据'); // 主 Tab 栏
    expect(html).toContain('REPORT_SENTINEL'); // Outlet 子路由内容
  });
});
