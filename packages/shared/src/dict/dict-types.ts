import { z } from 'zod';

/**
 * 动态字典（公共数据 DY-*）。
 * 取值存放在数据库 `DictItem` 表，登录后由 BasicLayout 一次性加载进
 * `useCommonDataStore`，页面从 store 取；**禁止在业务代码里硬编码 label / color**。
 * 静态字典时代的 `RESULT_TYPE`（D-RESULT）已被本文件取代。
 */
export const DICT_TYPE = {
  /** 血糖监测结果（0~9，含颜色、可选择、是否计入统计） */
  GLUCOSE_RESULT: 'GLUCOSE_RESULT',
} as const;
export type DictType = (typeof DICT_TYPE)[keyof typeof DICT_TYPE];

/** 已登记的字典类型清单：接口入参白名单，新增类型时必须在此登记 */
export const DICT_TYPES = [DICT_TYPE.GLUCOSE_RESULT] as const;

/** 字典项（后端下发、前端展示用；入库仍存 code） */
export interface DictItemOption {
  code: string;
  label: string;
  /** 语义色（如 #4BB2ED）；null 表示该字典项不区分颜色 */
  color: string | null;
  /** 是否可由用户选择：偏低/偏高由后台按阈值判定，为 false */
  checkable: boolean;
  /** 是否计入统计：拒检/外出/请假/已吃饭/未进食为 false */
  counted: boolean;
  /** 同类型内展示顺序，升序 */
  sortOrder: number;
}

/** 路径参数校验：dictType 必须在已登记清单内，未知类型直接 10001 */
export const dictTypeParamSchema = z.object({ dictType: z.enum(DICT_TYPES) });
