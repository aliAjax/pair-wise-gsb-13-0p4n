// 业务规则冒烟测试：不依赖 DOM，直接驱动 store（localStorage 用内存桩代替）。
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v)
};
// Node 20 自带只读 globalThis.crypto（webcrypto），store 中的 crypto.randomUUID 可直接使用。

const { setActivePinia, createPinia } = await import("pinia");
const { useSettlementStore } = await import("../src/store.ts");
const { outstandingAmount, receivedAmount, settlementStatus, summarizeShift } = await import(
  "../src/settlement.ts"
);

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error("断言失败: " + msg);
  console.log("✓", msg);
}

setActivePinia(createPinia());
const s = useSettlementStore();

// 种子：晚班 1 笔未结（320）、1 笔已结（864，次日代收归晚班）；早班 1 笔已结 305
const night = s.shifts.find((x) => x.code === "晚班")!;
const morning = s.currentShift!;
assert(morning.code === "早班", "当前班次为早班");
const nightSummary = summarizeShift(night, s.records);
assert(nightSummary.confirmedIncome === 864, "晚班收入只含已确认到账 864");
assert(nightSummary.outstanding === 320, "晚班未结 320 留在待结区");
assert(s.pendingRecords.length === 1, "待结区 1 笔");

// 新建单
s.submitRecord({
  cardNo: "NEW001",
  fuelType: "95#汽油",
  liters: 10,
  receivable: 100,
  preAuth: 100,
  payMethod: "油卡挂账",
  shortfallNote: "等请款"
});
assert(s.pendingRecords.length === 2, "新单未到账进入待结区");
assert(settlementStatus(s.findByCard("NEW001")!) === "待结", "状态为待结");

// 同卡再提交：只更新原单
const beforeCount = s.records.length;
s.submitRecord({
  cardNo: "NEW001",
  fuelType: "95#汽油",
  liters: 12,
  receivable: 120,
  preAuth: 120,
  payMethod: "油卡挂账",
  shortfallNote: "等请款"
});
assert(s.records.length === beforeCount, "同卡提交不新建单据");
const same = s.findByCard("NEW001")!;
assert(same.receivable === 120 && same.liters === 12, "同卡提交更新原单字段");
assert(same.corrections.length === 1, "同卡更新保留一条留痕");
assert(same.corrections[0].changes.some((c) => c.field === "receivable" && c.oldValue === 100 && c.newValue === 120),
  "留痕记录旧值 100 → 新值 120");
assert(same.shiftId === morning.id, "更新后仍归原班");

// 部分到账
s.confirmReceipt(same.id, 50, "银行卡", "先到一半");
assert(receivedAmount(same) === 50 && outstandingAmount(same) === 70, "部分到账：已收 50 缺 70");
assert(settlementStatus(same) === "部分到账", "状态为部分到账");

// 超额确认被拒绝
let rejected = false;
try {
  s.confirmReceipt(same.id, 999, "现金", "");
} catch {
  rejected = true;
}
assert(rejected, "确认金额超过缺额被拒绝");

// 交接班：未结款随原班移交
s.handover("中班", "赵师傅");
assert(s.currentShift!.code === "中班" && s.currentShift!.owner === "赵师傅", "中班已开班");
assert(night.status === "已交班" && morning.status === "已交班", "早/晚班均已交班");
assert(same.shiftId === morning.id && same.ownerAtCreation === "李晓梅", "未结单仍归早班及原责任人");
const morningAfter = summarizeShift(morning, s.records);
assert(morningAfter.confirmedIncome === 355, "早班已确认收入 305+50=355（含交班后口径不变）");
assert(morningAfter.outstanding === 70, "早班未结 70 随原班责任人移交");

// 接班人代收确认尾款：收入计入原班
s.confirmReceipt(same.id, 70, "银行卡", "次日请款到账");
assert(settlementStatus(same) === "已结清", "尾款确认后结清");
assert(summarizeShift(morning, s.records).confirmedIncome === 425, "次日到账 70 计入原班收入 355+70=425");
assert(s.pendingRecords.every((r) => r.cardNo !== "NEW001"), "已结清单据移出待结区");
assert(s.pendingRecords.length === 1, "待结区只剩晚班 320 那笔");

// 改错必须写原因
rejected = false;
try {
  // @ts-expect-error 空原因
  s.correctRecord(same.id, { liters: 13 }, "  ");
} catch {
  rejected = true;
}
assert(rejected, "空原因改错被拒绝");

s.correctRecord(same.id, { liters: 12.5 }, "泵码单复核，升数录错");
const c2 = same.corrections.at(-1)!;
assert(c2.source === "改单" && c2.reason === "泵码单复核，升数录错", "改错保留原因");
assert(c2.changes[0].fieldLabel === "加油升数" && c2.changes[0].oldValue === 12 && c2.changes[0].newValue === 12.5,
  "改错保留旧值 12 → 12.5");

// 落盘校验：重开能按班次查
const raw = JSON.parse(store.get("dfwlfront-7-fuel-settlement-v1")!);
assert(raw.shifts.length === 3 && raw.currentShiftId === s.currentShift!.id, "本机已保存全部班次与当班指针");
assert(raw.records.every((r: { receipts?: unknown[] }) => Array.isArray(r.receipts)), "单据与到账记录完整落盘");

console.log("\n全部业务规则冒烟测试通过");
