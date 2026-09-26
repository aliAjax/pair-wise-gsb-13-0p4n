/**
 * 本机保存层：只负责 localStorage 读写与数据落库动作。
 * “是否到账、归属哪个班”一律调用 settlement.ts 的规则，本层不自行判断。
 */
import { createSeedStore } from "./catalog";
import { deriveStatus, findOpenPaymentByCard, roundMoney, shortfall } from "./settlement";
import type {
  Correction,
  EditablePaymentField,
  FuelPayment,
  PaymentInput,
  SettlementStore,
  Shift,
  ShiftKind
} from "./types";

const STORAGE_KEY = "dfwlfront-7-settlement-v1";

export interface SubmitResult {
  payment: FuelPayment;
  /** true=同卡命中未结单并更新原单；false=新单 */
  updated: boolean;
  changedFields: EditablePaymentField[];
}

type Listener = (store: SettlementStore) => void;

function loadFromMachine(): SettlementStore {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = createSeedStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const parsed = JSON.parse(raw) as SettlementStore;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.payments) || !Array.isArray(parsed.shifts)) {
      throw new Error("本机数据版本不兼容");
    }
    return parsed;
  } catch {
    // 损坏数据不覆盖，改名备份后回到演示数据，避免直接丢失
    localStorage.setItem(`${STORAGE_KEY}.broken-${Date.now()}`, raw);
    const seed = createSeedStore();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function numericFields(): EditablePaymentField[] {
  return ["liters", "receivable", "preauth"];
}

class SettlementRepository {
  private store: SettlementStore;
  private listeners = new Set<Listener>();

  constructor() {
    this.store = loadFromMachine();
  }

  getState(): SettlementStore {
    return this.store;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(next: SettlementStore) {
    this.store = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    this.listeners.forEach((fn) => fn(next));
  }

  private requireCurrentShift(): Shift {
    const shift = this.store.shifts.find((s) => s.id === this.store.currentShiftId);
    if (!shift || shift.status !== "当班中") {
      throw new Error("当前没有当班班次，请先开班再提交油款");
    }
    return shift;
  }

  /** 开班 */
  openShift(kind: ShiftKind, date: string, owner: string): Shift {
    if (this.store.currentShiftId) {
      throw new Error("上一班尚未交班，不能同时开两个当班班次");
    }
    if (!owner.trim()) throw new Error("请填写当班责任人");
    const shift: Shift = {
      id: uid("shift"),
      kind,
      date,
      owner: owner.trim(),
      status: "当班中",
      openedAt: nowIso()
    };
    this.commit({
      ...this.store,
      currentShiftId: shift.id,
      shifts: [...this.store.shifts, shift]
    });
    return shift;
  }

  /**
   * 交班：只封存本班班次，不碰未结款。
   * 未结单据留在原班（shiftId 不变、责任人不变），开下一班后自动出现在待结区移交项。
   */
  handover(): void {
    const current = this.store.currentShiftId;
    if (!current) throw new Error("当前没有当班中的班次");
    this.commit({
      ...this.store,
      currentShiftId: null,
      shifts: this.store.shifts.map((s) =>
        s.id === current ? { ...s, status: "已交班" as const, closedAt: nowIso() } : s
      )
    });
  }

  /** 提交油款：同一张油卡有未结单时只更新原单，并把差异写入改错记录 */
  submitPayment(input: PaymentInput): SubmitResult {
    const shift = this.requireCurrentShift();
    const clean: PaymentInput = {
      ...input,
      cardNo: input.cardNo.trim(),
      liters: roundMoney(Number(input.liters) || 0),
      receivable: roundMoney(Number(input.receivable) || 0),
      preauth: roundMoney(Number(input.preauth) || 0),
      cashier: input.cashier.trim() || shift.owner,
      note: input.note?.trim()
    };
    if (!clean.cardNo) throw new Error("请填写卡号/凭证号");
    if (clean.receivable <= 0) throw new Error("应收金额必须大于 0");

    const existing = findOpenPaymentByCard(this.store, clean.cardNo);

    if (existing) {
      const changes: Array<{ field: EditablePaymentField; oldValue: string | number; newValue: string | number }> = [];
      (["cardNo", "fuelType", "liters", "receivable", "preauth", "payMethod"] as EditablePaymentField[]).forEach(
        (field) => {
          const oldValue = existing[field];
          const newValue = clean[field];
          if (oldValue !== newValue) {
            changes.push({ field, oldValue, newValue });
          }
        }
      );
      const corrections: Correction[] = changes.map((c) => ({
        id: uid("corr"),
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        reason: "同一张油卡再次提交，按最新提交更新原单",
        operator: clean.cashier,
        at: nowIso()
      }));
      const updated: FuelPayment = {
        ...existing,
        cardNo: clean.cardNo,
        fuelType: clean.fuelType,
        liters: clean.liters,
        receivable: clean.receivable,
        preauth: clean.preauth,
        payMethod: clean.payMethod,
        cashier: clean.cashier,
        note: clean.note || existing.note,
        corrections: [...existing.corrections, ...corrections],
        // 已到账金额不动；状态/缺额由结算规则重算（例如应收调小后可能直接结清）
        status: deriveStatus({ receivable: clean.receivable, settledAmount: existing.settledAmount }),
        updatedAt: nowIso()
      };
      this.commit({
        ...this.store,
        payments: this.store.payments.map((p) => (p.id === existing.id ? updated : p))
      });
      return { payment: updated, updated: true, changedFields: changes.map((c) => c.field) };
    }

    const payment: FuelPayment = {
      id: uid("pay"),
      cardNo: clean.cardNo,
      fuelType: clean.fuelType,
      liters: clean.liters,
      receivable: clean.receivable,
      preauth: clean.preauth,
      payMethod: clean.payMethod,
      status: "待结算",
      settledAmount: 0,
      arrivals: [],
      corrections: [],
      shiftId: shift.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      cashier: clean.cashier,
      note: clean.note
    };
    this.commit({ ...this.store, payments: [payment, ...this.store.payments] });
    return { payment, updated: false, changedFields: [] };
  }

  /**
   * 确认到账：唯一增加收入的入口。
   * 即便单据所属班次已交班，也允许在后续班次确认，收入仍计入原下单班次。
   */
  confirmArrival(paymentId: string, amount: number, operator: string, note?: string): FuelPayment {
    const payment = this.store.payments.find((p) => p.id === paymentId);
    if (!payment) throw new Error("找不到该油款单据");
    const value = roundMoney(Number(amount) || 0);
    if (value <= 0) throw new Error("到账金额必须大于 0");
    const gap = shortfall(payment);
    if (gap <= 0) throw new Error("该单已全额到账，无需重复确认");
    if (value > gap) throw new Error(`本次到账不能超过缺额 ¥${gap.toFixed(2)}`);

    const settledAmount = roundMoney(payment.settledAmount + value);
    const updated: FuelPayment = {
      ...payment,
      settledAmount,
      status: deriveStatus({ receivable: payment.receivable, settledAmount }),
      arrivals: [
        ...payment.arrivals,
        { id: uid("arr"), amount: value, arrivedAt: nowIso(), operator: operator.trim() || "当班人员", note: note?.trim() }
      ],
      updatedAt: nowIso()
    };
    this.commit({
      ...this.store,
      payments: this.store.payments.map((p) => (p.id === paymentId ? updated : p))
    });
    return updated;
  }

  /** 改错：必须填写原因，逐字段保留旧值 */
  correctPayment(
    paymentId: string,
    field: EditablePaymentField,
    rawValue: string | number,
    reason: string,
    operator: string
  ): FuelPayment {
    const payment = this.store.payments.find((p) => p.id === paymentId);
    if (!payment) throw new Error("找不到该油款单据");
    if (!reason.trim()) throw new Error("改错必须填写原因");
    const newValue = numericFields().includes(field)
      ? roundMoney(Number(rawValue) || 0)
      : String(rawValue).trim();
    if (field === "receivable" && (newValue as number) <= 0) throw new Error("应收金额必须大于 0");
    if (field === "cardNo" && !(newValue as string)) throw new Error("卡号不能为空");
    const oldValue = payment[field];
    if (oldValue === newValue) throw new Error("新值与旧值相同，无需改错");

    const corrected: FuelPayment = {
      ...payment,
      [field]: newValue,
      corrections: [
        ...payment.corrections,
        {
          id: uid("corr"),
          field,
          oldValue,
          newValue,
          reason: reason.trim(),
          operator: operator.trim() || "当班人员",
          at: nowIso()
        } satisfies Correction
      ],
      updatedAt: nowIso()
    };
    // 改应收后重算状态，到账金额本身只能走“确认到账”，改错不动钱
    corrected.status = deriveStatus(corrected);
    this.commit({
      ...this.store,
      payments: this.store.payments.map((p) => (p.id === paymentId ? corrected : p))
    });
    return corrected;
  }
}

export const settlementRepo = new SettlementRepository();
