import { ClockCircleOutlined } from '@ant-design/icons';
import { Card, Empty, Space, Spin, Typography } from 'antd';
import { useEffect, useRef } from 'react';
import { getTimeSlotLabel } from '@gc/shared';
import type { PatientListItem } from '@gc/shared';
import PatientMoreActions from './PatientMoreActions';
import { formatAge, formatGlucoseTime, formatHospitalDays, getGenderLabel } from './patient-format';

interface PatientCardGridProps {
  items: PatientListItem[];
  loading: boolean;
  hasMore: boolean;
  hasError?: boolean;
  onLoadMore: () => void;
}

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

function PatientCard({ patient }: { patient: PatientListItem }) {
  const glucoseValue =
    patient.lastGlucoseValue === null ? '-' : `${patient.lastGlucoseValue.toFixed(1)} mmol/L`;
  const glucoseContext = patient.lastGlucoseMealContext
    ? getTimeSlotLabel(patient.lastGlucoseMealContext)
    : '-';

  return (
    <Card size="small" style={{ height: '100%' }} styles={{ body: { height: '100%' } }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Text
            strong
            ellipsis={{ tooltip: patient.bedNo ?? '暂无床号' }}
            style={{ flex: 1, minWidth: 0, fontSize: 16 }}
          >
            {patient.bedNo || '暂无床号'}
          </Typography.Text>
          <PatientMoreActions label="更多" />
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

        <Typography.Text type="secondary">
          <ClockCircleOutlined style={{ marginRight: 6 }} />
          {formatGlucoseTime(patient.lastGlucoseMeasuredAt)}
        </Typography.Text>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Text strong style={{ marginRight: 'auto' }}>
            {glucoseValue}
          </Typography.Text>
          <Typography.Text>{glucoseContext}</Typography.Text>
        </div>
      </div>
    </Card>
  );
}

/** 卡片模式：滚动容器由页面 Card body 提供高度，这里只负责网格与触底加载 */
export default function PatientCardGrid({
  items,
  loading,
  hasMore,
  hasError = false,
  onLoadMore,
}: PatientCardGridProps) {
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
        <Empty description="暂无住院患者" style={{ paddingTop: 80 }} />
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
            <PatientCard key={patient.id} patient={patient} />
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
