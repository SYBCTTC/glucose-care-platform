import { Table } from 'antd';
import type { TableColumnsType } from 'antd';
import type { GlucoseAlertItem } from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';
import { formatTargetRange } from '../patient-detail/glucose-target-view';
import { getGenderLabel } from '../patients/patient-format';
import type { AlertTab } from './alert-stats';

/** 检测时间展示到分钟（规格 §6）：服务端契约为 'YYYY-MM-DD HH:mm:ss' 定长串，截取即可 */
function formatMeasuredAt(value: string): string {
  return value.slice(0, 16);
}

interface AlertTableProps {
  items: GlucoseAlertItem[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  tab: AlertTab;
  onPageChange: (page: number, pageSize: number) => void;
}

/**
 * 预警列表（P4-7 规格 §6）：12 列；高/低 Tab 隐藏「预警类型」列（11 列）。
 * 预警类型与血糖值用 Low/High 语义色（global.css 工具类，明暗模式自适应）；
 * 类型列自带文字、值列数值+单位，满足「色＋文」双通道（ui-design-tokens §7）。
 * 血糖值只给数值染色、单位保持正文色（同 LastGlucose 的 D4 口径）。
 */
export default function AlertTable({
  items,
  total,
  loading,
  page,
  pageSize,
  tab,
  onPageChange,
}: AlertTableProps) {
  const getTimeSlotName = useCommonDataStore((state) => state.getTimeSlotName);

  const columns: TableColumnsType<GlucoseAlertItem> = [
    {
      title: '科室',
      dataIndex: 'departmentName',
      width: 120,
      render: (value: string | null) => value ?? '-',
    },
    {
      title: '床号',
      dataIndex: 'bedNo',
      width: 90,
      render: (value: string | null) => value ?? '-',
    },
    // 姓名恒为脱敏文（nameMasked），本页无解掩入口（规格 §5）
    { title: '姓名', dataIndex: 'name', width: 110 },
    {
      title: '性别',
      dataIndex: 'gender',
      width: 70,
      render: (value: string | null) => getGenderLabel(value),
    },
    {
      title: '住院号',
      dataIndex: 'patientNo',
      width: 140,
      render: (value: string | null) => value ?? '-',
    },
    ...(tab === 'all'
      ? ([
          {
            title: '预警类型',
            dataIndex: 'alertType',
            width: 120,
            render: (value: GlucoseAlertItem['alertType']) => (
              <span className={value === 'high' ? 'gc-text-glucose-high' : 'gc-text-glucose-low'}>
                {value === 'high' ? '高血糖预警' : '低血糖预警'}
              </span>
            ),
          },
        ] satisfies TableColumnsType<GlucoseAlertItem>)
      : []),
    {
      title: '血糖值',
      dataIndex: 'valueMmolL',
      width: 130,
      render: (value: number, record) => (
        <span>
          <span
            className={record.alertType === 'high' ? 'gc-text-glucose-high' : 'gc-text-glucose-low'}
          >
            {value.toFixed(1)}
          </span>{' '}
          mmol/L
        </span>
      ),
    },
    {
      title: '检测时间',
      dataIndex: 'measuredAt',
      width: 160,
      render: (value: string) => formatMeasuredAt(value),
    },
    {
      title: '检测时段',
      dataIndex: 'mealContext',
      width: 100,
      // 时段码 → 名称走字典 store（含停用时段，历史回显；禁止前端硬编码时段名）
      render: (value: string | null) => (value ? getTimeSlotName(value) : '-'),
    },
    {
      title: '控糖范围',
      dataIndex: 'targetRange',
      width: 140,
      // 解析失败（全局配置缺失）显示 '-'（规格 §3）；格式同控糖目标 Tab「4.4-7.0 mmol/L」
      render: (value: GlucoseAlertItem['targetRange']) =>
        value ? formatTargetRange(value.low, value.high) : '-',
    },
    {
      title: '责任医生',
      dataIndex: 'doctorName',
      width: 110,
      render: (value: string | null) => value ?? '-',
    },
    {
      title: '责任护士',
      dataIndex: 'nurseName',
      width: 110,
      render: (value: string | null) => value ?? '-',
    },
  ];

  return (
    <Table<GlucoseAlertItem>
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={items}
      loading={loading}
      scroll={{ x: 1400 }}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: onPageChange,
        showSizeChanger: true,
        showQuickJumper: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (count) => `共 ${count} 条`,
      }}
    />
  );
}
