import { useMemo } from 'react';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import { WARD_TAB } from '@gc/shared';
import type { PatientListItem, WardTab } from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';
import LastGlucose from './LastGlucose';
import PatientMoreActions from './PatientMoreActions';
import { formatAge, formatHospitalDays, formatWardDays, getGenderLabel } from './patient-format';

/**
 * 患者列表表格，患者管理页与虚拟病区页共用。
 *
 * 两页的基本信息列**必须是同一份代码**（需求人 2026-11-17 裁定：虚拟病区的患者展示
 * 与患者管理一样），差异只有两处：中段列（血糖三项 ↔ 加入天数）与操作列。
 * 因此用可辨识联合把两种模式的 props 分开，`wardTab` 是判别字段：
 * 传了就是虚拟病区模式，此时患者管理那组 props 一律不接受，反之亦然。
 * 这样任何一边漏传 props 都是编译错误，而不是运行时 undefined。
 */

/** 两种模式共用的分页与加载 props */
interface TableBaseProps<T extends PatientListItem> {
  items: T[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  /** C3：点击姓名列进入患者详情（患者管理 / 虚拟病区两页共用） */
  onViewDetail: (patient: T) => void;
  /** 横向滚动宽度；默认 1400 是患者管理的列宽合计，虚拟病区列数不同需另传 */
  scrollX?: number;
  emptyText?: string;
}

/** 患者管理模式：操作列由本组件渲染（编辑 / 血糖 / 办理住院 / 更多操作） */
interface PatientModeProps<T extends PatientListItem> {
  wardTab?: undefined;
  wardOf?: undefined;
  renderActions?: undefined;
  /** 是否存在患者编辑权限（无权限时菜单里不出现「编辑患者信息」） */
  canEditPatient: boolean;
  /** 是否出院 Tab：出院患者的操作列只有一个「办理住院」按钮 */
  isDischarged: boolean;
  /** 是否有办理住院权限（无权限时操作列为空，后端仍强制校验） */
  canAdmitPatient: boolean;
  onEditPatient: (patient: T) => void;
  /** P2-6：点击打开办理住院弹框（原 Popconfirm 直接执行已废弃，提交 loading 在弹框内） */
  onAdmitPatient: (patient: T) => void;
  /** 是否有添加血糖权限（住院 Tab 且具备 GLUCOSE_CREATE 时才为 true） */
  canCreateGlucose: boolean;
  onAddGlucose: (patient: T) => void;
  /** 是否有虚拟病区操作权限（ward:manage）：无权限时菜单里不出现该项 */
  canJoinWard: boolean;
  onJoinWard: (patient: T) => void;
  /** 是否可办理出院（P2-6：住院 Tab 且持 patient:discharge）：无权限时菜单里不出现该项 */
  canDischargePatient: boolean;
  /** 点击打开办理出院弹框 */
  onDischargePatient: (patient: T) => void;
}

/** 虚拟病区模式：中段列换成加入天数，操作列由调用方渲染（单菜单） */
interface WardModeProps<T extends PatientListItem> {
  wardTab: WardTab;
  /**
   * 从行里取本次进出的时间。天数在前端算而不是后端下发：
   * 跨零点后无需重新请求即自动 +1，也避免服务端与前端两套口径。
   */
  wardOf: (record: T) => { joinedAt: string; leftAt: string | null };
  renderActions: (record: T) => ReactNode;
  canEditPatient?: undefined;
  isDischarged?: undefined;
  canAdmitPatient?: undefined;
  onEditPatient?: undefined;
  onAdmitPatient?: undefined;
  canCreateGlucose?: undefined;
  onAddGlucose?: undefined;
  canJoinWard?: undefined;
  onJoinWard?: undefined;
  canDischargePatient?: undefined;
  onDischargePatient?: undefined;
}

export type PatientTableProps<T extends PatientListItem = PatientListItem> = TableBaseProps<T> &
  (PatientModeProps<T> | WardModeProps<T>);

/** 基本信息列：床号 → 住院天数，两页完全一致 */
function buildBasicColumns<T extends PatientListItem>(
  onViewDetail: (patient: T) => void,
): ColumnsType<T> {
  return [
    {
      title: '床号',
      dataIndex: 'bedNo',
      width: 90,
      render: (value: string | null) => value ?? '-',
    },
    {
      title: '姓名',
      dataIndex: 'nameMasked',
      width: 110,
      // C3：列表仅姓名可点进详情（整行不可点，避免与操作列、文本选中冲突）
      render: (value: string, record) => (
        <Button
          type="link"
          size="small"
          style={{ paddingInline: 0, height: 'auto' }}
          onClick={() => onViewDetail(record)}
        >
          {value}
        </Button>
      ),
    },
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
  ];
}

/** 患者管理的中段列：最近血糖 / 测量时段 / 测量时间 */
function buildGlucoseColumns<T extends PatientListItem>(
  /** 时段码 → 名称（动态时段，停用项也能回显） */
  getTimeSlotName: (code: string) => string,
): ColumnsType<T> {
  return [
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
      render: (value: string | null) => (value ? getTimeSlotName(value) : '-'),
    },
    {
      title: '测量时间',
      dataIndex: 'lastGlucoseMeasuredAt',
      width: 170,
      render: (value: string | null) => value ?? '-',
    },
  ];
}

/** 虚拟病区的中段列：加入天数（历史 Tab 另加加入/移出时间两列） */
function buildWardColumns<T extends PatientListItem>(
  wardTab: WardTab,
  wardOf: (record: T) => { joinedAt: string; leftAt: string | null },
): ColumnsType<T> {
  const columns: ColumnsType<T> = [
    {
      title: '加入虚拟病区天数',
      key: 'wardDays',
      width: 150,
      render: (_, record) => {
        const { joinedAt, leftAt } = wardOf(record);
        return formatWardDays(joinedAt, leftAt);
      },
    },
  ];
  // 历史行有两个时间点：只给移出时间看不出这次进出跨越了多久，天数列只隐含结果，故两列都显示
  if (wardTab === WARD_TAB.HISTORY) {
    columns.push(
      {
        title: '加入时间',
        key: 'wardJoinedAt',
        width: 170,
        render: (_, record) => wardOf(record).joinedAt || '-',
      },
      {
        title: '移出时间',
        key: 'wardLeftAt',
        width: 170,
        render: (_, record) => wardOf(record).leftAt ?? '-',
      },
    );
  }
  return columns;
}

/** 患者管理的操作列：出院 Tab 只有「办理住院」，住院 Tab 是更多操作菜单 */
function buildPatientActionColumn<T extends PatientListItem>(
  props: TableBaseProps<T> & PatientModeProps<T>,
): ColumnsType<T>[number] {
  const {
    isDischarged,
    canAdmitPatient,
    onAdmitPatient,
    canEditPatient,
    canCreateGlucose,
    onEditPatient,
    onAddGlucose,
    canJoinWard,
    onJoinWard,
    canDischargePatient,
    onDischargePatient,
  } = props;
  return {
    title: '操作',
    key: 'actions',
    width: 120,
    fixed: 'right',
    render: (_, record) => {
      // 出院 Tab：只有一个「办理住院」按钮（P2-6：点击打开办理住院弹框，
      // 原 Popconfirm 直接执行已废弃——admit 契约升级后需要填表单，
      // 提交 loading/防连点在弹框内，按钮本身不再需要 loading）
      if (isDischarged) {
        if (!canAdmitPatient) {
          return null;
        }
        return (
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0, height: 'auto' }}
            onClick={() => onAdmitPatient(record)}
          >
            办理住院
          </Button>
        );
      }
      return (
        <PatientMoreActions
          patient={record}
          canEdit={canEditPatient}
          canCreateGlucose={canCreateGlucose}
          canJoinWard={canJoinWard}
          canDischarge={canDischargePatient}
          onEdit={onEditPatient}
          onAddGlucose={onAddGlucose}
          onJoinWard={onJoinWard}
          onDischarge={onDischargePatient}
        />
      );
    },
  };
}

/** 虚拟病区的操作列：内容由调用方给（WardMoreActions 单菜单） */
function buildWardActionColumn<T extends PatientListItem>(
  renderActions: (record: T) => ReactNode,
): ColumnsType<T>[number] {
  return {
    title: '操作',
    key: 'actions',
    width: 120,
    fixed: 'right',
    render: (_, record) => renderActions(record),
  };
}

export default function PatientTable<T extends PatientListItem = PatientListItem>(
  props: PatientTableProps<T>,
) {
  const getTimeSlotName = useCommonDataStore((state) => state.getTimeSlotName);
  const {
    items,
    total,
    loading,
    page,
    pageSize,
    onPageChange,
    scrollX = 1400,
    emptyText = '暂无患者数据',
  } = props;

  // 依赖整个 props：调用方传的多是内联箭头函数，逐个列出来也拿不到稳定引用，
  // 反而容易漏依赖导致列不刷新。表格最多 100 行，重建列数组的开销可忽略。
  const columns = useMemo<ColumnsType<T>>(() => {
    const middle = props.wardTab
      ? buildWardColumns(props.wardTab, props.wardOf)
      : buildGlucoseColumns<T>(getTimeSlotName);
    const action = props.wardTab
      ? buildWardActionColumn(props.renderActions)
      : buildPatientActionColumn(props);
    return [...buildBasicColumns<T>(props.onViewDetail), ...middle, action];
  }, [props, getTimeSlotName]);

  return (
    <Table<T>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      size="middle"
      scroll={{ x: scrollX }}
      locale={{ emptyText }}
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
