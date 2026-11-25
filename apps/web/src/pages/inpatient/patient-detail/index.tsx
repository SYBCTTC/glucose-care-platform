import { useCallback, useState } from 'react';
import { Button, Card, Result, Spin, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { PATIENT_STATUS, PERMISSION } from '@gc/shared';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { layoutSize } from '@/styles/tokens';
import GlucoseCreateModal from '../patients/GlucoseCreateModal';
import PatientBasicInfo from './PatientBasicInfo';
import PatientDetailTabs from './PatientDetailTabs';
import { usePatientDetail } from './usePatientDetail';

/**
 * 患者详情页（路由 /inpatient/patients/:id，守卫 PATIENT_VIEW，渲染在 BasicLayout 内）。
 * 布局：返回栏 / 患者基本信息区（始终可见摘要）/ Tabs 区（占满剩余空间，本期占位）。
 * 数据：GET /patients/:id（后端每次访问写 PATIENT_VIEW 审计，决策 A3）。
 */
export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const { data, loading, error, forbidden } = usePatientDetail(id);
  const [glucoseOpen, setGlucoseOpen] = useState(false);
  // 录入成功后自增，经 Outlet context 通知血糖报告子路由重新拉取（弹窗在壳上、报表数据在子路由里）
  const [glucoseVersion, setGlucoseVersion] = useState(0);

  // C1 方式B：从入口点进来时 location.state.from 有值 → navigate(-1) 回来源页并还原其 Tab/筛选/视图/页码；
  // 直接访问详情 URL / 新标签打开（无 from，无可靠历史）→ 兜底回患者管理（决策 C1）。
  const from = (location.state as { from?: unknown } | null)?.from;
  const handleBack = (): void => {
    if (typeof from === 'string' && from) {
      navigate(-1);
    } else {
      navigate('/inpatient/patients', { replace: true });
    }
  };

  // 决策 D5：仅住院患者 + GLUCOSE_CREATE 权限展示"添加血糖"
  const canAddGlucose =
    data?.status === PATIENT_STATUS.INPATIENT && hasPermission(PERMISSION.GLUCOSE_CREATE);

  // R25：血糖变更（壳上添加 / 子路由内添加·编辑·作废）统一走这一个回调 → 版本号 +1 → 报表重拉。
  // 患者摘要区不含血糖字段，故本页其余部分无需刷新；成功提示由各弹框内部给出（决策 D5 口径不变）。
  const handleGlucoseChanged = useCallback(() => {
    setGlucoseVersion((version) => version + 1);
  }, []);

  return (
    <Card
      style={{ height: 'calc(100vh - 88px)', minHeight: 480, overflow: 'hidden' }}
      styles={{
        body: {
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      <div className="gc-no-print" style={{ marginBottom: layoutSize.cardGap, flexShrink: 0 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>
          返回
        </Button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin />
        </div>
      ) : !data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Result
            status={forbidden ? '403' : 'error'}
            title={forbidden ? '无权查看该患者' : '无法加载患者详情'}
            subTitle={error ?? '患者不存在或已被删除'}
            extra={
              <Button type="primary" onClick={handleBack}>
                返回
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* 患者基本信息区（始终可见摘要，区别于"基本信息"Tab，决策 D4） */}
          <div
            style={{
              flexShrink: 0,
              paddingBottom: layoutSize.cardGap,
              marginBottom: layoutSize.cardGap,
              borderBottom: `${token.lineWidth}px solid ${token.colorBorderSecondary}`,
            }}
          >
            <PatientBasicInfo
              detail={data}
              canAddGlucose={canAddGlucose}
              onAddGlucose={() => setGlucoseOpen(true)}
            />
          </div>
          {/* Tabs 区占满剩余空间；子路由内容经其内部的 <Outlet/> 渲染 */}
          <PatientDetailTabs
            outletContext={{
              glucoseVersion,
              onGlucoseChanged: handleGlucoseChanged,
              // R25：子路由内血糖弹框所需的患者摘要（此分支 data 恒非空）
              patient: { id: data.id, nameMasked: data.nameMasked, status: data.status },
              // R28：完整详情透传给打印头（此分支 data 恒非空；不为打印多发请求）
              patientDetail: data,
            }}
          />
        </>
      )}

      <GlucoseCreateModal
        patient={data}
        open={glucoseOpen && data !== null}
        onClose={() => setGlucoseOpen(false)}
        onSuccess={handleGlucoseChanged}
      />
    </Card>
  );
}
