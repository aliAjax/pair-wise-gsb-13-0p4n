/**
 * 油款资料层：油品、班次、支付方式等基础档案与演示数据。
 * 不做任何“是否到账”的判断，也不读写 localStorage。
 */
import type { PaymentInput, SettlementStore, ShiftKind, PayMethod } from "./types";

export const SHIFT_KINDS: readonly ShiftKind[] = ["早班", "中班", "夜班"] as const;

/** 常见油品挂牌价（元/升），用于录入时带出应收，仍允许手工修改 */
export const FUEL_CATALOG = [
  { type: "92#汽油", price: 7.52 },
  { type: "95#汽油", price: 8.05 },
  { type: "98#汽油", price: 9.18 },
  { type: "0#柴油", price: 7.21 }
] as const;

export const PAY_METHODS: readonly PayMethod[] = [
  "油卡",
  "现金",
  "微信",
  "支付宝",
  "银行卡",
  "预授权"
] as const;

/** 交班时本班单据的演示数据 */
export function createSeedStore(): SettlementStore {
  const nightId = "seed-shift-night";
  const dayId = "seed-shift-day";
  return {
    version: 1,
    // 演示：夜班已交班，早班为当前班；夜班两笔未结款随车班责任人移交到早班台面上
    currentShiftId: dayId,
    shifts: [
      {
        id: nightId,
        kind: "夜班",
        date: "2026-09-25",
        owner: "王强",
        status: "已交班",
        openedAt: "2026-09-25T22:00:00.000Z",
        closedAt: "2026-09-26T06:00:00.000Z"
      },
      {
        id: dayId,
        kind: "早班",
        date: "2026-09-26",
        owner: "李敏",
        status: "当班中",
        openedAt: "2026-09-26T06:00:00.000Z"
      }
    ],
    payments: [
      {
        id: "seed-pay-1",
        cardNo: "YK10086",
        fuelType: "95#汽油",
        liters: 40,
        receivable: 322,
        preauth: 300,
        payMethod: "油卡",
        status: "待结算",
        settledAmount: 0,
        arrivals: [],
        corrections: [],
        shiftId: nightId,
        createdAt: "2026-09-25T23:10:00.000Z",
        updatedAt: "2026-09-25T23:10:00.000Z",
        cashier: "王强",
        note: "预授权不足，银行划扣次日到账"
      },
      {
        id: "seed-pay-2",
        cardNo: "WX-8821",
        fuelType: "0#柴油",
        liters: 120,
        receivable: 865.2,
        preauth: 0,
        payMethod: "微信",
        status: "待结算",
        settledAmount: 0,
        arrivals: [],
        corrections: [],
        shiftId: nightId,
        createdAt: "2026-09-26T05:40:00.000Z",
        updatedAt: "2026-09-26T05:40:00.000Z",
        cashier: "王强",
        note: "车主已扫码，油款未到账"
      },
      {
        id: "seed-pay-3",
        cardNo: "ALI-5530",
        fuelType: "92#汽油",
        liters: 35,
        receivable: 263.2,
        preauth: 0,
        payMethod: "支付宝",
        status: "已到账",
        settledAmount: 263.2,
        arrivals: [
          {
            id: "seed-arr-1",
            amount: 263.2,
            arrivedAt: "2026-09-26T06:30:00.000Z",
            operator: "李敏",
            note: "交班后核账确认"
          }
        ],
        corrections: [],
        shiftId: dayId,
        createdAt: "2026-09-26T06:20:00.000Z",
        updatedAt: "2026-09-26T06:30:00.000Z",
        cashier: "李敏"
      }
    ]
  };
}

/** 录入表单初始值 */
export function createBlankInput(): PaymentInput {
  return {
    cardNo: "",
    fuelType: FUEL_CATALOG[0].type,
    liters: 0,
    receivable: 0,
    preauth: 0,
    payMethod: "油卡",
    cashier: "",
    note: ""
  };
}
