<script setup lang="ts">
// 油款资料录入表单：卡号 / 油品 / 应收 / 预授权 / 支付方式。
// 同一张卡再次提交时回填原单（由 App 传入 card 数据），提交后仍只更新原单。
import { reactive, watch } from "vue";
import { FUEL_TYPES, PAY_METHODS, type RecordInput } from "../store";

const props = defineProps<{
  presetCard?: {
    cardNo: string;
    fuelType: RecordInput["fuelType"];
    liters: number;
    receivable: number;
    preAuth: number;
    payMethod: RecordInput["payMethod"];
    shortfallNote: string;
  } | null;
}>();

const emit = defineEmits<{
  (e: "submit", input: RecordInput): void;
  (e: "cancel-preset"): void;
}>();

function blank() {
  return {
    cardNo: "",
    fuelType: FUEL_TYPES[0] as RecordInput["fuelType"],
    liters: 0,
    receivable: 0,
    preAuth: 0,
    payMethod: PAY_METHODS[0] as RecordInput["payMethod"],
    shortfallNote: ""
  };
}

const form = reactive(blank());

watch(
  () => props.presetCard,
  (preset) => {
    if (preset) Object.assign(form, preset);
  }
);

function submit() {
  if (!form.cardNo.trim()) return;
  emit("submit", { ...form, cardNo: form.cardNo.trim() });
  if (!props.presetCard) Object.assign(form, blank());
}

defineExpose({
  reset() {
    Object.assign(form, blank());
  }
});
</script>

<template>
  <form class="panel" @submit.prevent="submit">
    <h2>油款资料录入</h2>
    <p class="panel-tip">同一卡号再次提交只更新原单，不产生新单据。</p>
    <div class="form-grid">
      <label>
        油卡/会员卡号
        <input v-model="form.cardNo" required placeholder="如 YK10086021" />
      </label>
      <label>
        油品
        <select v-model="form.fuelType">
          <option v-for="item in FUEL_TYPES" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <div class="two-col">
        <label>
          加油升数 L
          <input v-model.number="form.liters" type="number" min="0" step="0.01" required />
        </label>
        <label>
          应收金额 ¥
          <input v-model.number="form.receivable" type="number" min="0" step="0.01" required />
        </label>
      </div>
      <div class="two-col">
        <label>
          预授权 ¥
          <input v-model.number="form.preAuth" type="number" min="0" step="0.01" />
        </label>
        <label>
          支付方式
          <select v-model="form.payMethod">
            <option v-for="item in PAY_METHODS" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
      </div>
      <label>
        缺额/挂账说明
        <textarea
          v-model="form.shortfallNote"
          placeholder="未到账原因，如：银行通道超时待次日请款"
        />
      </label>
      <div class="form-actions">
        <button type="submit">提交油款资料</button>
        <button v-if="presetCard" type="button" class="secondary" @click="emit('cancel-preset')">
          取消更新，录新单
        </button>
      </div>
    </div>
  </form>
</template>
