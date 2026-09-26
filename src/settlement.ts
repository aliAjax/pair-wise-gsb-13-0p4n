// 结算判断层：只做纯计算/纯规则，不读 localStorage、不碰页面。
// “确认到账后才计入当班收入”“未到账金额留在待结区”全部体现在这里。

import type { FuelRecord, PaymentReceipt, SettlementStatus, Shift } from "./types";

/** 已确认到账总额（预授权不算到账，必须显式确认） */
export function receivedAmount(record: FuelRecord): number {
  return round2(record.receipts.reduce((sum, item) => sum + item.amount, 0));
}

/** 未到账金额：应收 − 已到账，下限为 0（多收不在本单挂账，由备注说明） */
export function outstandingAmount(record: FuelRecord): number {
  return round2(Math.max(0, record.receivable - receivedAmount(record)));
}

export function settlementStatus(record: FuelRecord): SettlementStatus {
  const got = receivedAmount(record);
  if (got <= 0) return "待结";
  if (got < record.receivable) return "部分到账";
  return "已结清";
}

export function isSettled(record: FuelRecord): boolean {
  return receivedAmount(record) >= record.receivable;
}

/** 预授权是否足以覆盖应收（参考信息，不代表到账） */
export function preAuthCovers(record: FuelRecord): boolean {
  return record.preAuth >= record.receivable;
}

/** 待结区缺额说明：金额原因 + 人工说明 */
export function shortfallText(record: FuelRecord): string {
  const gap = outstandingAmount(record);
  const parts: string[] = [];
  if (gap > 0) {
    parts.push(
      `缺额 ¥${gap.toFixed(2)}：应收 ¥${record.receivable.toFixed(2)}，已确认到账 ¥${receivedAmount(record).toFixed(2)}`
    );
    if (record.preAuth > 0) {
      parts.push(
        preAuthCovers(record)
          ? `预授权 ¥${record.preAuth.toFixed(2)} 已冻结但未请款，到账后需人工确认`
          : `预授权仅 ¥${record.preAuth.toFixed(2)}，不足覆盖应收`
      );
    }
  }
  if (record.shortfallNote.trim()) parts.push(record.shortfallNote.trim());
  return parts.join("；");
}

/** 班次口径统计：只有确认到账的收款才计入收入，且始终计入原班 */
export interface ShiftSummary {
  shift: Shift;
  /** 本班建档的单据数（销量/笔数口径） */
  recordCount: number;
  liters: number;
  receivable: number;
  /** 当班收入：本班单据中已确认到账的金额（含交班后才到账的补收） */
  confirmedIncome: number;
  /** 本班未结款：随原班责任人移交 */
  outstanding: number;
  pendingCount: number;
}

export function summarizeShift(shift: Shift, records: FuelRecord[]): ShiftSummary {
  const mine = records.filter((item) => item.shiftId === shift.id);
  return {
    shift,
    recordCount: mine.length,
    liters: round2(mine.reduce((sum, item) => sum + item.liters, 0)),
    receivable: round2(mine.reduce((sum, item) => sum + item.receivable, 0)),
    confirmedIncome: round2(mine.reduce((sum, item) => sum + receivedAmount(item), 0)),
    outstanding: round2(mine.reduce((sum, item) => sum + outstandingAmount(item), 0)),
    pendingCount: mine.filter((item) => !isSettled(item)).length
  };
}

export function makeReceipt(
  amount: number,
  method: PaymentReceipt["method"],
  operator: string,
  note = ""
): PaymentReceipt {
  return {
    id: crypto.randomUUID(),
    amount: round2(amount),
    method,
    receivedAt: new Date().toISOString(),
    operator,
    note
  };
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
