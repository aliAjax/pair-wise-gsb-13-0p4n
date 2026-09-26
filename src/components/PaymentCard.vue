<script setup lang="ts">
/**
 * 单笔油款卡片：卡号、油品、应收、预授权、支付方式、缺额说明与操作入口。
 * 数据和判断都来自 settlement 层，本组件只负责呈现与派发事件。
 */
import { computed } from "vue";
import type { FuelPayment, Shift } from "../settlement/types";
import { shortfall, shortfallReason } from "../settlement/settlement";
import { formatMoney, formatTime } from "../settlement/format";

const props = defineProps<{
  payment: FuelPayment;
  /** 单据所属班次（用于展示“原班责任人”） */
  ownerShift?: Shift;
  /** 是否为其他班次移交过来的未结款 */
  carried?: boolean;
}>();

const emit = defineEmits<{
  (e: "arrive", payment: FuelPayment): void;
  (e: "correct", payment: FuelPayment): void;
  (e: "detail", payment: FuelPayment): void;
}>();

const gap = computed(() => shortfall(props.payment));
const reason = computed(() => shortfallReason(props.payment));

const statusClass = computed(() => {
  switch (props.payment.status) {
    case "已到账":
      return "ok";
    case "部分到账":
      return "warn";
    default:
      return "due";
  }
});
</script>

<template>
  <article class="pay-card" :class="{ carried }">
    <div class="pay-head">
      <div>
        <p class="pay-title">
          <span class="card-no">{{ payment.cardNo }}</span>
          <span class="fuel-type">{{ payment.fuelType }}</span>
          <span v-if="payment.liters" class="liters">{{ payment.liters }}L</span>
        </p>
        <p class="pay-meta">
          <el-tag size="small" effect="plain">{{ payment.payMethod }}</el-tag>
          <span>加油员：{{ payment.cashier }}</span>
          <span>{{ formatTime(payment.createdAt) }}</span>
        </p>
      </div>
      <span class="pay-status" :class="statusClass">{{ payment.status }}</span>
    </div>

    <div class="pay-grid">
      <div><span>应收</span><strong>{{ formatMoney(payment.receivable) }}</strong></div>
      <div><span>预授权</span><strong :class="{ muted: payment.preauth === 0 }">{{ formatMoney(payment.preauth) }}</strong></div>
      <div><span>已到账</span><strong class="income">{{ formatMoney(payment.settledAmount) }}</strong></div>
      <div><span>缺额</span><strong class="due-text">{{ formatMoney(gap) }}</strong></div>
    </div>

    <p class="shortfall"><i></i>{{ reason }}</p>
    <p v-if="carried && ownerShift" class="carry-note">
      移交款 · 归属{{ ownerShift.date }} {{ ownerShift.kind }}（原班责任人：{{ ownerShift.owner }}），
      到账后计入该班收入，不计本班
    </p>
    <p v-else-if="ownerShift" class="carry-note self">本班单据 · 责任人：{{ ownerShift.owner }}</p>

    <div class="pay-actions">
      <el-button v-if="gap > 0" type="primary" size="small" @click="emit('arrive', payment)">确认到账</el-button>
      <el-button size="small" @click="emit('correct', payment)">改错</el-button>
      <el-button size="small" text @click="emit('detail', payment)">
        到账/改错记录（{{ payment.arrivals.length + payment.corrections.length }}）
      </el-button>
    </div>
  </article>
</template>
