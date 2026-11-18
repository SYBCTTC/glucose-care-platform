import { ClockCircleOutlined } from '@ant-design/icons';
import { Card, Empty, Space, Spin, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PatientListItem } from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';
import LastGlucose from './LastGlucose';
import PatientMoreActions from './PatientMoreActions';
import {
  formatAge,
  formatGlucoseTime,
  formatHospitalDays,
  formatWardDays,
  getGenderLabel,
} from './patient-format';

/**
 * 患者卡片网格（滚动加载），患者管理页与虚拟病区页共用。
 *
 * 与 PatientTable 同一套思路：基本信息部分**必须是同一份代码**，差异只在
 * 右上角操作区与底部差异区，故把这两块抽成 `actions` / `footer` 插槽。
 * 虚拟病区卡片少一行（血糖两行 → 天数一行），整体会变矮，但网格默认
 * `align-items: stretch` + 卡片 `height: 100%`，同一行卡片仍然等高（决策 12a）。
 *
 * 卡片模式只在「当前虚拟病区」出现，历史 Tab 只有列表，故这里不需要 wardTab。
 */

interface CardBaseProps<T extends PatientListItem> {
  items: T[];
  loading: boolean;
  hasMore: boolean;
  hasError?: boolean;
  onLoadMore: () => void;
  /** C2：整卡可点进入患者详情（患者管理 / 虚拟病区两页共用） */
  onViewDetail: (patient: T) => void;
  emptyText?: string;
}

/** 患者管理模式：操作区是 PatientMoreActions，底部是血糖两项 */
interface PatientModeProps<T extends PatientListItem> {
  wardOf?: undefined;
  renderActions?: undefined;
  /** 是否有患者编辑权限（决定「更多」菜单里是否出现「编辑患者信息」） */
  canEditPatient: boolean;
  onEditPatient: (patient: T) => void;
  /** 是否有添加血糖权限（住院 Tab 且具备 GLUCOSE_CREATE 时才为 true） */
  canCreateGlucose: boolean;
  onAddGlucose: (patient: T) => void;
  /** 是否有虚拟病区操作权限（ward:manage）：无权限时菜单里不出现该项 */
  canJoinWard: boolean;
  onJoinWard: (patient: T) => void;
}

/** 虚拟病区模式：操作区由调用方给（单菜单），底部是加入天数 */
interface WardModeProps<T extends PatientListItem> {
  wardOf: (record: T) => { joinedAt: string; leftAt: string | null };
  renderActions: (record: T) => ReactNode;
  canEditPatient?: undefined;
  onEditPatient?: undefined;
  canCreateGlucose?: undefined;
  onAddGlucose?: undefined;
  canJoinWard?: undefined;
  onJoinWard?: undefined;
}

export type PatientCardGridProps<T extends PatientListItem = PatientListItem> = CardBaseProps<T> &
  (PatientModeProps<T> | WardModeProps<T>);

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
      <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
        {label}：
      </Typography.Text>
      <Typography.Text ellipsis={{ tooltip: value }} style={{ minWidth: 0 }}>
        {value}
      </Typography.Text>
    </div>
  );
}

/** 患者管理卡片底部：最近血糖时间 + 血糖值/时段 */
function GlucoseFooter({ patient }: { patient: PatientListItem }) {
  // 时段名取自动态时段（库里改名即时生效；停用项也能回显历史记录）
  const getTimeSlotName = useCommonDataStore((state) => state.getTimeSlotName);
  const glucoseContext = patient.lastGlucoseMealContext
    ? getTimeSlotName(patient.lastGlucoseMealContext)
    : '-';

  return (
    <>
      <Typography.Text type="secondary">
        <ClockCircleOutlined style={{ marginRight: 6 }} />
        {formatGlucoseTime(patient.lastGlucoseMeasuredAt)}
      </Typography.Text>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ marginRight: 'auto' }}>
          <LastGlucose
            resultType={patient.lastGlucoseResultType}
            value={patient.lastGlucoseValue}
          />
        </span>
        <Typography.Text>{glucoseContext}</Typography.Text>
      </div>
    </>
  );
}

/** 虚拟病区卡片底部：替换掉血糖区域的那一行（决策 5a） */
function WardFooter({ joinedAt, leftAt }: { joinedAt: string; leftAt: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Typography.Text type="secondary" style={{ marginRight: 'auto' }}>
        加入虚拟病区天数
      </Typography.Text>
      <Typography.Text strong>{formatWardDays(joinedAt, leftAt)}</Typography.Text>
    </div>
  );
}

interface PatientCardProps<T extends PatientListItem> {
  patient: T;
  /** 右上角操作区 */
  actions: ReactNode;
  /** 基本信息之后的差异区 */
  footer: ReactNode;
  /** C2：整卡点击进详情 */
  onViewDetail: (patient: T) => void;
}

function PatientCard<T extends PatientListItem>({
  patient,
  actions,
  footer,
  onViewDetail,
}: PatientCardProps<T>) {
  return (
    <Card
      size="small"
      hoverable
      onClick={() => onViewDetail(patient)}
      style={{ height: '100%', cursor: 'pointer' }}
      styles={{ body: { height: '100%' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Text
            strong
            ellipsis={{ tooltip: patient.bedNo ?? '暂无床号' }}
            style={{ flex: 1, minWidth: 0, fontSize: 16 }}
          >
            {patient.bedNo || '暂无床号'}
          </Typography.Text>
          {/* C2：操作区阻止冒泡，点"更多"不触发整卡进详情 */}
          <div onClick={(event) => event.stopPropagation()} style={{ flexShrink: 0 }}>
            {actions}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Space size={30} align="center" style={{ minWidth: 0 }}>
            <Typography.Text strong ellipsis style={{ maxWidth: 120 }}>
              {patient.nameMasked || '-'}
            </Typography.Text>
            <Typography.Text>{getGenderLabel(patient.gender)}</Typography.Text>
          </Space>
          <Typography.Text style={{ marginLeft: 'auto', flexShrink: 0 }}>
            {formatAge(patient.age)}
          </Typography.Text>
        </div>

        <InfoRow label="住院号" value={patient.patientNo || '-'} />
        <InfoRow
          label="住院天数"
          value={formatHospitalDays(patient.admissionAt, patient.dischargeAt)}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
            科室：{patient.departmentName || '-'}
          </Typography.Text>
          <Typography.Text ellipsis style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            责任医生：{patient.doctorName || '-'}
          </Typography.Text>
        </div>

        {footer}
      </div>
    </Card>
  );
}

/** 卡片模式：滚动容器由页面 Card body 提供高度，这里只负责网格与触底加载 */
export default function PatientCardGrid<T extends PatientListItem = PatientListItem>(
  props: PatientCardGridProps<T>,
) {
  const { items, loading, hasMore, hasError = false, onLoadMore, emptyText = '暂无住院患者' } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 查询条件变化后卡片会被清空，滚动位置一并回到顶部
  useEffect(() => {
    if (items.length === 0) {
      scrollRef.current?.scrollTo({ top: 0 });
    }
  }, [items.length]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target || !hasMore || loading) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore();
        }
      },
      { root, rootMargin: '120px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  return (
    <div
      ref={scrollRef}
      style={{
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        paddingRight: 4,
      }}
    >
      {items.length === 0 && loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <Empty description={emptyText} style={{ paddingTop: 80 }} />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            alignContent: 'start',
          }}
        >
          {items.map((patient) => (
            <PatientCard
              key={patient.id}
              patient={patient}
              onViewDetail={props.onViewDetail}
              actions={
                props.wardOf ? (
                  props.renderActions(patient)
                ) : (
                  <PatientMoreActions
                    patient={patient}
                    label="更多"
                    canEdit={props.canEditPatient}
                    canCreateGlucose={props.canCreateGlucose}
                    canJoinWard={props.canJoinWard}
                    onEdit={props.onEditPatient}
                    onAddGlucose={props.onAddGlucose}
                    onJoinWard={props.onJoinWard}
                  />
                )
              }
              footer={
                props.wardOf ? (
                  <WardFooter {...props.wardOf(patient)} />
                ) : (
                  <GlucoseFooter patient={patient} />
                )
              }
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {items.length > 0 && loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
          <Spin size="small" />
        </div>
      ) : null}
      {items.length > 0 && !loading && !hasMore && !hasError ? (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Typography.Text type="secondary">没有更多了</Typography.Text>
        </div>
      ) : null}
    </div>
  );
}
