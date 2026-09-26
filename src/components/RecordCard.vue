<script setup lang="ts">
// 单笔油款单据卡：展示卡号/油品/应收/预授权/支付方式与结算状态、缺额说明、留痕。
import { computed } from "vue";
import {
  outstandingAmount,
  preAuthCovers,
  receivedAmount,
  settlementStatus,
  shortfallText
} from "../settlement";
import type { FuelRecord, Shift } from "../types";
import { fmtDateTime } from "../utils";

const props = defineProps<{
  record: FuelRecord;
  shift?: Shift;
}>();

const emit = defineEmits<{
  (e: "confirm", id: string): void;
  (e: "correct", id: string): void;
}>();

const status = computed(() => settlementStatus(props.record));
const got = computed(() => receivedAmount(props.record));
const gap = computed(() => outstandingAmount(props.record));
const short = computed(() => shortfallText(props.record));
const covered = computed(() => preAuthCovers(props.record));
</script>

<template>
  <article class="record" :class="`is-${status}`">
    <div class="record-head">
      <p class="record-title">{{ record.cardNo }} · {{ record.fuelType }}</p>
      <span class="status" :class="`st-${status}`">{{ status }}</span>
    </div>

    <div class="details">
      <span>加油升数：<b>{{ record.liters }} L</b></span>
      <span>支付方式：<b>{{ record.payMethod }}</b></span>
      <span>应收：<b>¥{{ record.receivable.toFixed(2) }}</b></span>
      <span>
        预授权：<b>¥{{ record.preAuth.toFixed(2) }}</b>
        <em v-if="record.preAuth > 0" :class="covered ? 'ok' : 'warn'">
          {{ covered ? "可覆盖应收" : "不足覆盖" }}
        </em>
      </span>
      <span>已到账：<b class="ok">¥{{ got.toFixed(2) }}</b></span>
      <span>未到账：<b :class="gap > 0 ? 'warn' : 'ok'">¥{{ gap.toFixed(2) }}</b></span>
      <span>原班：<b>{{ shift ? `${shift.date} ${shift.code}（${shift.owner}）` : record.shiftId }}</b></span>
      <span>建档时间：{{ fmtDateTime(record.createdAt) }}</span>
    </div>

    <p v-if="short" class="note shortfall">缺额说明：{{ short }}</p>

    <div v-if="record.receipts.length" class="receipts">
      <p class="sub-title">到账确认（计入原班收入）</p>
      <ul>
        <li v-for="r in record.receipts" :key="r.id">
          <span>¥{{ r.amount.toFixed(2) }} / {{ r.method }}</span>
          <span>{{ fmtDateTime(r.receivedAt) }} · {{ r.operator }}</span>
          <span v-if="r.note" class="receipt-note">{{ r.note }}</span>
        </li>
      </ul>
    </div>

    <details v-if="record.corrections.length" class="corrections">
      <summary>改错/更新留痕（{{ record.corrections.length }}）</summary>
      <ul>
        <li v-for="c in record.corrections" :key="c.id">
          <p>
            <b>{{ c.source }}</b> · {{ fmtDateTime(c.at) }} · {{ c.operator }}
          </p>
          <p class="reason">原因：{{ c.reason }}</p>
          <ul class="changes">
            <li v-for="ch in c.changes" :key="ch.field">
              {{ ch.fieldLabel }}：<del>{{ ch.oldValue === "" ? "（空）" : ch.oldValue }}</del>
              → <b>{{ ch.newValue === "" ? "（空）" : ch.newValue }}</b>
            </li>
          </ul>
        </li>
      </ul>
    </details>

    <div class="actions">
      <button v-if="gap > 0" type="button" @click="emit('confirm', record.id)">确认到账</button>
      <button type="button" class="secondary" @click="emit('correct', record.id)">改错</button>
    </div>
  </article>
</template>
