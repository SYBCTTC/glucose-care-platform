import { useCallback, useEffect, useState } from 'react';
import { Form, Modal, Spin, message } from 'antd';
import dayjs from 'dayjs';
import { DATE_ONLY_FORMAT, updatePatientSchema } from '@gc/shared';
import type { Gender, PatientDetail, PatientListItem } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchPatientDetail, updatePatient, type UpdatePatientPayload } from '@/api/patient';
import PatientFormFields, {
  type PatientFormValues,
  type SensitiveField,
} from './PatientFormFields';

interface PatientEditModalProps {
  /** null 表示未选中患者，弹框不打开 */
  patientId: string | null;
  open: boolean;
  onClose: () => void;
  /** 保存成功回调：回传后端返回的最新列表项，供页面局部更新（不整页重查） */
  onUpdated: (item: PatientListItem) => void;
}

/**
 * 表单值 → PATCH 请求体。
 *
 * 敏感字段（姓名 / 身份证 / 手机号）密文不可逆、无法回填明文，所以：
 *  - 留空  → 不放进请求体，后端保留原值
 *  - 清除  → 显式传 null
 * 其余字段整表单覆盖提交，null 表示清空。
 */
function toUpdatePayload(
  values: PatientFormValues,
  clearedFields: SensitiveField[],
): UpdatePatientPayload {
  const payload: UpdatePatientPayload = {
    gender: values.gender,
    birthDate: values.birthDate.format(DATE_ONLY_FORMAT),
    departmentId: values.departmentId,
    bedNo: values.bedNo?.trim() || null,
    doctorId: values.doctorId ?? null,
    nurseId: values.nurseId ?? null,
    diabetesType: values.diabetesType ?? null,
    hba1c: values.hba1c ?? null,
  };

  const name = values.name?.trim();
  if (name) {
    payload.name = name;
  }
  if (clearedFields.includes('idCard')) {
    payload.idCard = null;
  } else if (values.idCard?.trim()) {
    payload.idCard = values.idCard.trim();
  }
  if (clearedFields.includes('phone')) {
    payload.phone = null;
  } else if (values.phone?.trim()) {
    payload.phone = values.phone.trim();
  }

  return payload;
}

export default function PatientEditModal({
  patientId,
  open,
  onClose,
  onUpdated,
}: PatientEditModalProps) {
  const [form] = Form.useForm<PatientFormValues>();
  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clearedFields, setClearedFields] = useState<SensitiveField[]>([]);

  /** 打开时拉详情回填。取消标记避免快速切换患者时用旧响应覆盖新表单 */
  useEffect(() => {
    if (!open || !patientId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setClearedFields([]);
    form.resetFields();

    fetchPatientDetail(patientId)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setDetail(data);
        form.setFieldsValue({
          gender: data.gender ? (data.gender as Gender) : undefined,
          birthDate: data.birthDate ? dayjs(data.birthDate) : undefined,
          bedNo: data.bedNo ?? undefined,
          doctorId: data.doctorId ?? undefined,
          diabetesType: data.diabetesType ?? undefined,
          hba1c: data.hba1c ?? undefined,
          patientNo: data.patientNo ?? undefined,
          departmentId: data.departmentId,
          nurseId: data.nurseId ?? undefined,
          admissionAt: data.admissionAt ? dayjs(data.admissionAt) : undefined,
          status: data.status,
        });
      })
      .catch(() => {
        // 错误提示由请求拦截器统一处理，这里只需保证弹框不卡在 loading
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, patientId, form]);

  const toggleClear = useCallback((field: SensitiveField) => {
    setClearedFields((prev) =>
      prev.includes(field) ? prev.filter((item) => item !== field) : [...prev, field],
    );
  }, []);

  const handleSubmit = async () => {
    if (!detail) {
      return;
    }

    let values: PatientFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = toUpdatePayload(values, clearedFields);
    // 与后端复用同一份 Zod 契约（住院号/入院时间/状态已被 schema omit，传了也会被丢弃）
    const parsed = updatePatientSchema.safeParse(payload);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.map((issue) => ({
          name: issue.path[0] as keyof PatientFormValues,
          errors: [issue.message],
        })),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await updatePatient(detail.id, payload);
      if (result.changedFields.length === 0) {
        void message.info('未做修改');
      } else {
        void message.success('患者信息已更新');
      }
      onUpdated(result.item);
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余错误由请求拦截器统一提示
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((item) => ({
            name: item.field as keyof PatientFormValues,
            errors: [item.message],
          })),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="编辑患者信息"
      width={760}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || !detail }}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      {/* 用 Spin 包裹而不是条件渲染，保证 form 实例始终已连接，避免 resetFields 报警 */}
      <Spin spinning={loading}>
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: '120px' }}
          wrapperCol={{ flex: '1 1 0' }}
          preserve={false}
          requiredMark
        >
          <PatientFormFields
            form={form}
            mode="edit"
            masked={detail}
            clearedFields={clearedFields}
            onToggleClear={toggleClear}
          />
        </Form>
      </Spin>
    </Modal>
  );
}
