import { useMemo } from 'react';
import { Button, Popconfirm, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getTimeSlotLabel } from '@gc/shared';
import type { PatientListItem } from '@gc/shared';
import LastGlucose from './LastGlucose';
import PatientMoreActions from './PatientMoreActions';
import { formatAge, formatHospitalDays, getGenderLabel } from './patient-format';

interface PatientTableProps {
  items: PatientListItem[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  /** 是否存在患者编辑权限（无权限时菜单里不出现「编辑患者信息」） */
  canEditPatient: boolean;
  /** 是否出院 Tab：出院患者的操作列只有一个「办理住院」按钮 */
  isDischarged: boolean;
  /** 是否有办理住院权限（无权限时操作列为空，后端仍强制校验） */
  canAdmitPatient: boolean;
  /** 正在办理的患者 ID，用于按钮 loading 与防重复提交 */
  admittingId: string | null;
  onEditPatient: (patient: PatientListItem) => void;
  onAdmitPatient: (patient: PatientListItem) => void;
  /** 是否有添加血糖权限（住院 Tab 且具备 GLUCOSE_CREATE 时才为 true） */
  canCreateGlucose: boolean;
  onAddGlucose: (patient: PatientListItem) => void;
}

function buildColumns(
  canEditPatient: boolean,
  isDischarged: boolean,
  canAdmitPatient: boolean,
  admittingId: string | null,
  onEditPatient: (patient: PatientListItem) => void,
  onAdmitPatient: (patient: PatientListItem) => void,
  canCreateGlucose: boolean,
  onAddGlucose: (patient: PatientListItem) => void,
): ColumnsType<PatientListItem> {
  return [
    {
      title: '床号',
      dataIndex: 'bedNo',
      width: 90,
      render: (value: string | null) => value ?? '-',
    },
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
      render: (_, record) => (
        <LastGlucose resultType={record.lastGlucoseResultType} value={record.lastGlucoseValue} />
      ),
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
      render: (_, record) => {
        // 出院 Tab：只有一个「办理住院」按钮，不再提供更多操作菜单
        if (isDischarged) {
          if (!canAdmitPatient) {
            return null;
          }
          return (
            <Popconfirm
              title="办理住院"
              description={`确认将 ${record.nameMasked} 重新办理住院？`}
              okText="确认"
              cancelText="取消"
              onConfirm={() => onAdmitPatient(record)}
            >
              <Button
                type="link"
                size="small"
                loading={admittingId === record.id}
                disabled={admittingId !== null && admittingId !== record.id}
                style={{ paddingInline: 0, height: 'auto' }}
              >
                办理住院
              </Button>
            </Popconfirm>
          );
        }
        return (
          <PatientMoreActions
            patient={record}
            canEdit={canEditPatient}
            canCreateGlucose={canCreateGlucose}
            onEdit={onEditPatient}
            onAddGlucose={onAddGlucose}
          />
        );
      },
    },
  ];
}

export default function PatientTable({
  items,
  total,
  loading,
  page,
  pageSize,
  onPageChange,
  canEditPatient,
  isDischarged,
  canAdmitPatient,
  admittingId,
  onEditPatient,
  onAdmitPatient,
  canCreateGlucose,
  onAddGlucose,
}: PatientTableProps) {
  const columns = useMemo(
    () =>
      buildColumns(
        canEditPatient,
        isDischarged,
        canAdmitPatient,
        admittingId,
        onEditPatient,
        onAdmitPatient,
        canCreateGlucose,
        onAddGlucose,
      ),
    [
      canEditPatient,
      isDischarged,
      canAdmitPatient,
      admittingId,
      onEditPatient,
      onAdmitPatient,
      canCreateGlucose,
      onAddGlucose,
    ],
  );

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
