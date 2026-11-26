import { useCallback, useState } from 'react';
import { Button, Card, Result, Spin, theme } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { PATIENT_STATUS, PERMISSION } from '@gc/shared';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { layoutSize } from '@/styles/tokens';
import GlucoseCreateModal from '../patients/GlucoseCreateModal';
import PatientAdmitModal from '../patients/PatientAdmitModal';
import PatientDischargeModal from '../patients/PatientDischargeModal';
import PatientEditModal from '../patients/PatientEditModal';
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
  // P2-6：办理出院/住院成功后自增 → 同 id 强制重拉详情（停留原地刷新状态，裁定 4）
  const [detailVersion, setDetailVersion] = useState(0);
  const { data, loading, error, forbidden } = usePatientDetail(id, detailVersion);
  const [glucoseOpen, setGlucoseOpen] = useState(false);
  // 录入成功后自增，经 Outlet context 通知血糖报告子路由重新拉取（弹窗在壳上、报表数据在子路由里）
  const [glucoseVersion, setGlucoseVersion] = useState(0);
  // 出入院记录 Tab 的重拉信号：仅办理出院/住院成功后自增。编辑患者信息不触发——
  // update() 只写 Patient 表，住院记录数据未变，不发假变更信号
  const [statusVersion, setStatusVersion] = useState(0);
  /** P2-6：办理出院/住院弹框（详情页「更多操作」入口） */
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  /** 2026-11-26：编辑患者信息弹框（「更多操作」首项，复用列表页弹框，裁定 Q1） */
  const [editOpen, setEditOpen] = useState(false);

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

  // P2-6「更多操作」下拉（裁定 Q3/6）：住院患者 → 办理出院；出院患者 → 办理住院。
  // 无对应权限仅隐藏该菜单项；全部不可用时 PatientBasicInfo 不渲染整个下拉。
  const canDischarge =
    data?.status === PATIENT_STATUS.INPATIENT && hasPermission(PERMISSION.PATIENT_DISCHARGE);
  const canAdmit =
    data?.status === PATIENT_STATUS.DISCHARGED && hasPermission(PERMISSION.PATIENT_ADMIT);
  // 2026-11-26「编辑患者信息」：仅住院患者（规则 3：出院患者详情无此功能，服务端 40004
  // 独立兜底）+ patient:update（复用列表页权限点，规则 2）；无权限仅隐藏该项
  const canEdit =
    data?.status === PATIENT_STATUS.INPATIENT && hasPermission(PERMISSION.PATIENT_UPDATE);

  // R25：血糖变更（壳上添加 / 子路由内添加·编辑·作废）统一走这一个回调 → 版本号 +1 → 报表重拉。
  // 患者摘要区不含血糖字段，故本页其余部分无需刷新；成功提示由各弹框内部给出（决策 D5 口径不变）。
  const handleGlucoseChanged = useCallback(() => {
    setGlucoseVersion((version) => version + 1);
  }, []);

  // P2-6：状态流转成功 → 重拉详情（摘要区状态/按钮随之切换）；同时 bump glucoseVersion：
  // 住院记录（admissions）随出院关闭/随住院新开，报表子路由的「本次住院」上下文必须重拉；
  // statusVersion 独立自增 → 出入院记录 Tab 就地刷新
  const handleStatusChanged = useCallback(() => {
    setDetailVersion((version) => version + 1);
    setGlucoseVersion((version) => version + 1);
    setStatusVersion((version) => version + 1);
  }, []);

  // 2026-11-26：编辑成功 → 仅重拉详情（摘要区科室/医护/糖尿病类型等随之刷新）。
  // 不 bump glucoseVersion/statusVersion：编辑只写 Patient 表，血糖与住院记录数据未变，
  // 不发假变更信号（重拉详情期间壳层进 loading、子树重挂载，各子 Tab 会随之重拉一次——
  // 与办理出院/住院刷新同款的壳层既有行为，非本次引入）。
  // onUpdated 回传的列表项本页用不上（详情比重查列表更全）
  const handleEdited = useCallback(() => {
    setDetailVersion((version) => version + 1);
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
              canEdit={canEdit}
              onEdit={() => setEditOpen(true)}
              canDischarge={canDischarge}
              canAdmit={canAdmit}
              onDischarge={() => setDischargeOpen(true)}
              onAdmit={() => setAdmitOpen(true)}
            />
          </div>
          {/* Tabs 区占满剩余空间；子路由内容经其内部的 <Outlet/> 渲染 */}
          <PatientDetailTabs
            outletContext={{
              glucoseVersion,
              // 出入院记录 Tab 的刷新信号：仅办理出院/住院成功后自增（编辑患者信息不触发）
              statusVersion,
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

      {/* P2-6：详情页办理出院/住院弹框。复用已加载的详情（prefetchedDetail），
          不重复请求、不重复写 PATIENT_VIEW 审计；成功后停留原地刷新状态（裁定 4） */}
      <PatientDischargeModal
        patientId={data?.id ?? null}
        prefetchedDetail={data}
        open={dischargeOpen && data !== null}
        onClose={() => setDischargeOpen(false)}
        onSuccess={handleStatusChanged}
      />
      <PatientAdmitModal
        patientId={data?.id ?? null}
        prefetchedDetail={data}
        open={admitOpen && data !== null}
        onClose={() => setAdmitOpen(false)}
        onSuccess={handleStatusChanged}
      />

      {/* 2026-11-26：编辑患者信息弹框——复用列表页同一组件/接口/权限点（需求规则 2）。
          裁定 Q1：传 prefetchedDetail，不重复请求、不重复写 PATIENT_VIEW 审计；
          保存成功后停留原地重拉详情（handleEdited） */}
      <PatientEditModal
        patientId={data?.id ?? null}
        prefetchedDetail={data}
        open={editOpen && data !== null}
        onClose={() => setEditOpen(false)}
        onUpdated={handleEdited}
      />
    </Card>
  );
}
