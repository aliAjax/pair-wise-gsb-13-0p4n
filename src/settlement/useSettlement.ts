/**
 * Vue 绑定层：把本机保存仓库的变更同步成响应式状态。
 * 页面只通过这里拿数据和提交动作，不直接接触 localStorage。
 */
import { onScopeDispose, shallowRef } from "vue";
import { settlementRepo } from "./storage";
import type { SettlementStore } from "./types";

export function useSettlement() {
  const store = shallowRef<SettlementStore>(settlementRepo.getState());
  const unsubscribe = settlementRepo.subscribe((next) => {
    store.value = next;
  });
  onScopeDispose(unsubscribe);
  return { store, repo: settlementRepo };
}
