/**
 * 结算判断层：纯函数，不碰 localStorage、不依赖 Vue。
 * 规则只有一处来源：页面和保存层都必须经这里判断到账/收入。
 */
import type { FuelPayment, PaymentStatus, SettlementStore } from "./types";

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 单据状态：只看已确认到账金额与应收 */
export function deriveStatus(payment: Pick<FuelPayment, "receivable" | "settledAmount">): PaymentStatus {
  const settled = roundMoney(payment.settledAmount);
  if (settled <= 0) return "待结算";
  if (settled < roundMoney(payment.receivable)) return "部分到账";
  return "已到账";
}

/** 未到账缺额（>0 表示仍欠） */
export function shortfall(payment: Pick<FuelPayment, "receivable" | "settledAmount">): number {
  return roundMoney(Math.max(0, payment.receivable - payment.settledAmount));
}

/**
 * 缺额说明：把预授权、支付方式与实际到账放在一句话里讲清“为什么钱还没齐”。
 * 注意：预授权只是银行冻结额度，不是到账，不能计入收入。
 */
export function shortfallReason(p: Pick<FuelPayment, "receivable" | "settledAmount" | "preauth" | "payMethod">): string {
  const gap = shortfall(p);
  const preauthGap = roundMoney(p.receivable - p.preauth);
  if (gap <= 0) return "油款已全额到账";
  if (p.preauth > 0) {
    if (p.settledAmount > 0) {
      return `已到账 ¥${p.settledAmount.toFixed(2)}，预授权 ¥${p.preauth.toFixed(
        2
      )} 尚未扣划到账，缺额 ¥${gap.toFixed(2)}`;
    }
    return `${p.payMethod}预授权仅冻结 ¥${p.preauth.toFixed(2)}，银行尚未扣划到账${
      preauthGap > 0 ? `，授权额较应收还差 ¥${preauthGap.toFixed(2)}` : ""
    }，缺额 ¥${gap.toFixed(2)}`;
  }
  if (p.settledAmount > 0) {
    return `${p.payMethod}部分到账 ¥${p.settledAmount.toFixed(2)}，仍欠 ¥${gap.toFixed(2)}`;
  }
  return `${p.payMethod}油款未到账，缺额 ¥${gap.toFixed(2)}`;
}

export interface ShiftSummary {
  shiftId: string;
  /** 应收合计（本班下单的全部单据） */
  receivable: number;
  /** 已确认到账 = 当班收入；预授权不计入 */
  income: number;
  /** 未到账金额（含部分到账单据的缺额） */
  pending: number;
  orderCount: number;
  pendingCount: number;
  settledCount: number;
}

/** 班次汇总：收入只认“已确认到账”，且始终归属原下单班次 */
export function summarizeShift(
  store: SettlementStore,
  shiftId: string
): ShiftSummary {
  const list = store.payments.filter((p) => p.shiftId === shiftId);
  const summary: ShiftSummary = {
    shiftId,
    receivable: 0,
    income: 0,
    pending: 0,
    orderCount: list.length,
    pendingCount: 0,
    settledCount: 0
  };
  for (const p of list) {
    summary.receivable = roundMoney(summary.receivable + p.receivable);
    summary.income = roundMoney(summary.income + Math.min(p.settledAmount, p.receivable));
    const gap = shortfall(p);
    summary.pending = roundMoney(summary.pending + gap);
    if (gap > 0) summary.pendingCount += 1;
    if (deriveStatus(p) === "已到账") summary.settledCount += 1;
  }
  return summary;
}

/** 全部未结单据（任意班次，用于待结区与移交） */
export function pendingPayments(store: SettlementStore): FuelPayment[] {
  return store.payments.filter((p) => shortfall(p) > 0);
}

/**
 * 移交到当前台面的未结款：来自其他班次、随原班责任人跟进。
 * 这些钱不属于当班收入，确认到账后仍计入其原下单班次。
 */
export function carriedPayments(store: SettlementStore): FuelPayment[] {
  if (!store.currentShiftId) return [];
  return pendingPayments(store).filter((p) => p.shiftId !== store.currentShiftId);
}

/** 某班次自己的未结单据 */
export function shiftPendingPayments(store: SettlementStore, shiftId: string): FuelPayment[] {
  return store.payments.filter((p) => p.shiftId === shiftId && shortfall(p) > 0);
}

export function shiftPayments(store: SettlementStore, shiftId: string): FuelPayment[] {
  return store.payments.filter((p) => p.shiftId === shiftId);
}

/**
 * 同一张油卡再次提交：只更新原单，不新增。
 * 命中范围：卡号相同且尚未结清的最近一单；已到账单据不改写，另开新单。
 */
export function findOpenPaymentByCard(store: SettlementStore, cardNo: string): FuelPayment | undefined {
  const key = cardNo.trim();
  if (!key) return undefined;
  return store.payments
    .filter((p) => p.cardNo === key && shortfall(p) > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/** 本次登记到账后是否全额到账 */
export function wouldSettle(payment: FuelPayment, amount: number): boolean {
  return roundMoney(payment.settledAmount + amount) >= roundMoney(payment.receivable);
}
