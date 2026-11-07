import { useEffect, useRef, useState } from "react";

import { WORK_STEP_LEVELS, type WorkStepLevel } from "../lib/workSteps";

interface Props {
  level: WorkStepLevel;
  onChange: (level: WorkStepLevel) => void;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.4l2.7 2.7 6.3-6.2" />
    </svg>
  );
}

export function SettingsMenu({ level, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  // 打开后把焦点交给当前档位，键盘用户可以直接上下切换。
  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>(".settings-option.active")?.focus();
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(".settings-option"),
    );
    if (items.length === 0) return;
    const index = items.findIndex((item) => item === document.activeElement);
    let next = 0;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === "ArrowUp") {
      next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    } else if (event.key === "Home") next = 0;
    else next = items.length - 1;
    items[next].focus();
  };

  const choose = (next: WorkStepLevel) => {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={open ? "settings-btn active" : "settings-btn"}
        aria-label="界面设置"
        aria-haspopup="menu"
        aria-expanded={open}
        title="界面设置"
        onClick={() => setOpen((value) => !value)}
      >
        <GearIcon />
      </button>
      {open && (
        <div
          className="settings-menu"
          role="menu"
          aria-label="界面设置"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="settings-head">
            <span className="settings-title">工作步骤展示</span>
            <span className="settings-desc">选择希望看到多少工具调用细节</span>
          </div>
          <div className="settings-options">
            {WORK_STEP_LEVELS.map((option) => {
              const active = option.value === level;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={active ? "settings-option active" : "settings-option"}
                  onClick={() => choose(option.value)}
                >
                  <span className="settings-option-text">
                    <span className="settings-option-label">{option.label}</span>
                    <span className="settings-option-hint">{option.hint}</span>
                  </span>
                  {active && (
                    <span className="settings-check">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
