<script setup lang="ts">
// 当班油款结算台页面层：只做编排与展示，业务判断见 settlement.ts，落盘见 storage.ts。
import { computed, ref } from "vue";
import { useSettlementStore, type RecordInput } from "./store";
import { outstandingAmount, summarizeShift } from "./settlement";
import type { FuelRecord, ShiftCode } from "./types";
import RecordForm from "./components/RecordForm.vue";
import RecordCard from "./components/RecordCard.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import CorrectDialog from "./components/CorrectDialog.vue";
import HandoverDialog from "./components/HandoverDialog.vue";

const store = useSettlementStore();

// 班次查询：全部 / 待结区 / 具体某个班次（重开页面后仍可按班次查）
const queryShiftId = ref<string>("pending");
const cardLookup = ref("");

const handoverOpen = ref(false);
const confirmTarget = ref<FuelRecord | null>(null);
const correctTarget = ref<FuelRecord | null>(null);

const toast = ref<{ kind: "ok" | "err"; text: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(kind: "ok" | "err", text: string) {
  toast.value = { kind, text };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 3200);
}

function run(action: () => void, okText: string) {
  try {
    action();
    notify("ok", okText);
  } catch (error) {
    notify("err", error instanceof Error ? error.message : "操作失败");
  }
}

const sortedShifts = computed(() =>
  [...store.shifts].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
);

const shiftSummaries = computed(() =>
  sortedShifts.value.map((shift) => summarizeShift(shift, store.records))
);

const currentSummary = computed(() =>
  store.currentShift ? summarizeShift(store.currentShift, store.records) : null
);

/** 待结区：全站未结清单据，按原班责任人分组展示移交关系 */
const pendingGroups = computed(() => {
  const map = new Map<string, { shiftId: string; owner: string; total: number; items: FuelRecord[] }>();
  for (const record of store.pendingRecords) {
    const key = record.shiftId;
    const group = map.get(key) ?? { shiftId: key, owner: record.ownerAtCreation, total: 0, items: [] };
    group.items.push(record);
    group.total += outstandingAmount(record);
    map.set(key, group);
  }
  return [...map.values()];
});

/** 同卡再次提交：输入/查询命中已存在卡号时，表单进入“只更新原单”模式 */
const presetCard = computed(() => {
  const card = cardLookup.value.trim();
  if (!card) return null;
  const hit = store.findByCard(card);
  if (!hit) return null;
  return {
    cardNo: hit.cardNo,
    fuelType: hit.fuelType,
    liters: hit.liters,
    receivable: hit.receivable,
    preAuth: hit.preAuth,
    payMethod: hit.payMethod,
    shortfallNote: hit.shortfallNote
  };
});

const recordFormRef = ref<InstanceType<typeof RecordForm> | null>(null);

const visibleRecords = computed(() => {
  if (queryShiftId.value === "all") return store.records;
  if (queryShiftId.value === "pending") return store.pendingRecords;
  return store.records.filter((record) => record.shiftId === queryShiftId.value);
});

function shiftOf(record: FuelRecord) {
  return store.shiftOf(record);
}

function handleSubmit(input: RecordInput) {
  run(() => {
    const { mode, record } = store.submitRecord(input);
    queryShiftId.value = record.shiftId;
    cardLookup.value = "";
    if (mode === "created") recordFormRef.value?.reset();
    if (mode === "unchanged") throw new Error("提交内容与原单一致，没有需要更新的字段");
  }, "油款资料已保存（同卡只更新原单）");
}

function handleConfirm(payload: { id: string; amount: number; method: string; note: string }) {
  run(() => {
    store.confirmReceipt(payload.id, payload.amount, payload.method as FuelRecord["payMethod"], payload.note);
    confirmTarget.value = null;
  }, "已确认到账，金额计入原班当班收入");
}

function handleCorrect(payload: { id: string; reason: string; patch: Record<string, string | number> }) {
  run(() => {
    store.correctRecord(
      payload.id,
      payload.patch as Parameters<typeof store.correctRecord>[1],
      payload.reason
    );
    correctTarget.value = null;
  }, "改错已保存，原因与旧值已留痕");
}

function handleHandover(payload: { nextCode: ShiftCode; nextOwner: string }) {
  run(() => {
    store.handover(payload.nextCode, payload.nextOwner);
    handoverOpen.value = false;
    queryShiftId.value = "pending";
  }, "已交班：未结款随原班责任人移交，新班次已开");
}

const metricCards = computed(() => [
  { label: "本站已确认收入", value: `¥${store.stationReceived.toFixed(2)}` },
  { label: "待结区未到账总额", value: `¥${store.stationOutstanding.toFixed(2)}`, warn: true },
  {
    label: "当班已确认收入",
    value: currentSummary.value ? `¥${currentSummary.value.confirmedIncome.toFixed(2)}` : "—"
  }
]);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 夜班交接油款闭环</p>
          <h1>当班油款结算台</h1>
          <p class="subtitle">
            按笔登记卡号、油品、应收、预授权与支付方式；未到账留待结区并标明缺额，
            确认到账后才计入原班当班收入。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">油款资料 / 结算判断 / 本机保存 / 页面 分层</span>
        </div>
      </header>

      <transition name="toast">
        <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>
      </transition>

      <section class="metrics">
        <article v-for="card in metricCards" :key="card.label" class="metric" :class="{ warn: card.warn }">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </article>
      </section>

      <section v-if="store.currentShift && currentSummary" class="shift-strip">
        <div class="shift-strip-main">
          <span class="live-dot" />
          <div>
            <b>{{ store.currentShift.date }} {{ store.currentShift.code }}</b>
            <span class="muted">当班责任人：{{ store.currentShift.owner }}</span>
          </div>
        </div>
        <div class="shift-strip-nums">
          <span>应收 ¥{{ currentSummary.receivable.toFixed(2) }}</span>
          <span class="ok">已到账 ¥{{ currentSummary.confirmedIncome.toFixed(2) }}</span>
          <span :class="currentSummary.outstanding > 0 ? 'warn' : 'ok'">
            本班未结 ¥{{ currentSummary.outstanding.toFixed(2) }}（{{ currentSummary.pendingCount }} 笔）
          </span>
          <button type="button" @click="handoverOpen = true">交接班</button>
        </div>
      </section>

      <section class="workspace">
        <div class="left-col">
          <div class="panel lookup-panel">
            <h2>同卡查询</h2>
            <p class="panel-tip">输入卡号命中已有单据时，右侧录入只更新该原单。</p>
            <input v-model="cardLookup" placeholder="输入油卡/会员卡号" />
            <p v-if="cardLookup.trim() && presetCard" class="lookup-hit">
              已命中原单（{{ presetCard.fuelType }} / ¥{{ presetCard.receivable.toFixed(2) }}），提交即更新，不新建单
            </p>
            <p v-else-if="cardLookup.trim() && !presetCard" class="lookup-miss">未找到该卡，提交将新建单据</p>
          </div>

          <RecordForm
            ref="recordFormRef"
            :preset-card="presetCard"
            @submit="handleSubmit"
            @cancel-preset="cardLookup = ''"
          />
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>油款单据</h2>
            <select v-model="queryShiftId">
              <option value="pending">待结区（全部未到账）</option>
              <option value="all">全部班次</option>
              <option v-for="shift in sortedShifts" :key="shift.id" :value="shift.id">
                {{ shift.date }} {{ shift.code }} · {{ shift.owner }}
              </option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="visibleRecords.length === 0" class="empty">
              {{ queryShiftId === "pending" ? "待结区为空，油款均已到账" : "该班次暂无单据" }}
            </div>
            <RecordCard
              v-for="record in visibleRecords"
              :key="record.id"
              :record="record"
              :shift="shiftOf(record)"
              @confirm="confirmTarget = store.records.find((r) => r.id === $event) ?? null"
              @correct="correctTarget = store.records.find((r) => r.id === $event) ?? null"
            />
          </div>
        </section>
      </section>

      <section class="pending-zone">
        <div class="pending-head">
          <h2>待结区 · 未到账油款移交</h2>
          <span class="muted">共 {{ store.pendingRecords.length }} 笔，缺额 ¥{{ store.stationOutstanding.toFixed(2) }}</span>
        </div>
        <div v-if="pendingGroups.length === 0" class="empty">没有未到账油款</div>
        <div v-for="group in pendingGroups" :key="group.shiftId" class="pending-group">
          <div class="pending-group-head">
            <b>{{ group.shiftId }}</b>
            <span>原班责任人：{{ group.owner }}</span>
            <span class="warn">待结 ¥{{ group.total.toFixed(2) }}（{{ group.items.length }} 笔）</span>
            <span class="muted">换班不挪单，到账后收入仍归该班</span>
          </div>
          <div class="pending-rows">
            <RecordCard
              v-for="record in group.items"
              :key="record.id"
              :record="record"
              :shift="shiftOf(record)"
              @confirm="confirmTarget = store.records.find((r) => r.id === $event) ?? null"
              @correct="correctTarget = store.records.find((r) => r.id === $event) ?? null"
            />
          </div>
        </div>
      </section>

      <section class="shift-history">
        <h2>班次结算查询（本机保存，重开可查）</h2>
        <div class="shift-table">
          <article v-for="row in shiftSummaries" :key="row.shift.id" class="shift-row"
            :class="{ active: row.shift.id === store.currentShift?.id }">
            <div class="shift-row-head">
              <b>{{ row.shift.date }} {{ row.shift.code }}</b>
              <span class="status" :class="row.shift.status === '当班' ? 'st-部分到账' : ''">
                {{ row.shift.status }}
              </span>
            </div>
            <div class="shift-row-body">
              <span>责任人：{{ row.shift.owner }}</span>
              <span>销量：{{ row.liters.toFixed(2) }} L / {{ row.recordCount }} 笔</span>
              <span>应收：¥{{ row.receivable.toFixed(2) }}</span>
              <span class="ok">当班收入（确认到账）：¥{{ row.confirmedIncome.toFixed(2) }}</span>
              <span :class="row.outstanding > 0 ? 'warn' : 'ok'">
                未结移交：¥{{ row.outstanding.toFixed(2) }}（{{ row.pendingCount }} 笔）
              </span>
              <button type="button" class="secondary" @click="queryShiftId = row.shift.id">
                查看本班单据
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>

    <ConfirmDialog :record="confirmTarget" @close="confirmTarget = null" @confirm="handleConfirm" />
    <CorrectDialog :record="correctTarget" @close="correctTarget = null" @apply="handleCorrect" />
    <HandoverDialog
      v-if="store.currentShift"
      :open="handoverOpen"
      :current-shift="store.currentShift"
      :records="store.records"
      @close="handoverOpen = false"
      @handover="handleHandover"
    />
  </main>
</template>
