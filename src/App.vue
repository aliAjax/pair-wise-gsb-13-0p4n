<script setup lang="ts">
/**
 * 当班油款结算台（交接页）
 * 分层：油款资料 catalog.ts · 结算判断 settlement.ts · 本机保存 storage.ts · 本页面
 */
import { computed, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useSettlement } from "./settlement/useSettlement";
import { FUEL_CATALOG, PAY_METHODS, SHIFT_KINDS, createBlankInput } from "./settlement/catalog";
import {
  carriedPayments,
  roundMoney,
  shiftPayments,
  shiftPendingPayments,
  summarizeShift
} from "./settlement/settlement";
import type { EditablePaymentField, FuelPayment, PaymentInput, ShiftKind } from "./settlement/types";
import { formatMoney, formatTime, todayStr } from "./settlement/format";
import PaymentCard from "./components/PaymentCard.vue";

const { store, repo } = useSettlement();

/* ---------- 班次视图：默认当前班，交班后可切到任意历史班查询 ---------- */

const viewId = ref<string>("current");
watch(
  () => store.value.currentShiftId,
  (currentId) => {
    if (currentId) viewId.value = "current";
  }
);

const shiftMap = computed(() => new Map(store.value.shifts.map((s) => [s.id, s])));
const currentShift = computed(() =>
  store.value.shifts.find((s) => s.id === store.value.currentShiftId) ?? null
);
const historyShifts = computed(() =>
  [...store.value.shifts].sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
);
const viewShift = computed(() => {
  if (viewId.value === "current") return currentShift.value;
  return shiftMap.value.get(viewId.value) ?? null;
});
const isCurrentView = computed(() => viewId.value === "current" && !!currentShift.value);

const carried = computed(() => (currentShift.value ? carriedPayments(store.value) : []));
const carriedTotal = computed(() =>
  roundMoney(carried.value.reduce((sum, p) => sum + Math.max(0, p.receivable - p.settledAmount), 0))
);

const viewPending = computed<FuelPayment[]>(() => {
  if (viewShift.value) return shiftPendingPayments(store.value, viewShift.value.id);
  // 无当班班次（刚交班、未开班）：待结区展示全部未结款，等待下一班接手
  return store.value.payments
    .filter((p) => p.receivable - p.settledAmount > 0)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
});

const viewLedger = computed<FuelPayment[]>(() => {
  if (!viewShift.value) return [];
  return shiftPayments(store.value, viewShift.value.id).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1
  );
});

const summary = computed(() =>
  viewShift.value ? summarizeShift(store.value, viewShift.value.id) : null
);
const viewLiters = computed(() =>
  viewLedger.value.reduce((sum, p) => sum + (Number(p.liters) || 0), 0)
);

/* ---------- 油款录入 ---------- */

const form = reactive<PaymentInput>(createBlankInput());
const autoReceivable = ref(true);

function fuelPrice(type: string): number {
  return FUEL_CATALOG.find((f) => f.type === type)?.price ?? 0;
}
watch(
  () => [form.fuelType, form.liters] as const,
  ([type, liters]) => {
    if (autoReceivable.value) {
      form.receivable = roundMoney((Number(liters) || 0) * fuelPrice(type));
    }
  }
);
watch(
  () => form.payMethod,
  (method) => {
    // 仅“预授权/油卡”使用预授权栏，其余渠道预授权恒为 0
    if (method !== "预授权" && method !== "油卡") form.preauth = 0;
  }
);

function ownerOf(payment: FuelPayment) {
  return shiftMap.value.get(payment.shiftId);
}

function submitPayment() {
  try {
    const result = repo.submitPayment({ ...form });
    if (result.updated) {
      const fields = result.changedFields.length ? `，更新字段：${result.changedFields.join("、")}` : "，内容无变化";
      ElMessage.success(`同卡只更新原单（${result.payment.cardNo}）${fields}`);
    } else {
      ElMessage.success(`已登记新单，等待到账确认（${result.payment.cardNo}）`);
    }
    Object.assign(form, createBlankInput());
    autoReceivable.value = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------- 开班 / 交班 ---------- */

const openDialogVisible = ref(false);
const openForm = reactive<{ kind: ShiftKind; date: string; owner: string }>({
  kind: "早班",
  date: todayStr(),
  owner: ""
});

function openShift() {
  try {
    const shift = repo.openShift(openForm.kind, openForm.date, openForm.owner);
    ElMessage.success(`已开班：${shift.date} ${shift.kind}，责任人 ${shift.owner}`);
    openDialogVisible.value = false;
    openForm.owner = "";
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

async function handover() {
  if (!currentShift.value) return;
  const ownPending = shiftPendingPayments(store.value, currentShift.value.id);
  try {
    await ElMessageBox.confirm(
      `交班只封存本班销量，未结款 ${ownPending.length} 笔不随班结转，仍由责任人「${currentShift.value.owner}」跟进，到账后计入本班收入。确认交班？`,
      "确认交班",
      { type: "warning", confirmButtonText: "确认交班", cancelButtonText: "再核一下" }
    );
    repo.handover();
    ElMessage.success("已交班，未结款保留在待结区等待接手");
  } catch {
    /* 用户取消 */
  }
}

/* ---------- 确认到账 ---------- */

const arrivalDialogVisible = ref(false);
const arrivalTarget = ref<FuelPayment | null>(null);
const arrivalForm = reactive({ amount: 0, operator: "", note: "" });

function openArrival(payment: FuelPayment) {
  arrivalTarget.value = payment;
  arrivalForm.amount = roundMoney(Math.max(0, payment.receivable - payment.settledAmount));
  arrivalForm.operator = currentShift.value?.owner ?? "";
  arrivalForm.note = "";
  arrivalDialogVisible.value = true;
}

function confirmArrival() {
  if (!arrivalTarget.value) return;
  try {
    const updated = repo.confirmArrival(
      arrivalTarget.value.id,
      arrivalForm.amount,
      arrivalForm.operator,
      arrivalForm.note
    );
    const shift = ownerOf(updated);
    ElMessage.success(
      updated.status === "已到账"
        ? `已全额到账，计入${shift?.date ?? ""} ${shift?.kind ?? ""}收入`
        : "部分到账已登记，缺额留在待结区"
    );
    arrivalDialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------- 改错 ---------- */

const FIELD_LABELS: Record<EditablePaymentField, string> = {
  cardNo: "卡号",
  fuelType: "油品",
  liters: "升数(L)",
  receivable: "应收金额",
  preauth: "预授权金额",
  payMethod: "支付方式"
};
const NUMERIC_FIELDS: EditablePaymentField[] = ["liters", "receivable", "preauth"];

const correctDialogVisible = ref(false);
const correctTarget = ref<FuelPayment | null>(null);
const correctForm = reactive<{ field: EditablePaymentField; value: string | number; reason: string; operator: string }>(
  { field: "receivable", value: 0, reason: "", operator: "" }
);

function openCorrect(payment: FuelPayment) {
  correctTarget.value = payment;
  correctForm.field = "receivable";
  correctForm.value = payment.receivable;
  correctForm.reason = "";
  correctForm.operator = currentShift.value?.owner ?? payment.cashier;
  correctDialogVisible.value = true;
}

watch(
  () => correctForm.field,
  (field) => {
    if (correctTarget.value) correctForm.value = correctTarget.value[field];
  }
);

function submitCorrect() {
  if (!correctTarget.value) return;
  try {
    repo.correctPayment(
      correctTarget.value.id,
      correctForm.field,
      correctForm.value,
      correctForm.reason,
      correctForm.operator
    );
    ElMessage.success("改错已记录，旧值与原因已保留");
    correctDialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/* ---------- 单据明细 ---------- */

const detailTarget = ref<FuelPayment | null>(null);
const detailVisible = ref(false);
function openDetail(payment: FuelPayment) {
  detailTarget.value = payment;
  detailVisible.value = true;
}

/* ---------- 台账筛选 ---------- */

const ledgerFilter = ref<"all" | "pending" | "settled">("all");
const ledgerKeyword = ref("");
const filteredLedger = computed(() => {
  const keyword = ledgerKeyword.value.trim();
  return viewLedger.value.filter((p) => {
    if (ledgerFilter.value === "pending" && p.status === "已到账") return false;
    if (ledgerFilter.value === "settled" && p.status !== "已到账") return false;
    if (keyword && !p.cardNo.includes(keyword) && !p.fuelType.includes(keyword)) return false;
    return true;
  });
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 交接即结算</p>
          <h1>当班油款结算台</h1>
          <p class="subtitle">
            每笔记录卡号、油品、应收、预授权和支付方式；未到账留在待结区并标明缺额。
            站长不只核销量——只有<b>确认到账</b>才计入当班收入，未结款随原班责任人移交。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">结算规则</span>
          <span class="tag">本机持久化</span>
          <span class="tag">改错留痕</span>
        </div>
      </header>

      <!-- 班次操作条 -->
      <section class="shift-bar">
        <div class="shift-info">
          <template v-if="currentShift">
            <span class="shift-dot live" aria-hidden="true"></span>
            <div>
              <strong>{{ currentShift.date }} {{ currentShift.kind }}</strong>
              <span>当班责任人：{{ currentShift.owner }} · 开班 {{ formatTime(currentShift.openedAt) }}</span>
            </div>
            <el-tag type="success" effect="dark" round>当班中</el-tag>
          </template>
          <template v-else>
            <span class="shift-dot idle" aria-hidden="true"></span>
            <div>
              <strong>当前无当班班次</strong>
              <span>交班后未开班，待结区全部未结款等待新班责任人接手</span>
            </div>
          </template>
        </div>
        <div class="shift-ops">
          <el-select v-model="viewId" style="width: 240px">
            <el-option v-if="currentShift" label="当前班（结算台）" value="current" />
            <el-option
              v-for="s in historyShifts"
              :key="s.id"
              :label="`${s.date} ${s.kind} · ${s.owner} · ${s.status}`"
              :value="s.id"
            />
          </el-select>
          <el-button v-if="!currentShift" type="primary" @click="openDialogVisible = true">开班接班</el-button>
          <el-button v-else type="warning" plain @click="handover">交班封存</el-button>
        </div>
      </section>

      <!-- 指标卡 -->
      <section class="metrics">
        <article class="metric">
          <span>本班销量（站长复核项）</span>
          <strong>{{ viewLiters.toLocaleString() }} L</strong>
          <em v-if="viewShift" class="metric-sub">{{ summary?.orderCount ?? 0 }} 笔单据</em>
        </article>
        <article class="metric">
          <span>本班应收</span>
          <strong>{{ formatMoney(summary?.receivable ?? 0) }}</strong>
          <em class="metric-sub">含未到账，不等于收入</em>
        </article>
        <article class="metric income">
          <span>当班收入（已确认到账）</span>
          <strong>{{ formatMoney(summary?.income ?? 0) }}</strong>
          <em class="metric-sub">预授权不计收入</em>
        </article>
        <article class="metric pending">
          <span>本班未到账缺额</span>
          <strong>{{ formatMoney(summary?.pending ?? 0) }}</strong>
          <em class="metric-sub">{{ summary?.pendingCount ?? 0 }} 笔待结</em>
        </article>
      </section>

      <section v-if="isCurrentView && carried.length" class="carried-banner">
        <span class="carry-dot" aria-hidden="true">↔</span>
        <div>
          <strong>移交待结款 {{ carried.length }} 笔，合计 {{ formatMoney(carriedTotal) }}</strong>
          <span>来自之前班次，随原班责任人跟进；确认到账后计入原班收入，不计入本班。</span>
        </div>
      </section>

      <section class="workspace">
        <!-- 录入 -->
        <form class="panel entry-panel" @submit.prevent="submitPayment">
          <h2>油款登记</h2>
          <p class="panel-hint">同一卡号再次提交，只更新其未结原单，不重复开单。</p>
          <div class="form-grid">
            <label>
              卡号 / 凭证号
              <input v-model="form.cardNo" required placeholder="油卡号或支付凭证号" />
            </label>
            <label>
              油品
              <select v-model="form.fuelType">
                <option v-for="f in FUEL_CATALOG" :key="f.type" :value="f.type">
                  {{ f.type }}（¥{{ f.price.toFixed(2) }}/L）
                </option>
              </select>
            </label>
            <label>
              升数 L
              <input v-model.number="form.liters" type="number" min="0" step="0.01" required />
            </label>
            <label>
              应收金额
              <input v-model.number="form.receivable" type="number" min="0" step="0.01" required
                @focus="autoReceivable = false" />
              <small>按挂牌价自动带出，可手工改</small>
            </label>
            <label>
              支付方式
              <select v-model="form.payMethod">
                <option v-for="m in PAY_METHODS" :key="m" :value="m">{{ m }}</option>
              </select>
            </label>
            <label>
              预授权金额
              <input v-model.number="form.preauth" type="number" min="0" step="0.01"
                :disabled="form.payMethod !== '预授权' && form.payMethod !== '油卡'" />
              <small>仅银行冻结额度，<b>不算到账</b></small>
            </label>
            <label>
              加油员
              <input v-model="form.cashier" :placeholder="currentShift?.owner ?? '经手人'" />
            </label>
            <label class="full">
              备注
              <textarea v-model="form.note" placeholder="如：车主已扫码、银行次日划扣等" />
            </label>
          </div>
          <button class="primary-btn" type="submit" :disabled="!currentShift">
            {{ currentShift ? "提交油款" : "请先开班" }}
          </button>
        </form>

        <!-- 待结区 -->
        <section class="panel pending-panel">
          <div class="panel-title-row">
            <h2>待结区（未到账）</h2>
            <el-tag v-if="isCurrentView" type="warning" effect="plain">
              本班 {{ viewPending.length }} 笔 · 移交 {{ carried.length }} 笔
            </el-tag>
          </div>

          <template v-if="isCurrentView">
            <div v-if="carried.length" class="pending-group">
              <p class="group-label">其他班次移交（随原班责任人）</p>
              <PaymentCard
                v-for="p in carried"
                :key="p.id"
                :payment="p"
                :owner-shift="ownerOf(p)"
                carried
                @arrive="openArrival"
                @correct="openCorrect"
                @detail="openDetail"
              />
            </div>
            <div class="pending-group">
              <p class="group-label">本班待结</p>
              <PaymentCard
                v-for="p in viewPending"
                :key="p.id"
                :payment="p"
                :owner-shift="viewShift ?? undefined"
                @arrive="openArrival"
                @correct="openCorrect"
                @detail="openDetail"
              />
              <div v-if="viewPending.length === 0 && carried.length === 0" class="empty">
                本班油款均已到账
              </div>
              <div v-else-if="viewPending.length === 0" class="empty-inline">本班无待结款</div>
            </div>
          </template>

          <template v-else>
            <PaymentCard
              v-for="p in viewPending"
              :key="p.id"
              :payment="p"
              :owner-shift="viewShift ?? undefined"
              @arrive="openArrival"
              @correct="openCorrect"
              @detail="openDetail"
            />
            <div v-if="viewPending.length === 0" class="empty">
              {{ viewShift ? "该班次无未结款，账实两清" : "暂无待结款" }}
            </div>
          </template>
        </section>
      </section>

      <!-- 本班单据台账（按班次查询） -->
      <section class="panel ledger-panel">
        <div class="panel-title-row">
          <h2>
            单据台账
            <small v-if="viewShift">· {{ viewShift.date }} {{ viewShift.kind }}（{{ viewShift.owner }}）</small>
          </h2>
          <div class="ledger-filters">
            <input v-model="ledgerKeyword" class="keyword" placeholder="按卡号/油品查" />
            <el-radio-group v-model="ledgerFilter" size="small">
              <el-radio-button label="all">全部</el-radio-button>
              <el-radio-button label="pending">未到账</el-radio-button>
              <el-radio-button label="settled">已到账</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <el-table v-if="viewShift" :data="filteredLedger" stripe size="small">
          <el-table-column prop="cardNo" label="卡号" min-width="120" />
          <el-table-column prop="fuelType" label="油品" min-width="90" />
          <el-table-column label="升数" width="90">
            <template #default="{ row }">{{ row.liters }} L</template>
          </el-table-column>
          <el-table-column label="应收" width="110" align="right">
            <template #default="{ row }">{{ formatMoney(row.receivable) }}</template>
          </el-table-column>
          <el-table-column label="预授权" width="110" align="right">
            <template #default="{ row }">{{ formatMoney(row.preauth) }}</template>
          </el-table-column>
          <el-table-column prop="payMethod" label="支付方式" width="90" />
          <el-table-column label="已到账" width="110" align="right">
            <template #default="{ row }">
              <span :class="row.status === '已到账' ? 'ok-text' : 'due-text'">
                {{ formatMoney(row.settledAmount) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === '已到账' ? 'success' : row.status === '部分到账' ? 'warning' : 'danger'">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openArrival(row)" :disabled="row.status === '已到账'">到账</el-button>
              <el-button link size="small" @click="openCorrect(row)">改错</el-button>
              <el-button link size="small" @click="openDetail(row)">记录</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-else class="empty">无当班班次，开班后即可登记油款；历史班次请用上方下拉框查询。</div>
      </section>

      <!-- 开班对话框 -->
      <el-dialog v-model="openDialogVisible" title="开班接班" width="380px">
        <div class="dialog-form">
          <label>班次<el-select v-model="openForm.kind"><el-option v-for="k in SHIFT_KINDS" :key="k" :label="k" :value="k" /></el-select></label>
          <label>业务日期<el-date-picker v-model="openForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></label>
          <label>当班责任人<input v-model="openForm.owner" placeholder="如：李敏" /></label>
          <p class="dialog-tip">交班未结款会自动出现在新班待结区，但收入仍归属原班责任人。</p>
        </div>
        <template #footer>
          <el-button @click="openDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="openShift">开班</el-button>
        </template>
      </el-dialog>

      <!-- 确认到账对话框 -->
      <el-dialog v-model="arrivalDialogVisible" title="确认油款到账" width="420px">
        <div v-if="arrivalTarget" class="dialog-form">
          <p class="arrive-line">
            卡号 <b>{{ arrivalTarget.cardNo }}</b> · {{ arrivalTarget.fuelType }} ·
            应收 {{ formatMoney(arrivalTarget.receivable) }}，
            缺额 <b class="due-text">{{ formatMoney(Math.max(0, arrivalTarget.receivable - arrivalTarget.settledAmount)) }}</b>
          </p>
          <label>本次到账金额
            <el-input-number v-model="arrivalForm.amount" :min="0.01" :max="roundMoney(arrivalTarget.receivable - arrivalTarget.settledAmount)" :precision="2" :step="10" style="width: 100%" />
          </label>
          <label>确认人<input v-model="arrivalForm.operator" placeholder="确认到账的经手人" /></label>
          <label>说明<input v-model="arrivalForm.note" placeholder="如：银行划扣已查到、车主补付现金" /></label>
          <p class="dialog-tip">
            到账即计入
            <b>{{ ownerOf(arrivalTarget)?.date }} {{ ownerOf(arrivalTarget)?.kind }}</b>
            的当班收入（原班责任人：{{ ownerOf(arrivalTarget)?.owner }}）。
          </p>
        </div>
        <template #footer>
          <el-button @click="arrivalDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="confirmArrival">确认到账</el-button>
        </template>
      </el-dialog>

      <!-- 改错对话框 -->
      <el-dialog v-model="correctDialogVisible" title="油款改错（留痕）" width="440px">
        <div v-if="correctTarget" class="dialog-form">
          <label>改错字段
            <el-select v-model="correctForm.field">
              <el-option v-for="(label, key) in FIELD_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
          </label>
          <label>新值
            <el-select v-if="correctForm.field === 'fuelType'" v-model="correctForm.value" style="width: 100%">
              <el-option v-for="f in FUEL_CATALOG" :key="f.type" :label="f.type" :value="f.type" />
            </el-select>
            <el-select v-else-if="correctForm.field === 'payMethod'" v-model="correctForm.value" style="width: 100%">
              <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m" />
            </el-select>
            <el-input-number v-else-if="NUMERIC_FIELDS.includes(correctForm.field)"
              v-model="(correctForm.value as number)" :min="0" :precision="2" style="width: 100%" />
            <input v-else v-model="(correctForm.value as string)" />
          </label>
          <p class="old-value">
            旧值（{{ FIELD_LABELS[correctForm.field] }}）：
            <b>{{ NUMERIC_FIELDS.includes(correctForm.field)
              ? formatMoney(Number(correctTarget[correctForm.field]))
              : correctTarget[correctForm.field] }}</b>
          </p>
          <label>改错原因（必填）
            <textarea v-model="correctForm.reason" rows="3" placeholder="说明为什么改错，例如车主要求换卡支付、升数录入多一位" />
          </label>
          <label>操作人<input v-model="correctForm.operator" /></label>
        </div>
        <template #footer>
          <el-button @click="correctDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitCorrect">提交改错</el-button>
        </template>
      </el-dialog>

      <!-- 到账/改错记录对话框 -->
      <el-dialog v-model="detailVisible" title="单据到账与改错记录" width="520px">
        <div v-if="detailTarget" class="detail-box">
          <p class="detail-head">
            {{ detailTarget.cardNo }} · {{ detailTarget.fuelType }} ·
            应收 {{ formatMoney(detailTarget.receivable) }} · 已到账 {{ formatMoney(detailTarget.settledAmount) }}
          </p>
          <h4>到账登记（{{ detailTarget.arrivals.length }}）</h4>
          <el-timeline v-if="detailTarget.arrivals.length">
            <el-timeline-item v-for="a in [...detailTarget.arrivals].reverse()" :key="a.id" :timestamp="formatTime(a.arrivedAt)" placement="top">
              {{ formatMoney(a.amount) }} · {{ a.operator }}<template v-if="a.note"> · {{ a.note }}</template>
            </el-timeline-item>
          </el-timeline>
          <p v-else class="empty-inline">尚无到账记录</p>

          <h4>改错留痕（{{ detailTarget.corrections.length }}）</h4>
          <el-timeline v-if="detailTarget.corrections.length">
            <el-timeline-item v-for="c in [...detailTarget.corrections].reverse()" :key="c.id" :timestamp="formatTime(c.at)" placement="top" type="warning">
              <b>{{ FIELD_LABELS[c.field] }}</b>：
              <span class="old-value-inline">{{ NUMERIC_FIELDS.includes(c.field) ? formatMoney(Number(c.oldValue)) : c.oldValue }}</span>
              → <b>{{ NUMERIC_FIELDS.includes(c.field) ? formatMoney(Number(c.newValue)) : c.newValue }}</b>
              <br />原因：{{ c.reason }}（{{ c.operator }}）
            </el-timeline-item>
          </el-timeline>
          <p v-else class="empty-inline">无改错记录</p>
        </div>
      </el-dialog>
    </div>
  </main>
</template>
