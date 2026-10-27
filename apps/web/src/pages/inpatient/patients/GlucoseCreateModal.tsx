import { useEffect, useMemo, useState } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Radio, Select, message } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  createGlucoseSchema,
  DATE_TIME_FORMAT,
  DICT_TYPE,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_UNIT,
  GLUCOSE_VALUE_MAX,
  GLUCOSE_VALUE_MIN,
  getTimeSlotsByType,
  TEST_STRIP_MAX,
  TEST_STRIP_MIN,
  TIME_SLOT_TYPE,
} from '@gc/shared';
import type { GlucoseCreateResult, PatientListItem } from '@gc/shared';
import { ApiError } from '@/api/client';
import { createGlucose, type CreateGlucosePayload } from '@/api/glucose';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

interface GlucoseFormValues {
  measuredAt: Dayjs;
  mealContext: string;
  /** `DETECT` 或 '3'~'9' */
  resultType: string;
  valueMmolL?: number | null;
  testStrip?: number | null;
  operatorId: string;
  remark?: string;
}

interface GlucoseCreateModalProps {
  /** 目标患者；null 表示关闭 */
  patient: PatientListItem | null;
  open: boolean;
  onClose: () => void;
  /** 录入成功回调：带回更新后的列表项，供页面替换该行 */
  onSuccess: (result: GlucoseCreateResult) => void;
}

/** 表单值 → 接口传输格式 */
function toPayload(values: GlucoseFormValues): CreateGlucosePayload {
  const isDetect = values.resultType === GLUCOSE_ENTRY_DETECT;
  return {
    measuredAt: values.measuredAt.format(DATE_TIME_FORMAT),
    mealContext: values.mealContext,
    resultType: values.resultType,
    // 非检测类型由服务端强制为空，这里主动不收，避免脏值
    valueMmolL: isDetect ? (values.valueMmolL ?? null) : null,
    testStrip: isDetect ? (values.testStrip ?? null) : null,
    operatorId: values.operatorId,
    remark: values.remark?.trim() ? values.remark.trim() : null,
  };
}

/**
 * 添加血糖弹窗（住院患者）。
 * 表单单列排布，顺序：检测时间 → 检测时段 → 血糖值 → 检测结果类型 → 试纸 → 记录者 → 备注。
 * 「检测结果类型」无标签，紧跟血糖值输入框下方："检测"用真实读数，3~9 为无读数的检测结果类型。
 */
export default function GlucoseCreateModal({
  patient,
  open,
  onClose,
  onSuccess,
}: GlucoseCreateModalProps) {
  const [form] = Form.useForm<GlucoseFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const profile = useAuthStore((state) => state.profile);
  const staff = useCommonDataStore((state) => state.staff);
  const dicts = useCommonDataStore((state) => state.dicts);

  const resultType = Form.useWatch('resultType', form);
  const isDetect = resultType === GLUCOSE_ENTRY_DETECT;
  const dictItems = dicts[DICT_TYPE.GLUCOSE_RESULT] ?? [];

  /** 检测时段：常规（含随机）/ 强化 分组，顺序与字典一致 */
  const timeSlotOptions = useMemo(
    () => [
      {
        label: '常规时段',
        options: getTimeSlotsByType(TIME_SLOT_TYPE.NORMAL).map((slot) => ({
          value: slot.code,
          label: slot.name,
        })),
      },
      {
        label: '强化时段',
        options: getTimeSlotsByType(TIME_SLOT_TYPE.INTENSIVE).map((slot) => ({
          value: slot.code,
          label: slot.name,
        })),
      },
    ],
    [],
  );

  /**
   * 检测结果类型：'检测' + 字典里可选的项（3~9）。
   * 0/1/2 由后端判定，字典里 checkable=false，天然不会出现在这里。
   */
  const resultTypeOptions = useMemo(
    () => [
      { value: GLUCOSE_ENTRY_DETECT, label: '检测' },
      ...dictItems
        .filter((item) => item.checkable)
        .map((item) => ({ value: item.code, label: item.label })),
    ],
    [dictItems],
  );

  /**
   * 记录者：DY-OPERATOR（本科室在职医护）。
   * 当前登录账号不在其中时（如系统管理员）临时补一条，仅前端展示，不写回 DY-OPERATOR。
   */
  const operatorOptions = useMemo(() => {
    const options = staff.map((item) => ({ value: item.id, label: item.name }));
    if (profile && !staff.some((item) => item.id === profile.userId)) {
      options.unshift({ value: profile.userId, label: `${profile.displayName}（本人）` });
    }
    return options;
  }, [staff, profile]);

  /** 打开时重置：检测时间取当前时刻、结果类型默认「检测」、记录者默认当前账号 */
  useEffect(() => {
    if (!open) {
      return;
    }
    form.resetFields();
    form.setFieldsValue({
      measuredAt: dayjs(),
      resultType: GLUCOSE_ENTRY_DETECT,
      operatorId: profile?.userId,
    });
  }, [open, form, profile?.userId]);

  /** 切换结果类型：非检测类型没有读数，血糖值与试纸一并清空（输入框同时置灰） */
  const handleResultTypeChange = () => {
    form.setFieldsValue({ valueMmolL: null, testStrip: null });
  };

  const handleSubmit = async () => {
    if (!patient) {
      return;
    }

    let values: GlucoseFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const payload = toPayload(values);
    // 与后端复用同一份 Zod 契约，避免前端规则与接口校验不一致
    const parsed = createGlucoseSchema.safeParse(payload);
    if (!parsed.success) {
      form.setFields(
        parsed.error.issues.map((issue) => ({
          name: issue.path[0] as keyof GlucoseFormValues,
          errors: [issue.message],
        })),
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await createGlucose(patient.id, payload);
      void message.success('血糖添加成功');
      onSuccess(result);
      onClose();
    } catch (error) {
      // 字段级校验错误（10001）挂到表单项；其余错误由请求拦截器统一提示
      if (error instanceof ApiError && error.details?.length) {
        form.setFields(
          error.details.map((detail) => ({
            name: detail.field as keyof GlucoseFormValues,
            errors: [detail.message],
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
      title={patient ? `添加血糖 · ${patient.nameMasked}` : '添加血糖'}
      width={560}
      okText="确定"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => {
        void handleSubmit();
      }}
      onCancel={onClose}
      maskClosable={false}
    >
      <Form form={form} layout="vertical" preserve={false} requiredMark>
        <Form.Item
          name="measuredAt"
          label="检测时间"
          rules={[{ required: true, message: '请选择检测时间' }]}
        >
          <DatePicker
            showTime
            format={DATE_TIME_FORMAT}
            style={{ width: '100%' }}
            disabledDate={(current) => current.isAfter(dayjs(), 'day')}
          />
        </Form.Item>

        <Form.Item
          name="mealContext"
          label="检测时段"
          rules={[{ required: true, message: '请选择检测时段' }]}
        >
          <Select options={timeSlotOptions} placeholder="请选择检测时段" />
        </Form.Item>

        <Form.Item
          name="valueMmolL"
          label="血糖值"
          rules={[{ required: isDetect, message: '请输入血糖值' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            min={GLUCOSE_VALUE_MIN}
            max={GLUCOSE_VALUE_MAX}
            step={0.1}
            precision={1}
            disabled={!isDetect}
            addonAfter={GLUCOSE_UNIT}
            placeholder={`${GLUCOSE_VALUE_MIN} ~ ${GLUCOSE_VALUE_MAX}`}
          />
        </Form.Item>

        {/* 无标签：选项直接跟在血糖值下方，与血糖值共同构成"这次检测的结果" */}
        <Form.Item
          name="resultType"
          style={{ marginTop: -8 }}
          rules={[{ required: true, message: '请选择检测结果类型' }]}
        >
          <Radio.Group
            onChange={handleResultTypeChange}
            style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}
          >
            {resultTypeOptions.map((option) => (
              <Radio key={option.value} value={option.value}>
                {option.label}
              </Radio>
            ))}
          </Radio.Group>
        </Form.Item>

        <Form.Item name="testStrip" label="试纸">
          <InputNumber
            style={{ width: '100%' }}
            min={TEST_STRIP_MIN}
            max={TEST_STRIP_MAX}
            step={1}
            precision={0}
            disabled={!isDetect}
            placeholder={`${TEST_STRIP_MIN} ~ ${TEST_STRIP_MAX}`}
          />
        </Form.Item>

        <Form.Item
          name="operatorId"
          label="记录者"
          rules={[{ required: true, message: '请选择记录者' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            options={operatorOptions}
            placeholder="请选择记录者"
          />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={4} maxLength={500} showCount placeholder="请输入备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
