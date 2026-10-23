import { Card, Spin, Typography } from 'antd';
import VirtualWardFilter from './VirtualWardFilter';
import VirtualWardToolbar from './VirtualWardToolbar';
import { useVirtualWardQuery } from './useVirtualWardQuery';

export default function VirtualWardPage() {
  const query = useVirtualWardQuery();

  return (
    <Card>
      <VirtualWardToolbar value={query.tab} onChange={query.changeTab} />
      <VirtualWardFilter
        tab={query.tab}
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
      <div style={{ marginTop: 16 }}>
        {query.loading ? (
          <Spin />
        ) : (
          <Typography.Text type="secondary">
            共 {query.result?.total ?? 0} 条（虚拟病区列表 UI 待开发）
          </Typography.Text>
        )}
        {query.error ? (
          <Typography.Text type="danger" style={{ marginLeft: 12 }}>
            {query.error}
          </Typography.Text>
        ) : null}
      </div>
    </Card>
  );
}
