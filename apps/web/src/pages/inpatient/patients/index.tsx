import { useState } from 'react';
import { Alert, Button, Card, Modal, Result, message } from 'antd';
import { PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type { PatientListItem, PatientStatus } from '@gc/shared';
import { useLocation, useNavigate } from 'react-router-dom';
import { admitPatient } from '@/api/patient';
import { joinWard } from '@/api/ward';
import Tabs, { type TabItem } from '@/components/common/Tabs';
import {
  DETAIL_DEFAULT_TAB,
  DETAIL_PATH_PREFIX,
} from '@/pages/inpatient/patient-detail/detail-tabs';
import { useAuthStore } from '@/store/auth';
import GlucoseCreateModal from './GlucoseCreateModal';
import PatientCardGrid from './PatientCardGrid';
import PatientCreateModal from './PatientCreateModal';
import PatientEditModal from './PatientEditModal';
import PatientFilter from './PatientFilter';
import PatientTable from './PatientTable';
import PatientToolbar from './PatientToolbar';
import { usePatientQuery, type PatientViewMode } from './usePatientQuery';

const VIEW_TABS: TabItem[] = [
  { key: 'CARD', label: '卡片' },
  { key: 'LIST', label: '列表' },
];

export default function PatientManagementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const canInpatient = hasPermission(PERMISSION.PATIENT_INPATIENT_VIEW);
  const canDischarged = hasPermission(PERMISSION.PATIENT_DISCHARGED_VIEW);
  const enabled = canInpatient || canDischarged;
  const initialStatus: PatientStatus = canInpatient
    ? PATIENT_STATUS.INPATIENT
    : PATIENT_STATUS.DISCHARGED;

  const query = usePatientQuery(initialStatus, enabled);
  const isInpatient = query.status === PATIENT_STATUS.INPATIENT;
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  /** 正在添加血糖的患者；null 表示弹窗关闭 */
  const [glucosePatient, setGlucosePatient] = useState<PatientListItem | null>(null);

  const canEditPatient = hasPermission(PERMISSION.PATIENT_UPDATE);
  const canAdmitPatient = hasPermission(PERMISSION.PATIENT_ADMIT);
  // 出院患者不录入血糖：仅住院 Tab 且具备 GLUCOSE_CREATE 时展示入口
  const canCreateGlucose = isInpatient && hasPermission(PERMISSION.GLUCOSE_CREATE);
  // 决策 4a：仅住院患者可加入虚拟病区，出院 Tab 本就不渲染更多操作菜单
  const canJoinWard = isInpatient && hasPermission(PERMISSION.WARD_MANAGE);
  const [admittingId, setAdmittingId] = useState<string | null>(null);
  /**
   * 确认框用 Modal.useModal() 而非静态 Modal.confirm：主题（暗色 + 字号档）由
   * App.tsx 的 ConfigProvider 下发，静态方法渲染在 React 树外拿不到上下文。
   * 不用 Popconfirm 是因为它需要持续存在的锚点，而 Dropdown 菜单项点击后菜单即关闭。
   */
  const [modal, contextHolder] = Modal.useModal();

  const handleAdmit = async (patient: PatientListItem) => {
    setAdmittingId(patient.id);
    try {
      await admitPatient(patient.id);
      void message.success('已办理住院');
      // 患者已转到住院 Tab，出院列表需重查
      query.refresh();
    } catch {
      // 失败提示由请求拦截器统一处理（含越权、状态冲突），这里只解除 loading
    } finally {
      setAdmittingId(null);
    }
  };

  const handleJoinWard = (patient: PatientListItem) => {
    modal.confirm({
      title: '加入虚拟病区',
      content: `确认将 ${patient.nameMasked} 加入虚拟病区？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await joinWard(patient.id);
          void message.success('已加入虚拟病区');
          // 局部更新该行（inVirtualWard 已翻转为 true，菜单项随即置灰），不整表重查
          query.patchItem(result.item);
        } catch {
          // 失败提示由请求拦截器统一处理（含 44001 已在区、越权 30002）
        }
      },
    });
  };

  // C1 方式B：进详情时带上来源路径，详情页返回据此 navigate(-1) 还原本页 Tab/筛选/视图/页码。
  //
  // **直接跳默认子页**而不是裸详情 URL：裸 URL 会命中详情页 index 路由的 <Navigate replace>，
  // 而 replace 覆盖 history 条目时一旦漏传 state，from 就没了 → 返回退化成兜底跳患者管理，
  // 本页的 Tab/筛选/页码快照全部失效。直达可让正常入口完全不经过 replace；
  // index 与 `*` 重定向只服务书签、手输 URL 等直接访问场景。
  const goDetail = (patient: PatientListItem) => {
    navigate(`${DETAIL_PATH_PREFIX}${patient.id}/${DETAIL_DEFAULT_TAB}`, {
      state: { from: location.pathname },
    });
  };

  if (!enabled) {
    return (
      <Card>
        <Result
          status="403"
          title="无患者查看权限"
          subTitle="请联系管理员分配住院或出院患者查看权限"
        />
      </Card>
    );
  }

  return (
    <Card
      style={
        query.isCardMode
          ? { height: 'calc(100vh - 88px)', minHeight: 480, overflow: 'hidden' }
          : undefined
      }
      styles={
        query.isCardMode
          ? {
              body: {
                height: '100%',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              },
            }
          : undefined
      }
    >
      <PatientToolbar
        value={query.status}
        onChange={query.changeStatus}
        onAddPatient={() => setCreateOpen(true)}
      />
      <PatientFilter
        status={query.status}
        filters={query.filters}
        departments={query.departmentOptions}
        doctors={query.doctorOptions}
        onDepartmentChange={query.setDepartment}
        onDoctorChange={query.setDoctor}
        onPatch={query.patch}
        onSearch={query.search}
        onReset={query.reset}
        loading={query.filterLoading}
      />

      {isInpatient ? (
        <div style={{ marginTop: 16 }}>
          <Tabs
            items={VIEW_TABS}
            value={query.viewMode}
            onChange={(key) => query.changeViewMode(key as PatientViewMode)}
            variant="background"
          />
        </div>
      ) : null}

      <div
        style={{
          marginTop: isInpatient ? 0 : 16,
          ...(query.isCardMode
            ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }
            : {}),
        }}
      >
        {query.activeError ? (
          <Alert
            type="error"
            showIcon
            message={query.activeError}
            style={{ marginBottom: 12, flexShrink: 0 }}
            action={
              query.isCardMode ? (
                <Button size="small" onClick={query.retryCards}>
                  重试
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {query.isCardMode ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <PatientCardGrid
              items={query.cardItems}
              loading={query.cardLoading}
              hasMore={query.cardHasMore}
              hasError={Boolean(query.cardError)}
              onLoadMore={query.loadMore}
              onViewDetail={goDetail}
              canEditPatient={canEditPatient}
              onEditPatient={(patient) => setEditingPatientId(patient.id)}
              canCreateGlucose={canCreateGlucose}
              onAddGlucose={setGlucosePatient}
              canJoinWard={canJoinWard}
              onJoinWard={handleJoinWard}
            />
          </div>
        ) : (
          <PatientTable
            items={query.result?.items ?? []}
            total={query.result?.total ?? 0}
            loading={query.loading}
            page={query.page}
            pageSize={query.pageSize}
            onPageChange={query.changePage}
            onViewDetail={goDetail}
            canEditPatient={canEditPatient}
            isDischarged={!isInpatient}
            canAdmitPatient={canAdmitPatient}
            admittingId={admittingId}
            onEditPatient={(patient) => setEditingPatientId(patient.id)}
            onAdmitPatient={handleAdmit}
            canCreateGlucose={canCreateGlucose}
            onAddGlucose={setGlucosePatient}
            canJoinWard={canJoinWard}
            onJoinWard={handleJoinWard}
          />
        )}
      </div>

      {/* Modal.useModal 的上下文占位，必须渲染才能拿到 ConfigProvider 的主题 */}
      {contextHolder}

      <PatientCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={query.refresh}
      />

      <PatientEditModal
        patientId={editingPatientId}
        open={editingPatientId !== null}
        onClose={() => setEditingPatientId(null)}
        onUpdated={query.patchItem}
      />

      <GlucoseCreateModal
        patient={glucosePatient}
        open={glucosePatient !== null}
        onClose={() => setGlucosePatient(null)}
        onSuccess={(result) => query.patchItem(result.item)}
      />
    </Card>
  );
}
