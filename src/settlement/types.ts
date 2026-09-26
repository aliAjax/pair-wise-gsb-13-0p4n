/**
 * 油款结算域：类型定义
 * 只描述“油款资料”长什么样，不包含任何结算判断和存取逻辑。
 */

/** 班次时段（早/中/夜） */
export type ShiftKind = "早班" | "中班" | "夜班";

/** 支付方式 */
export type PayMethod = "油卡" | "现金" | "微信" | "支付宝" | "银行卡" | "预授权";

/** 单据结算状态：只由结算规则推导/维护，页面不允许直接改 */
export type PaymentStatus = "待结算" | "部分到账" | "已到账";

/** 可被改错的字段 */
export type EditablePaymentField =
  | "cardNo"
  | "fuelType"
  | "liters"
  | "receivable"
  | "preauth"
  | "payMethod";

/** 到账登记记录 */
export interface Arrival {
  id: string;
  /** 本次确认到账金额 */
  amount: number;
  /** 到账时间（ISO），决定收入归属时点仍按下单班次 */
  arrivedAt: string;
  /** 登记人 */
  operator: string;
  note?: string;
}

/** 改错记录：保留原因、旧值、新值 */
export interface Correction {
  id: string;
  field: EditablePaymentField;
  oldValue: string | number;
  newValue: string | number;
  reason: string;
  operator: string;
  at: string;
}

/** 一笔油款单据 */
export interface FuelPayment {
  id: string;
  /** 卡号：油卡为油卡号，其余支付方式记录交易卡号/凭证号，可空 */
  cardNo: string;
  fuelType: string;
  liters: number;
  /** 应收金额 */
  receivable: number;
  /** 预授权金额（未完成预授权或无预授权为 0） */
  preauth: number;
  payMethod: PayMethod;
  status: PaymentStatus;
  /** 已确认到账金额合计 */
  settledAmount: number;
  arrivals: Arrival[];
  corrections: Correction[];
  /** 下单班次 id：收入永远归属该班次（原班责任人） */
  shiftId: string;
  /** 下单时间 */
  createdAt: string;
  /** 最近一次信息更新（同卡再次提交/改错） */
  updatedAt: string;
  cashier: string;
  note?: string;
}

/** 班次 */
export interface Shift {
  id: string;
  kind: ShiftKind;
  /** 业务日期，如 2026-09-25 */
  date: string;
  /** 当班责任人，未结款随其移交 */
  owner: string;
  status: "当班中" | "已交班";
  openedAt: string;
  closedAt?: string;
}

/** 本机持久化结构 */
export interface SettlementStore {
  version: number;
  currentShiftId: string | null;
  shifts: Shift[];
  payments: FuelPayment[];
}

/** 提交一笔油款（同卡再次提交时作为更新内容） */
export interface PaymentInput {
  cardNo: string;
  fuelType: string;
  liters: number;
  receivable: number;
  preauth: number;
  payMethod: PayMethod;
  cashier: string;
  note?: string;
}
