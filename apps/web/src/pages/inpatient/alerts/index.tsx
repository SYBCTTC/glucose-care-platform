import { Alert, Card } from 'antd';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import AlertFilter from './AlertFilter';
import AlertStatsBar from './AlertStatsBar';
import AlertTable from './AlertTable';
import type { AlertTab } from './alert-stats';
import { useAlertQuery } from './useAlertQuery';

/** 顶部 Tab（规格 §6：文字高亮 underline，同患者管理住院/出院样式） */
const ALERT_TABS: TabItem[] = [
  { key: 'all', label: '所有预警' },
  { key: 'high', label: '高血糖预警' },
  { key: 'low', label: '低血糖预警' },
];

/** 区块间距（同患者管理页内联 16 先例） */
const SECTION_GAP = 16;

/**
 * 住院管理-预警管理（P4-7，docs/specs/glucose-alerts.md）。
 * 敏感数据页：路由守卫已按 alert:view 权限点拦截（routes.tsx）；
 * 姓名列恒为脱敏文，本页无解掩入口。
 */
export default function AlertManagementPage() {
  const query = useAlertQuery();

  return (
    <Card>
      <div style={{ marginBottom: SECTION_GAP }}>
        <Tabs
          items={ALERT_TABS}
          value={query.tab}
          onChange={(key) => query.changeTab(key as AlertTab)}
          variant="underline"
        />
      </div>
      <div style={{ marginBottom: SECTION_GAP }}>
        <AlertFilter
          filters={query.filters}
          departments={query.departmentOptions}
          doctors={query.doctorOptions}
          onDepartmentChange={query.setDepartment}
          onDoctorChange={query.setDoctor}
          onPatch={query.patch}
          onSearch={query.search}
          onReset={query.reset}
          loading={query.loading}
        />
      </div>
      <div style={{ marginBottom: SECTION_GAP }}>
        <AlertStatsBar tab={query.tab} stats={query.result?.stats ?? null} />
      </div>
      {query.error ? (
        <Alert type="error" showIcon message={query.error} style={{ marginBottom: 12 }} />
      ) : null}
      <AlertTable
        items={query.result?.items ?? []}
        total={query.result?.total ?? 0}
        loading={query.loading}
        page={query.page}
        pageSize={query.pageSize}
        tab={query.tab}
        onPageChange={query.changePage}
      />
    </Card>
  );
}
