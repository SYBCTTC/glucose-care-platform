import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Alert, Button, Table, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AdmissionOption } from '@gc/shared';
import { useOutletContext, useParams } from 'react-router-dom';
import type { DetailChildContext } from './detail-tabs';
import { useAdmissions } from './useAdmissions';

/**
 * 出入院记录（路由 `/inpatient/patients/:id/admission`，2026-11-26 替换占位页）。
 * 规格 docs/specs/patient-admission-records.md（需求人四项裁定）。
 *
 * 数据源复用 R24 住院记录树 `GET /patients/:id/admissions`（服务端已按 admittedAt
 * 倒序 NULLS LAST、不分页——与需求逐条吻合）；`statusVersion` 让详情页办理出院/住院
 * 成功后本表就地刷新（规格 §4）。每次挂载/刷新写一条 ADMISSION_QUERY 审计（既有口径）。
 */

/** 表格区最小高度：同血糖记录页（R21 口径），极矮视口下的防塌缩兜底 */
const TABLE_MIN_HEIGHT = 200;

/** 日期列：`开始 至 结束`；在院行 dischargedAt 为 null → 「至 -」（需求规则 3）。
 *  时间是服务端已格式化的本地字符串，前端不再转换；gc-num 等宽（ui-design-tokens 规则 7） */
export function AdmissionDateCell({
  admittedAt,
  dischargedAt,
}: {
  admittedAt: string | null;
  dischargedAt: string | null;
}) {
  return <span className="gc-num">{`${admittedAt ?? '-'} 至 ${dischargedAt ?? '-'}`}</span>;
}

/** 快照列空值统一「-」（裁定 1：存量旧行不回填）；住院号是编号串，同样走 gc-num */
export function renderAdmissionCell(value: string | null, numeric = false): ReactNode {
  if (value === null || value === '') {
    return '-';
  }
  return numeric ? <span className="gc-num">{value}</span> : value;
}

/** 列定义（需求规则 2 的六个表头，顺序一致）。导出供单测直接调用 render 断言 */
export const ADMISSION_COLUMNS: ColumnsType<AdmissionOption> = [
  {
    title: '日期',
    key: 'date',
    render: (_, row) => (
      <AdmissionDateCell admittedAt={row.admittedAt} dischargedAt={row.dischargedAt} />
    ),
  },
  // 科室 = 入院科室（裁定 4）；服务端平铺下发 departmentName，不从停留数组推导
  { title: '科室', dataIndex: 'departmentName', key: 'departmentName' },
  {
    title: '住院号',
    dataIndex: 'patientNo',
    key: 'patientNo',
    render: (value: string | null) => renderAdmissionCell(value, true),
  },
  {
    title: '责任医生',
    dataIndex: 'doctorName',
    key: 'doctorName',
    render: (value: string | null) => renderAdmissionCell(value),
  },
  {
    title: '责任护士',
    dataIndex: 'nurseName',
    key: 'nurseName',
    render: (value: string | null) => renderAdmissionCell(value),
  },
  // 操作人 = 当时办理住院的账号（需求规则 4；建档 seq=1 = 建档人，裁定 3）
  {
    title: '操作人',
    dataIndex: 'operatorName',
    key: 'operatorName',
    render: (value: string | null) => renderAdmissionCell(value),
  },
];

export default function AdmissionRecordTab() {
  const { id } = useParams<{ id: string }>();
  const { statusVersion } = useOutletContext<DetailChildContext>();
  const { token } = theme.useToken();
  // 加载失败的重试信号：与 statusVersion 合并作为 useAdmissions 的 version（都只增不减）
  const [retryCount, setRetryCount] = useState(0);
  const { data, loading, error } = useAdmissions(id, statusVersion + retryCount);

  // 根节点布局同血糖子页（R21 口径）：撑满内容区、表格 body 内滚
  const rootStyle: CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: token.marginXS,
    overflow: 'auto',
  };

  return (
    <div style={rootStyle}>
      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ flexShrink: 0 }}
          action={
            <Button size="small" danger onClick={() => setRetryCount((count) => count + 1)}>
              重试
            </Button>
          }
        />
      ) : null}

      <Table<AdmissionOption>
        rowKey="id"
        size="small"
        bordered
        columns={ADMISSION_COLUMNS}
        dataSource={data?.admissions ?? []}
        loading={loading}
        // 需求规则 5：不分页，全部展示（服务端本就整树下发）。
        // gc-report-table：撑满剩余高度、表头钉顶、body 内滚（R21 通用 flex 样式，
        // scroll.y='100%' 仅触发 antd 拆分固定表头，实际高度由 flex 决定）
        className="gc-report-table"
        style={{ minHeight: TABLE_MIN_HEIGHT }}
        pagination={false}
        scroll={{ y: '100%' }}
      />
    </div>
  );
}
