import { useMemo } from 'react';
import { DatePicker, Form, Input, InputNumber, Radio, Select } from 'antd';
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  DATE_TIME_FORMAT,
  DICT_TYPE,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_UNIT,
  GLUCOSE_VALUE_MAX,
  GLUCOSE_VALUE_MIN,
  TEST_STRIP_MAX,
  TEST_STRIP_MIN,
  TIME_SLOT_CATEGORY,
} from '@gc/shared';
import type { CreateGlucosePayload } from '@/api/glucose';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';

/**
 * 血糖表单值（添加弹框与 R25 编辑弹框共用）。
 * `resultType` 为 `DETECT` 时表示「这是一次真实读数」，0/1/2 由服务端按阈值判定。
 */
export interface GlucoseFormValues {
  measuredAt: Dayjs;
  mealContext: string;
  /** `DETECT` 或 '3'~'9' */
  resultType: string;
  valueMmolL?: number | null;
  testStrip?: number | null;
  operatorId: string;
  remark?: string;
}

/** 表单值 → 接口传输格式（添加与编辑共用同一份 payload 契约） */
export function toPayload(values: GlucoseFormValues): CreateGlucosePayload {
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

export interface GlucoseFormFieldsProps {
  form: FormInstance<GlucoseFormValues>;
  /**
   * 检测时间变化回调。添加弹框用它做「按时间自动推荐时段」；
   * R25 编辑模式不传——记录已有时段，改时间不应悄悄改掉它。
   */
  onMeasuredAtChange?: (value: Dayjs | null) => void;
  /** 用户手动选择检测时段时回调（添加弹框据此置 touched，之后不再被自动推荐覆盖） */
  onMealContextManualSelect?: () => void;
}

/**
 * 血糖录入表单字段组（R25 从 GlucoseCreateModal 抽取，添加/编辑两弹框复用，避免双实现漂移）。
 *
 * 单列排布，顺序：检测时间 → 检测时段 → 血糖值 → 检测结果类型 → 试纸 → 记录者 → 备注。
 * 「检测结果类型」无标签，紧跟血糖值输入框下方："检测"用真实读数，3~9 为无读数的检测结果类型。
 * 必须渲染在父层 `<Form form={form}>` 内；数据源（时段/字典/员工）自行订阅全局 store。
 */
export default function GlucoseFormFields({
  form,
  onMeasuredAtChange,
  onMealContextManualSelect,
}: GlucoseFormFieldsProps) {
  const profile = useAuthStore((state) => state.profile);
  const staff = useCommonDataStore((state) => state.staff);
  const dicts = useCommonDataStore((state) => state.dicts);
  const timeSlots = useCommonDataStore((state) => state.timeSlots);

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

  /** 切换结果类型：非检测类型没有读数，血糖值与试纸一并清空（输入框同时置灰） */
  const handleResultTypeChange = () => {
    form.setFieldsValue({ valueMmolL: null, testStrip: null });
  };

  return (
    <>
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
          // 改检测时间时同步推荐时段（用户已手动选过则保持不变；编辑模式不传回调）
          onChange={(value) => onMeasuredAtChange?.(value)}
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
          // 时段接口失败时不再用静态清单兜底（见 store/common-data.ts），
          // 这里明确告知原因，避免被误读成"库里没有可选时段"
          notFoundContent="时段数据未加载，请刷新页面重试"
          // 手动选择后不再被时间自动推荐覆盖
          onChange={() => {
            onMealContextManualSelect?.();
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
    </>
  );
}
