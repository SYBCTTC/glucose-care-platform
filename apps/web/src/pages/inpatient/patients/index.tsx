import { useState } from 'react';
import { Alert, Button, Card, Result, message } from 'antd';
import { PATIENT_STATUS, PERMISSION } from '@gc/shared';
import type { PatientListItem, PatientStatus } from '@gc/shared';
import { admitPatient } from '@/api/patient';
import Tabs, { type TabItem } from '@/components/common/Tabs';
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
  const [admittingId, setAdmittingId] = useState<string | null>(null);

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
              canEditPatient={canEditPatient}
              onEditPatient={(patient) => setEditingPatientId(patient.id)}
              canCreateGlucose={canCreateGlucose}
              onAddGlucose={setGlucosePatient}
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
            canEditPatient={canEditPatient}
            isDischarged={!isInpatient}
            canAdmitPatient={canAdmitPatient}
            admittingId={admittingId}
            onEditPatient={(patient) => setEditingPatientId(patient.id)}
            onAdmitPatient={handleAdmit}
            canCreateGlucose={canCreateGlucose}
            onAddGlucose={setGlucosePatient}
          />
        )}
      </div>

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
