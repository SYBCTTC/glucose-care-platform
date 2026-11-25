import { useState } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Row, Spin, theme } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { PatientDetail } from '@gc/shared';
import { useAuthStore } from '@/store/auth';
import PatientGlucoseTargetEditModal from './PatientGlucoseTargetEditModal';
import {
  NOT_SET_TEXT,
  TARGET_UNIT,
  canEditGlucoseTarget,
  formatTargetRange,
  formatThreshold,
} from './glucose-target-view';
import { usePatientGlucoseTargets } from './usePatientGlucoseTargets';

/** 详情页壳通过 Outlet context 下发的患者详情（用于判断住院状态 → 编辑入口门控） */
interface DetailOutletContext {
  patientDetail: PatientDetail | null;
}

/** 展示区一行三个（规格 §6.2） */
const COL_SPAN = 8;

/**
 * 单个目标区间的展示值。
 *
 * 有值 → `gc-num`（等宽数字，避免数值跳动）；缺行 → 弱化的「未设置」（裁定 K：
 * 不显示 0、不显示空白，否则医护无法区分「目标就是 0」和「还没配」）。
 * 导出供单测用 `renderToStaticMarkup` 断言（web 测试跑 node 环境，无 jsdom）。
 */
export function TargetRangeValue({
  valueDown,
  valueUp,
}: {
  valueDown: number | null;
  valueUp: number | null;
}) {
  const { token } = theme.useToken();
  if (valueDown === null || valueUp === null) {
    return <span style={{ color: token.colorTextTertiary }}>{NOT_SET_TEXT}</span>;
  }
  return <span className="gc-num">{formatTargetRange(valueDown, valueUp)}</span>;
}

/** 单个预警值的展示值。口径同 `TargetRangeValue`（null = 该行不存在 → 「未设置」） */
export function ThresholdValue({ value }: { value: number | null }) {
  const { token } = theme.useToken();
  if (value === null) {
    return <span style={{ color: token.colorTextTertiary }}>{NOT_SET_TEXT}</span>;
  }
  return <span className="gc-num">{formatThreshold(value)}</span>;
}

/** 展示项的统一排版：`label：value`，label 用次要色（同顶部基本信息区 `PatientBasicInfo`） */
function TargetItem({ label, children }: { label: string; children: React.ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Col span={COL_SPAN}>
      <div style={{ marginBottom: token.marginSM }}>
        <span style={{ color: token.colorTextSecondary }}>{label}：</span>
        {children}
      </div>
    </Col>
  );
}

/**
 * 患者详情页「控糖目标」Tab（规格 §6，裁定 M / W）。
 *
 * 2026-11-25 由原「基本信息」空占位替换为正式页面（裁定 M）。
 *
 * ⚠️ **本 Tab 只提供查看与配置，不改任何判定逻辑**：血糖的「偏低 / 正常 / 偏高」
 * （`resultType`）目前仍按**全局**阈值判定，患者级目标要等任务 ④（R4）才生效。
 * 交付时必须向医护说明这一点，否则会被当成「改了不生效」的 bug（规格 §12 ③）。
 *
 * 数据流：`usePatientGlucoseTargets` 手写 hook（不引入 TanStack Query，与全仓一致），
 * 带 StrictMode 守卫——后端每次 GET 写一条 `PATIENT_TARGET_VIEW` 审计，
 * 开发模式下 effect 跑两次会造成审计成对重复。
 *
 * 编辑入口门控（R11 / 裁定 W）：**住院中** + 有 `patient:target:update` 权限，
 * 与详情页壳的「添加血糖」按钮完全同口径。出院 / 归档患者只能看不能改。
 */
export default function PatientGlucoseTargetTab() {
  const { id } = useParams<{ id: string }>();
  const { patientDetail } = useOutletContext<DetailOutletContext>();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const { token } = theme.useToken();
  const { data, loading, error, forbidden, reload } = usePatientGlucoseTargets(id);
  const [editOpen, setEditOpen] = useState(false);

  const canEdit = canEditGlucoseTarget(patientDetail?.status, hasPermission);

  return (
    <div className="gc-page">
      {/* 错误态优先：403 越权与网络错误文案不同，避免把「无权查看」误读成「没有数据」 */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={forbidden ? '无权查看该患者的控糖目标（数据范围限制）' : error}
          action={
            <Button size="small" danger onClick={reload}>
              重试
            </Button>
          }
        />
      )}

      {!error && (
        <Card
          title="控糖目标"
          extra={
            canEdit ? (
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditOpen(true);
                }}
              >
                编辑
              </Button>
            ) : null
          }
        >
          <Spin spinning={loading}>
            {data && data.targets.length > 0 ? (
              <Row gutter={[token.marginLG, 0]}>
                {data.targets.map((item) => (
                  // 时段名取接口下发的 timeSlotName，禁止硬编码（AGENTS.md §4.4）
                  <TargetItem label={item.timeSlotName} key={item.timeSlotCode}>
                    <TargetRangeValue valueDown={item.valueDown} valueUp={item.valueUp} />
                  </TargetItem>
                ))}
                {/* 预警值紧跟时段目标之后（规格 §6.2「末尾两项」）。
                    与时段目标是两套独立机制（裁定 O）：影响趋势图阈值线，不影响 resultType 分类 */}
                <TargetItem label="低血糖预警">
                  <ThresholdValue value={data.alert.lowThreshold} />
                </TargetItem>
                <TargetItem label="高血糖预警">
                  <ThresholdValue value={data.alert.highThreshold} />
                </TargetItem>
              </Row>
            ) : (
              !loading && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={`暂无可配置的时段（需在「系统管理 → 时段管理」启用带阈值的普通时段）`}
                />
              )
            )}
          </Spin>
        </Card>
      )}

      <PatientGlucoseTargetEditModal
        open={editOpen}
        patientId={id}
        data={data}
        patientName={patientDetail?.nameMasked ?? ''}
        onClose={() => {
          setEditOpen(false);
        }}
        // 保存成功、或提交遇到非字段级错误（并发 / 患者已出院 / 越权）→ 重新 GET，
        // 让展示区反映库中最新值（单位与默认值也可能已被系统管理员改过）
        onChanged={reload}
      />
    </div>
  );
}

/** 单位常量再导出，便于单测直接从组件文件取用（与展示文案同源，避免测试里另写字面量） */
export { TARGET_UNIT };
