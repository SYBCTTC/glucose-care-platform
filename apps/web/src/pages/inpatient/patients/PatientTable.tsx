import { Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getTimeSlotLabel } from '@gc/shared';
import type { PatientListItem } from '@gc/shared';
import PatientMoreActions from './PatientMoreActions';
import { formatAge, formatHospitalDays, getGenderLabel } from './patient-format';

interface PatientTableProps {
  items: PatientListItem[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
}

const columns: ColumnsType<PatientListItem> = [
  { title: '床号', dataIndex: 'bedNo', width: 90, render: (value: string | null) => value ?? '-' },
  { title: '姓名', dataIndex: 'nameMasked', width: 110 },
  {
    title: '性别',
    dataIndex: 'gender',
    width: 70,
    render: (value: string | null) => getGenderLabel(value),
  },
  {
    title: '年龄',
    dataIndex: 'age',
    width: 80,
    render: (value: number | null) => formatAge(value),
  },
  {
    title: '住院号',
    dataIndex: 'patientNo',
    width: 140,
    render: (value: string | null) => value ?? '-',
  },
  { title: '科室', dataIndex: 'departmentName', width: 120 },
  {
    title: '责任医生',
    dataIndex: 'doctorName',
    width: 110,
    render: (value: string | null) => value ?? '-',
  },
  {
    title: '住院天数',
    key: 'hospitalDays',
    width: 100,
    render: (_, record) => formatHospitalDays(record.admissionAt, record.dischargeAt),
  },
  {
    title: '最近血糖',
    dataIndex: 'lastGlucoseValue',
    width: 120,
    render: (value: number | null) =>
      value === null ? '-' : <Typography.Text strong>{value.toFixed(1)} mmol/L</Typography.Text>,
  },
  {
    title: '测量时段',
    dataIndex: 'lastGlucoseMealContext',
    width: 100,
    render: (value: string | null) => (value ? getTimeSlotLabel(value) : '-'),
  },
  {
    title: '测量时间',
    dataIndex: 'lastGlucoseMeasuredAt',
    width: 170,
    render: (value: string | null) => value ?? '-',
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    fixed: 'right',
    render: () => <PatientMoreActions />,
  },
];

export default function PatientTable({
  items,
  total,
  loading,
  page,
  pageSize,
  onPageChange,
}: PatientTableProps) {
  return (
    <Table<PatientListItem>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      size="middle"
      scroll={{ x: 1400 }}
      locale={{ emptyText: '暂无患者数据' }}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        showQuickJumper: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (count) => `共 ${count} 条`,
        onChange: onPageChange,
      }}
    />
  );
}
