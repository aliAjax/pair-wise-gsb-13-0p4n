<script setup lang="ts">
// 改错弹窗：必须填写原因，提交前预览每个字段的旧值→新值。
import { computed, reactive, watch } from "vue";
import { diffFields, FIELD_LABELS, FUEL_TYPES, PAY_METHODS } from "../store";
import type { FuelRecord } from "../types";

const props = defineProps<{ record: FuelRecord | null }>();
const emit = defineEmits<{
  (e: "close"): void;
  (e: "apply", payload: { id: string; reason: string; patch: Record<string, string | number> }): void;
}>();

const form = reactive({
  fuelType: "",
  liters: 0,
  receivable: 0,
  preAuth: 0,
  payMethod: "",
  shortfallNote: "",
  reason: ""
});

watch(
  () => props.record,
  (record) => {
    if (record) {
      form.fuelType = record.fuelType;
      form.liters = record.liters;
      form.receivable = record.receivable;
      form.preAuth = record.preAuth;
      form.payMethod = record.payMethod;
      form.shortfallNote = record.shortfallNote;
      form.reason = "";
    }
  }
);

const preview = computed(() => {
  if (!props.record) return [];
  return diffFields(props.record, {
    fuelType: form.fuelType as FuelRecord["fuelType"],
    liters: Number(form.liters),
    receivable: Number(form.receivable),
    preAuth: Number(form.preAuth),
    payMethod: form.payMethod as FuelRecord["payMethod"],
    shortfallNote: form.shortfallNote
  });
});

function apply() {
  if (!props.record || !form.reason.trim() || preview.value.length === 0) return;
  const patch: Record<string, string | number> = {};
  for (const change of preview.value) patch[change.field] = change.newValue;
  emit("apply", { id: props.record.id, reason: form.reason.trim(), patch });
}
</script>

<template>
  <div v-if="record" class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>油款单据改错</h3>
      <p class="modal-sub">{{ record.cardNo }} · {{ record.fuelType }}（卡号不可改，换卡请另开新单）</p>
      <div class="form-grid">
        <label>
          {{ FIELD_LABELS.fuelType }}
          <select v-model="form.fuelType">
            <option v-for="item in FUEL_TYPES" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <div class="two-col">
          <label>
            {{ FIELD_LABELS.liters }} L
            <input v-model.number="form.liters" type="number" step="0.01" />
          </label>
          <label>
            {{ FIELD_LABELS.receivable }} ¥
            <input v-model.number="form.receivable" type="number" step="0.01" />
          </label>
        </div>
        <div class="two-col">
          <label>
            {{ FIELD_LABELS.preAuth }} ¥
            <input v-model.number="form.preAuth" type="number" step="0.01" />
          </label>
          <label>
            {{ FIELD_LABELS.payMethod }}
            <select v-model="form.payMethod">
              <option v-for="item in PAY_METHODS" :key="item" :value="item">{{ item }}</option>
            </select>
          </label>
        </div>
        <label>
          {{ FIELD_LABELS.shortfallNote }}
          <textarea v-model="form.shortfallNote" />
        </label>
        <label class="reason-field">
          改错原因（必填，将随旧值一并留痕）
          <textarea v-model="form.reason" placeholder="如：油枪读数录错，实际升数以泵码单为准" />
        </label>

        <div v-if="preview.length" class="diff-preview">
          <p class="sub-title">变更预览（旧值 → 新值）</p>
          <ul>
            <li v-for="ch in preview" :key="ch.field">
              {{ ch.fieldLabel }}：<del>{{ ch.oldValue === "" ? "（空）" : ch.oldValue }}</del>
              → <b>{{ ch.newValue === "" ? "（空）" : ch.newValue }}</b>
            </li>
          </ul>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" :disabled="!form.reason.trim() || preview.length === 0" @click="apply">
          确认改错并留痕
        </button>
        <button type="button" class="secondary" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>
