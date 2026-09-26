<script setup lang="ts">
// 交接班弹窗：未结款只随原班责任人移交，不挪单、不冲销。
import { computed, reactive } from "vue";
import { SHIFT_CODES } from "../store";
import { outstandingAmount, receivedAmount } from "../settlement";
import type { FuelRecord, Shift } from "../types";

const props = defineProps<{
  open: boolean;
  currentShift: Shift;
  records: FuelRecord[];
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "handover", payload: { nextCode: Shift["code"]; nextOwner: string }): void;
}>();

const form = reactive({ nextCode: SHIFT_CODES[0] as Shift["code"], nextOwner: "" });

const carry = computed(() => props.records.filter((r) => r.shiftId === props.currentShift.id && outstandingAmount(r) > 0));
const carryTotal = computed(() => carry.value.reduce((s, r) => s + outstandingAmount(r), 0));
const income = computed(() =>
  props.records.filter((r) => r.shiftId === props.currentShift.id).reduce((s, r) => s + receivedAmount(r), 0)
);

function ok() {
  if (!form.nextOwner.trim()) return;
  emit("handover", { nextCode: form.nextCode, nextOwner: form.nextOwner.trim() });
}
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>交接班</h3>
      <p class="modal-sub">
        当前：{{ currentShift.date }} {{ currentShift.code }}，责任人 {{ currentShift.owner }}
      </p>

      <div class="handover-summary">
        <div><span>本班已确认收入</span><b class="ok">¥{{ income.toFixed(2) }}</b></div>
        <div><span>未结款（随原班责任人移交）</span><b class="warn">¥{{ carryTotal.toFixed(2) }}</b></div>
        <div><span>未结单据数</span><b>{{ carry.length }} 笔</b></div>
      </div>

      <ul v-if="carry.length" class="carry-list">
        <li v-for="r in carry" :key="r.id">
          {{ r.cardNo }} · {{ r.fuelType }}：应收 ¥{{ r.receivable.toFixed(2) }}，
          缺额 ¥{{ outstandingAmount(r).toFixed(2) }}，责任人 {{ r.ownerAtCreation }}
        </li>
      </ul>

      <div class="form-grid">
        <label>
          下一班次
          <select v-model="form.nextCode">
            <option v-for="code in SHIFT_CODES" :key="code" :value="code">{{ code }}</option>
          </select>
        </label>
        <label>
          接班责任人
          <input v-model="form.nextOwner" placeholder="填写班长/加油员姓名" />
        </label>
      </div>
      <p class="modal-warn">交班后未结单据仍归本班，次日到账由接班人代收确认，但收入计入原班。</p>
      <div class="form-actions">
        <button type="button" :disabled="!form.nextOwner.trim()" @click="ok">确认交班</button>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
