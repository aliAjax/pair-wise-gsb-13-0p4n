<script setup lang="ts">
// 确认到账弹窗：只有在此确认的金额才计入原班当班收入。
import { reactive, watch } from "vue";
import { PAY_METHODS } from "../store";
import { outstandingAmount } from "../settlement";
import type { FuelRecord } from "../types";

const props = defineProps<{ record: FuelRecord | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "confirm", payload: { id: string; amount: number; method: string; note: string }): void;
}>();

const form = reactive({ amount: 0, method: PAY_METHODS[0] as string, note: "" });

watch(
  () => props.record,
  (record) => {
    if (record) {
      form.amount = outstandingAmount(record);
      form.method = record.payMethod;
      form.note = "";
    }
  }
);

function ok() {
  if (!props.record || !(form.amount > 0)) return;
  emit("confirm", {
    id: props.record.id,
    amount: Number(form.amount),
    method: form.method,
    note: form.note.trim()
  });
}
</script>

<template>
  <div v-if="record" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>确认油款到账</h3>
      <p class="modal-sub">
        {{ record.cardNo }} · {{ record.fuelType }} ｜ 未到账
        ¥{{ outstandingAmount(record).toFixed(2) }}（原班责任人：{{ record.ownerAtCreation }}）
      </p>
      <div class="form-grid">
        <label>
          本次到账金额 ¥
          <input v-model.number="form.amount" type="number" min="0.01" step="0.01" />
        </label>
        <label>
          到账方式
          <select v-model="form.method">
            <option v-for="m in PAY_METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <label>
          到账说明
          <textarea v-model="form.note" placeholder="如：次日银行请款成功 / 现金补缴" />
        </label>
      </div>
      <p class="modal-warn">确认后金额计入原班当班收入；预授权请款成功也必须在此确认。</p>
      <div class="form-actions">
        <button type="button" @click="ok">确认到账</button>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
