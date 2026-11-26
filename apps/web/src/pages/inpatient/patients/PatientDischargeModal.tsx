import { useEffect, useState } from 'react';
import { Alert, Form, Input, Modal, Spin, message } from 'antd';
import dayjs from 'dayjs';
import { DATE_ONLY_FORMAT, dischargePatientSchema } from '@gc/shared';
import type { PatientDetail, PatientDischargeResult } from '@gc/shared';
import { useAuthStore } from '@/store/auth';
import { dischargePatient, fetchPatientDetail } from '@/api/patient';
import PatientModalInfo from './PatientModalInfo';
import { getGenderLabel } from './patient-format';

interface PatientDischargeModalProps {
  /** null 表示未选中患者，弹框不打开 */
  patientId: string | null;
  /**
   * 详情页打开时复用已加载的详情（不重复请求、不重复写 PATIENT_VIEW 审计）；
   * 列表入口不传，由弹框内拉取详情（后端访问即留痕，合规）。
   */
  prefetchedDetail?: PatientDetail | null;
  open: boolean;
  onClose: () => void;
  /** 出院成功回调（成功提示已在弹框内给出），父页面只负责刷新 */
  onSuccess: (result: PatientDischargeResult) => void;
}

/**
 * 办理出院弹框（P2-6，docs/specs/patient-discharge.md §6）。
 *
 * 上半部分患者基本信息只读展示（每行 2 项、缺失「-」）；出院时间仅为预览，
 * 实际落库为服务端 now（裁定 Q1）。在虚拟病区时展示自动移出提示（裁定 2）。
 * 下半部分备注可空（裁定 1a），落 Admission.dischargeRemark。
 */
export default function PatientDischargeModal({
  patientId,
  prefetchedDetail,
  open,
  onClose,
  onSuccess,
}: PatientDischargeModalProps) {
  const profile = useAuthStore((state) => state.profile);
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remark, setRemark] = useState('');
  /** 出院时间预览：打开弹框时刻定格（落库值以服务端 now 为准） */
  const [dischargePreview, setDischargePreview] = useState('');

  /**
   * 详情页入口：prefetchedDetail 同步可用（内容立即可见，不等 effect）；
   * 列表入口：走 effect 拉取，结果存 detail。
   */
  const displayDetail =
    prefetchedDetail && prefetchedDetail.id === patientId ? prefetchedDetail : detail;

  useEffect(() => {
    if (!open || !patientId) {
      return;
    }
    setRemark('');
    setDischargePreview(dayjs().format(DATE_ONLY_FORMAT));

    if (prefetchedDetail && prefetchedDetail.id === patientId) {
      // 数据已同步可用，无需再发请求（也就不重复写 PATIENT_VIEW 审计）
      return;
    }

    // 取消标记：快速切换患者时避免旧响应覆盖新弹框（同 PatientEditModal 模式）
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    fetchPatientDetail(patientId)
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
        }
      })
      .catch(() => {
        // 错误提示由请求拦截器统一处理，这里只保证弹框不卡在 loading
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId, prefetchedDetail]);

  const handleSubmit = async () => {
    if (!displayDetail) {
      return;
    }
    // 与后端复用同一份 Zod 契约：备注 trim 后空串按未填处理
    const parsed = dischargePatientSchema.safeParse({ remark: remark.trim() || undefined });
    if (!parsed.success) {
      void message.error(parsed.error.issues[0]?.message ?? '参数错误');
      return;
    }

    setSubmitting(true);
    try {
      const result = await dischargePatient(displayDetail.id, parsed.data);
      void message.success('已办理出院');
      onSuccess(result);
      onClose();
    } catch {
      // 失败由拦截器统一提示（裁定 5）；弹框不关闭、保留已填备注（规格 §6）
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="办理出院"
      width={560}
      okText="办理出院"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || !displayDetail }}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      <Spin spinning={loading}>
        {displayDetail ? (
          <>
            <PatientModalInfo
              items={[
                { label: '姓名', value: displayDetail.nameMasked },
                { label: '性别', value: getGenderLabel(displayDetail.gender) },
                { label: '出生日期', value: displayDetail.birthDate, numeric: true },
                { label: '科室', value: displayDetail.departmentName },
                { label: '责任医生', value: displayDetail.doctorName },
                { label: '责任护士', value: displayDetail.nurseName },
                { label: '出院时间', value: dischargePreview, numeric: true },
                { label: '操作人', value: profile?.displayName },
              ]}
            />
            {displayDetail.inVirtualWard ? (
              <Alert
                type="warning"
                showIcon
                message="该患者将自动移出虚拟病区"
                style={{ marginTop: 16 }}
              />
            ) : null}
            <Form layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item label="备注">
                <Input.TextArea
                  rows={4}
                  maxLength={255}
                  value={remark}
                  onChange={(event) => setRemark(event.target.value)}
                  placeholder="选填，如出院交接注意事项"
                />
              </Form.Item>
            </Form>
          </>
        ) : (
          // 详情未就绪时占位，保证弹框高度稳定、Spin 可见
          <div style={{ minHeight: 160 }} />
        )}
      </Spin>
    </Modal>
  );
}
