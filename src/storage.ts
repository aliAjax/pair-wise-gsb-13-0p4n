// 本机保存层：只负责 localStorage 的读写与种子数据，不含任何结算规则。

import type { FuelRecord, PersistedState, Shift, ShiftCode } from "./types";

const STORAGE_KEY = "dfwlfront-7-fuel-settlement-v1";

function isoDaysAgo(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function shiftId(date: Date, code: ShiftCode): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}#${code}`;
}

/** 首次打开时的演示数据：一个已交班的晚班（含未到账挂账）+ 当前早班 */
function seedState(): PersistedState {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const nightShift: Shift = {
    id: shiftId(yesterday, "晚班"),
    date: yesterday.toISOString().slice(0, 10),
    code: "晚班",
    owner: "王建国",
    startedAt: isoDaysAgo(1, 22),
    endedAt: isoDaysAgo(0, 6),
    status: "已交班"
  };

  const today = new Date();
  const morningShift: Shift = {
    id: shiftId(today, "早班"),
    date: today.toISOString().slice(0, 10),
    code: "早班",
    owner: "李晓梅",
    startedAt: isoDaysAgo(0, 6),
    endedAt: null,
    status: "当班"
  };

  const records: FuelRecord[] = [
    {
      id: crypto.randomUUID(),
      cardNo: "YK10086021",
      fuelType: "92#汽油",
      liters: 45.2,
      receivable: 320,
      preAuth: 320,
      payMethod: "油卡挂账",
      shortfallNote: "夜班银行通道超时，站长只核了销量，挂账次日请款",
      receipts: [],
      shiftId: nightShift.id,
      ownerAtCreation: "王建国",
      createdBy: "王建国",
      createdAt: isoDaysAgo(1, 23),
      updatedAt: isoDaysAgo(1, 23),
      corrections: []
    },
    {
      id: crypto.randomUUID(),
      cardNo: "YK10055718",
      fuelType: "0#柴油",
      liters: 120,
      receivable: 864,
      preAuth: 900,
      payMethod: "单位挂账",
      shortfallNote: "",
      receipts: [
        {
          id: crypto.randomUUID(),
          amount: 864,
          method: "单位挂账",
          receivedAt: isoDaysAgo(0, 7),
          operator: "李晓梅",
          note: "次日银行到账，由早班代收确认，收入仍归晚班"
        }
      ],
      shiftId: nightShift.id,
      ownerAtCreation: "王建国",
      createdBy: "王建国",
      createdAt: isoDaysAgo(1, 23),
      updatedAt: isoDaysAgo(0, 7),
      corrections: []
    },
    {
      id: crypto.randomUUID(),
      cardNo: "VIP0003217",
      fuelType: "95#汽油",
      liters: 38.6,
      receivable: 305,
      preAuth: 0,
      payMethod: "微信",
      shortfallNote: "",
      receipts: [
        {
          id: crypto.randomUUID(),
          amount: 305,
          method: "微信",
          receivedAt: isoDaysAgo(0, 8),
          operator: "李晓梅",
          note: ""
        }
      ],
      shiftId: morningShift.id,
      ownerAtCreation: "李晓梅",
      createdBy: "李晓梅",
      createdAt: isoDaysAgo(0, 8),
      updatedAt: isoDaysAgo(0, 8),
      corrections: []
    }
  ];

  return {
    shifts: [nightShift, morningShift],
    records,
    currentShiftId: morningShift.id,
    operator: "李晓梅"
  };
}

export function loadState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seed = seedState();
    saveState(seed);
    return seed;
  }
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed.shifts || !parsed.records) throw new Error("数据结构不完整");
    return parsed;
  } catch {
    // 数据损坏时退回种子，避免页面白屏
    const seed = seedState();
    saveState(seed);
    return seed;
  }
}

export function saveState(state: PersistedState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export { shiftId };
