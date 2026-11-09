export interface ChatSelection {
  model: string;
  reasoningEffort: string;
}

export const DEFAULT_CHAT_SELECTION: ChatSelection = {
  model: "deepseek-flash",
  reasoningEffort: "high",
};

const STORAGE_KEY = "siria:chat-selection:v1";

export function readChatSelection(): ChatSelection {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_SELECTION;
    const parsed = JSON.parse(raw) as Partial<ChatSelection>;
    if (
      typeof parsed.model !== "string" ||
      typeof parsed.reasoningEffort !== "string"
    ) {
      return DEFAULT_CHAT_SELECTION;
    }
    return { model: parsed.model, reasoningEffort: parsed.reasoningEffort };
  } catch {
    return DEFAULT_CHAT_SELECTION;
  }
}

export function writeChatSelection(selection: ChatSelection): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // 隐私模式或配额不足时静默降级，只影响本次会话的显示偏好。
  }
}
