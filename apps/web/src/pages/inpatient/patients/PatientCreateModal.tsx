import { useEffect, useState } from 'react';
import { Form, Modal, message } from 'antd';
import dayjs from 'dayjs';
import { createPatientSchema, DATE_ONLY_FORMAT, PATIENT_STATUS } from '@gc/shared';
import { ApiError } from '@/api/client';
import { createPatient, type CreatePatientPayload } from '@/api/patient';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import PatientFormFields, { type PatientFormValues } from './PatientFormFields';

interface PatientCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** 建档成功后的回调（刷新列表） */
  onSuccess: () => void;
}

/** 表单值 → 接口传输格式：日期转字符串，空串转 undefined */
function toPayload(values: PatientFormValues): CreatePatientPayload {
  return {
    name: values.name.trim(),
    gender: values.gender,
    birthDate: values.birthDate.format(DATE_ONLY_FORMAT),
    patientNo: values.patientNo.trim(),
    departmentId: values.departmentId,
    // UI 只选到分钟，补 :00 对齐统一契约 YYYY-MM-DD HH:mm:ss
    admissionAt: `${values.admissionAt.format('YYYY-MM-DD HH:mm')}:00`,
    status: values.status,
    idCard: values.idCard?.trim() || undefined,
    phone: values.phone?.trim() || undefined,
    bedNo: values.bedNo?.trim() || undefined,
    doctorId: values.doctorId,
    nurseId: values.nurseId,
    diabetesType: values.diabetesType,
    hba1c: values.hba1c ?? undefined,
  };
}

export default function PatientCreateModal({ open, onClose, onSuccess }: PatientCreateModalProps) {
  const [form] = Form.useForm<PatientFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const profile = useAuthStore((state) => state.profile);
  const departments = useCommonDataStore((state) => state.departments);

  /** 打开时重置表单：入院时间取当前时刻，科室默认取本人所属科室（在其可见范围内时） */
  useEffect(() => {
    if (!open) {
      return;
    }
    // 与 PatientFormFields 内科室下拉的收敛口径一致：NONE 档看不到任何科室
    const defaultDepartmentId =
      profile?.dataScope === 'NONE'
        ? undefined
        : departments.some((item) => item.id === profile?.departmentId)
          ? profile?.departmentId
          : undefined;
    form.resetFields();
    form.setFieldsValue({
      admissionAt: dayjs(),
      departmentId: defaultDepartmentId,
    });
  }, [open, form, departments, profile?.dataScope, profile?.departmentId]);

  const handleSubmit = async () => {
    let values: PatientFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = toPayload(values);
    // 与后端复用同一份 Zod 契约，避免前端规则与接口校验不一致
    const parsed = createPatientSchema.safeParse(payload);
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
      await createPatient(payload);
      void message.success('患者添加成功');
      onSuccess();
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余错误由请求拦截器统一提示
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((detail) => ({
            name: detail.field as keyof PatientFormValues,
            errors: [detail.message],
          })),
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 控制列必须用 flex-basis: 0：auto 会按内容最大宽度计算，长提示/长占位会把控件挤到下一行并独占整行
  return (
    <Modal
      open={open}
      title="添加患者"
      width={760}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ flex: '120px' }}
        wrapperCol={{ flex: '1 1 0' }}
        initialValues={{ status: PATIENT_STATUS.INPATIENT }}
        preserve={false}
        requiredMark
      >
        <PatientFormFields form={form} mode="create" />
      </Form>
    </Modal>
  );
}
