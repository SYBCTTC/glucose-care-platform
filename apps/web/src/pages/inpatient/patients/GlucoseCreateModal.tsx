import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  pickTimeSlotByTime,
  TEST_STRIP_MAX,
  TEST_STRIP_MIN,
  TIME_SLOT_CATEGORY,
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
  const timeSlots = useCommonDataStore((state) => state.timeSlots);
  /** 用户是否手动改过检测时段：改过就不再被「按检测时间自动选中」覆盖 */
  const mealContextTouched = useRef(false);

  const resultType = Form.useWatch('resultType', form);
  const isDetect = resultType === GLUCOSE_ENTRY_DETECT;
  const dictItems = dicts[DICT_TYPE.GLUCOSE_RESULT] ?? [];

  /**
   * 检测时段：普通 → 特殊（随机/复测）→ 强化 分组，顺序由接口 sortOrder 决定。
   * 数据来自动态时段（GET /time-slots），只渲染 enabled 项；空分组不显示。
   */
  const timeSlotOptions = useMemo(() => {
    const enabled = timeSlots.filter((slot) => slot.enabled);
    return [
      { label: '普通时段', type: TIME_SLOT_CATEGORY.NORMAL },
      { label: '特殊时段', type: TIME_SLOT_CATEGORY.SPECIAL },
      { label: '强化时段', type: TIME_SLOT_CATEGORY.INTENSIVE },
    ]
      .map((group) => ({
        label: group.label,
        options: enabled
          .filter((slot) => slot.type === group.type)
          .map((slot) => ({ value: slot.code, label: slot.name })),
      }))
      .filter((group) => group.options.length > 0);
  }, [timeSlots]);

  /**
   * 检测时段默认值：按检测时间落入的普通时段自动选中（区间左闭右开，见 pickTimeSlotByTime）。
   * 用户手动改过时段后不再覆盖。
   */
  const applyTimeSlotByMeasuredAt = useCallback(
    (value: Dayjs | null | undefined) => {
      if (!value || mealContextTouched.current) {
        return;
      }
      const slot = pickTimeSlotByTime(timeSlots, value.format('HH:mm'));
      if (slot) {
        form.setFieldsValue({ mealContext: slot.code });
      }
    },
    [form, timeSlots],
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

  /**
   * 打开时重置：检测时间取当前时刻、结果类型默认「检测」、记录者默认当前账号。
   * 检测时段由下面的 effect 按检测时间自动选中。
   *
   * 注意不要给 Form 加 preserve={false}：Modal 的 body 在首帧后会再挂载一次，
   * 非保留字段在 Form 卸载时会被 destroyForm 清空，导致这里写入的默认值在首帧渲染时被抹掉
   * （表现为首次打开时全部为空、血糖值/试纸置灰）。关闭时不清空也无妨：每次打开都会重置。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    mealContextTouched.current = false;
    form.resetFields();
    form.setFieldsValue({
      measuredAt: dayjs(),
      resultType: GLUCOSE_ENTRY_DETECT,
      operatorId: profile?.userId,
    });
  }, [open, form, profile?.userId]);

  /**
   * 检测时段默认值。公共数据可能晚于弹窗到达（timeSlots 变化会再次触发），
   * 所以不能只在打开时算一次；用户手动选过之后 applyTimeSlotByMeasuredAt 内部会自动跳过。
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    applyTimeSlotByMeasuredAt(form.getFieldValue('measuredAt') as Dayjs | undefined);
  }, [open, applyTimeSlotByMeasuredAt, form]);

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
      {/* 与患者弹框一致：label 与控件同行，label 定宽保证各行控件左边缘对齐 */}
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ flex: '120px' }}
        wrapperCol={{ flex: '1 1 0' }}
        requiredMark
      >
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
            // 改检测时间时同步推荐时段（用户已手动选过则保持不变）
            onChange={(value) => applyTimeSlotByMeasuredAt(value)}
          />
        </Form.Item>

        <Form.Item
          name="mealContext"
          label="检测时段"
          rules={[{ required: true, message: '请选择检测时段' }]}
        >
          <Select
            options={timeSlotOptions}
            placeholder="请选择检测时段"
            // 手动选择后不再被时间自动推荐覆盖
            onChange={() => {
              mealContextTouched.current = true;
            }}
          />
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

        {/*
          无 label：选项直接跟在血糖值下方，与血糖值共同构成"这次检测的结果"。
          仍占用一个空 label 单元格（label=" "），否则本行控件会顶到最左侧、与上面的输入框错位。
        */}
        <Form.Item
          name="resultType"
          label=" "
          colon={false}
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
