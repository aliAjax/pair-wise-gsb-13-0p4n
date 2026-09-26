// 操作编排层：把“油款资料 / 结算判断 / 本机保存”粘起来，页面只调用这里的动作。
// 所有写操作都同步落 localStorage；改错一律先记原因和旧值再改数据。

import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { isSettled, makeReceipt, outstandingAmount, receivedAmount, round2 } from "./settlement";
import { loadState, saveState, shiftId } from "./storage";
import type {
  Correction,
  FieldChange,
  FuelRecord,
  FuelType,
  PayMethod,
  Shift,
  ShiftCode
} from "./types";

export const FUEL_TYPES: readonly FuelType[] = ["92#汽油", "95#汽油", "98#汽油", "0#柴油"];
export const PAY_METHODS: readonly PayMethod[] = [
  "现金",
  "微信",
  "支付宝",
  "银行卡",
  "油卡挂账",
  "单位挂账"
];
export const SHIFT_CODES: readonly ShiftCode[] = ["早班", "中班", "晚班"];

export const FIELD_LABELS: Record<string, string> = {
  fuelType: "油品",
  liters: "加油升数",
  receivable: "应收金额",
  preAuth: "预授权金额",
  payMethod: "支付方式",
  shortfallNote: "缺额说明"
};

/** 新增/同卡更新时可录入的字段 */
export type RecordInput = {
  cardNo: string;
  fuelType: FuelType;
  liters: number;
  receivable: number;
  preAuth: number;
  payMethod: PayMethod;
  shortfallNote: string;
};

type CorrectionPatch = Partial<Pick<
  FuelRecord,
  "fuelType" | "liters" | "receivable" | "preAuth" | "payMethod" | "shortfallNote"
>>;

/** 对比改单前后字段，供留痕与页面预览共用 */
export function diffFields(before: FuelRecord, patch: CorrectionPatch): FieldChange[] {
  return (Object.keys(patch) as (keyof CorrectionPatch)[])
    .filter((field) => {
      const next = patch[field];
      return next !== undefined && String(before[field]) !== String(next);
    })
    .map((field) => ({
      field,
      fieldLabel: FIELD_LABELS[field] ?? field,
      oldValue: before[field] as string | number,
      newValue: patch[field] as string | number
    }));
}

export const useSettlementStore = defineStore("fuel-settlement", () => {
  const initial = loadState();

  const shifts = ref<Shift[]>(initial.shifts);
  const records = ref<FuelRecord[]>(initial.records);
  const currentShiftId = ref<string | null>(initial.currentShiftId);
  const operator = ref(initial.operator);

  const currentShift = ref<Shift | null>(
    initial.shifts.find((item) => item.id === initial.currentShiftId) ?? null
  );

  function persist() {
    saveState({
      shifts: shifts.value,
      records: records.value,
      currentShiftId: currentShiftId.value,
      operator: operator.value
    });
  }

  function findByCard(cardNo: string): FuelRecord | undefined {
    return records.value.find((item) => item.cardNo === cardNo.trim());
  }

  function shiftOf(record: FuelRecord): Shift | undefined {
    return shifts.value.find((item) => item.id === record.shiftId);
  }

  /**
   * 提交一笔油款资料。
   * 新卡 -> 在当前班次建档；同一张卡 -> 只更新原单，原单归属班次/责任人不变。
   */
  function submitRecord(input: RecordInput): { mode: "created" | "updated" | "unchanged"; record: FuelRecord } {
    if (!currentShift.value) throw new Error("当前没有当班班次，请先开班");
    const cardNo = input.cardNo.trim();
    if (!cardNo) throw new Error("请填写油卡/会员卡号");
    if (input.receivable < 0 || input.preAuth < 0 || input.liters < 0) {
      throw new Error("金额和升数不能为负数");
    }

    const existing = findByCard(cardNo);
    const now = new Date().toISOString();

    if (existing) {
      const patch: CorrectionPatch = {
        fuelType: input.fuelType,
        liters: round2(input.liters),
        receivable: round2(input.receivable),
        preAuth: round2(input.preAuth),
        payMethod: input.payMethod,
        shortfallNote: input.shortfallNote
      };
      const changes = diffFields(existing, patch);
      if (changes.length === 0) return { mode: "unchanged", record: existing };

      Object.assign(existing, patch, { updatedAt: now });
      existing.corrections.push(buildCorrection("同卡更新", "同一张油卡再次提交，按规则更新原单", changes));
      persist();
      return { mode: "updated", record: existing };
    }

    const record: FuelRecord = {
      id: crypto.randomUUID(),
      cardNo,
      fuelType: input.fuelType,
      liters: round2(input.liters),
      receivable: round2(input.receivable),
      preAuth: round2(input.preAuth),
      payMethod: input.payMethod,
      shortfallNote: input.shortfallNote,
      receipts: [],
      shiftId: currentShift.value.id,
      ownerAtCreation: currentShift.value.owner,
      createdBy: operator.value,
      createdAt: now,
      updatedAt: now,
      corrections: []
    };
    records.value = [record, ...records.value];
    persist();
    return { mode: "created", record };
  }

  /** 确认到账：只有调用本动作产生的收款才计入当班收入 */
  function confirmReceipt(recordId: string, amount: number, method: PayMethod, note: string) {
    const record = mustFind(recordId);
    if (isSettled(record)) throw new Error("该单已结清，无需重复确认");
    if (!(amount > 0)) throw new Error("到账金额必须大于 0");
    const gap = outstandingAmount(record);
    if (round2(amount) > gap) {
      throw new Error(`本次确认 ¥${amount.toFixed(2)} 超过未到账金额 ¥${gap.toFixed(2)}，多收请另行走退款登记`);
    }
    record.receipts.push(makeReceipt(amount, method, operator.value, note));
    record.updatedAt = new Date().toISOString();
    persist();
  }

  /** 改错：必须填写原因，逐字段保留旧值 */
  function correctRecord(recordId: string, patch: CorrectionPatch, reason: string) {
    const record = mustFind(recordId);
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("改错必须填写原因");
    const changes = diffFields(record, patch);
    if (changes.length === 0) throw new Error("没有检测到字段变化");
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    record.corrections.push(buildCorrection("改单", trimmed, changes));
    persist();
  }

  /**
   * 交接班：结掉当前班次，开新班次。
   * 未结单据不挪班、不改责任人，随原班责任人移交，后续到账仍计入原班收入。
   */
  function handover(nextCode: ShiftCode, nextOwner: string) {
    if (!currentShift.value) throw new Error("当前没有当班班次");
    const owner = nextOwner.trim();
    if (!owner) throw new Error("请填写新班次责任人");

    const nowIso = new Date().toISOString();
    currentShift.value.endedAt = nowIso;
    currentShift.value.status = "已交班";

    const next: Shift = {
      id: shiftId(new Date(), nextCode),
      date: nowIso.slice(0, 10),
      code: nextCode,
      owner,
      startedAt: nowIso,
      endedAt: null,
      status: "当班"
    };
    // 极端情况下同一班次标识重复（如同日重建），追加时间戳避免主键冲突
    if (shifts.value.some((item) => item.id === next.id)) {
      next.id = `${next.id}-${Date.now()}`;
    }
    shifts.value = [...shifts.value, next];
    currentShift.value = next;
    currentShiftId.value = next.id;
    operator.value = owner;
    persist();
  }

  function setOperator(name: string) {
    operator.value = name.trim() || operator.value;
    persist();
  }

  function buildCorrection(source: Correction["source"], reason: string, changes: FieldChange[]): Correction {
    return {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      operator: operator.value,
      reason,
      source,
      changes
    };
  }

  function mustFind(id: string): FuelRecord {
    const record = records.value.find((item) => item.id === id);
    if (!record) throw new Error("未找到对应油款单据");
    return record;
  }

  /** 待结区：所有未结清的单据，按原班分组信息展示 */
  const pendingRecords = computed(() =>
    records.value.filter((item) => !isSettled(item)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  );

  const stationOutstanding = computed(() =>
    round2(records.value.reduce((sum, item) => sum + outstandingAmount(item), 0))
  );

  const stationReceived = computed(() =>
    round2(records.value.reduce((sum, item) => sum + receivedAmount(item), 0))
  );

  return {
    shifts,
    records,
    currentShift,
    operator,
    pendingRecords,
    stationOutstanding,
    stationReceived,
    findByCard,
    shiftOf,
    submitRecord,
    confirmReceipt,
    correctRecord,
    handover,
    setOperator
  };
});
