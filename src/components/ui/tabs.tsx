'use client';

import type { KeyboardEvent } from 'react';

export function TabBar({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<{ value: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key) || !tabs.length) return;
    const selected = Math.max(
      0,
      tabs.findIndex((tab) => tab.value === value),
    );
    let nextIndex = selected;
    if (event.key === 'ArrowRight') nextIndex = (selected + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (selected + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    event.preventDefault();
    onChange(tabs[nextIndex].value);
    const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    controls[nextIndex]?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="ui-tabs" onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          type="button"
          role="tab"
          key={tab.value}
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          className={`ui-tab ${value === tab.value ? 'ui-tab--active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
