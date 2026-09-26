// 通用领域模型：只描述“油款资料”长什么样，不做任何结算判断与存储。

export type ShiftCode = "早班" | "中班" | "晚班";

export type FuelType = "92#汽油" | "95#汽油" | "98#汽油" | "0#柴油";

export type PayMethod = "现金" | "微信" | "支付宝" | "银行卡" | "油卡挂账" | "单位挂账";

/** 班次（交接班的一方责任人主体） */
export interface Shift {
  /** 业务主键：YYYY-MM-DD#晚班 */
  id: string;
  date: string;
  code: ShiftCode;
  /** 本班责任人（班长/加油员），未结款随此人移交 */
  owner: string;
  startedAt: string;
  endedAt: string | null;
  status: "当班" | "已交班";
}

/** 一笔经“确认到账”的收款记录，是计入班次收入的唯一凭据 */
export interface PaymentReceipt {
  id: string;
  amount: number;
  method: PayMethod;
  /** 实际确认到账时间，可能发生在原班结束（次日）之后 */
  receivedAt: string;
  operator: string;
  note: string;
}

export type SettlementStatus = "待结" | "部分到账" | "已结清";

export interface FieldChange {
  field: string;
  fieldLabel: string;
  oldValue: string | number | null;
  newValue: string | number | null;
}

/** 改错留痕：原因 + 每个被改字段的旧值/新值 */
export interface Correction {
  id: string;
  at: string;
  operator: string;
  reason: string;
  source: "同卡更新" | "改单";
  changes: FieldChange[];
}

/** 一笔油款单据（油款资料层的核心对象） */
export interface FuelRecord {
  id: string;
  /** 油卡/会员卡号，同号再次提交只更新本单 */
  cardNo: string;
  fuelType: FuelType;
  /** 加油升数，供站长核销量 */
  liters: number;
  /** 应收金额 */
  receivable: number;
  /** 预授权金额 */
  preAuth: number;
  payMethod: PayMethod;
  /** 待结区展示的缺额说明（可手工修正） */
  shortfallNote: string;
  /** 已确认到账的逐笔收款 */
  receipts: PaymentReceipt[];
  /** 归属原班：收入与责任始终随原班，不随换班转移 */
  shiftId: string;
  ownerAtCreation: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  corrections: Correction[];
}

export interface PersistedState {
  shifts: Shift[];
  records: FuelRecord[];
  currentShiftId: string | null;
  operator: string;
}
