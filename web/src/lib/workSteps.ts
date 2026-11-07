export type WorkStepLevel =
  | "minimal"
  | "concise"
  | "standard"
  | "detailed"
  | "expanded";

/** WorkSteps 组件接的非极简档位：极简不渲染工作步骤容器，只内联思考摘要。 */
export type WorkStepsLevel = Exclude<WorkStepLevel, "minimal">;

interface WorkStepLevelOption {
  value: WorkStepLevel;
  label: string;
  hint: string;
}

/** 顶栏设置里的五档：比 DSH 多一档「极简」，只留思考、不露工具调用。 */
export const WORK_STEP_LEVELS: readonly WorkStepLevelOption[] = [
  { value: "minimal", label: "极简", hint: "只看简要思考，不显示工具调用" },
  { value: "concise", label: "简洁", hint: "工具调用单行显示，点开看参数与结果" },
  { value: "standard", label: "标准", hint: "工具行额外带一行结果摘要" },
  { value: "detailed", label: "详细", hint: "参数与结果默认展开，步骤仍会收起" },
  { value: "expanded", label: "完全展开", hint: "工作步骤常驻展开，全部内容可见" },
];

export const DEFAULT_WORK_STEP_LEVEL: WorkStepLevel = "concise";

const STORAGE_KEY = "siria:work-steps:v1";

function isWorkStepLevel(value: unknown): value is WorkStepLevel {
  return WORK_STEP_LEVELS.some((option) => option.value === value);
}

export function readWorkStepLevel(): WorkStepLevel {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isWorkStepLevel(raw) ? raw : DEFAULT_WORK_STEP_LEVEL;
  } catch {
    return DEFAULT_WORK_STEP_LEVEL;
  }
}

export function writeWorkStepLevel(level: WorkStepLevel): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, level);
  } catch {
    // 隐私模式或配额不足时静默降级，只影响本次会话的显示偏好。
  }
}
