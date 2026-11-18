"use client";

import Link from "next/link";
import "./tab-bar.css";

/** Phone bottom bar shared by the Eris chat page and the dashboard, so they feel like one app. */
export type TabId = "chat" | "daily" | "overview" | "trends" | "settings";

const TABS: { id: TabId; label: string; href: string }[] = [
  { id: "chat", label: "對話", href: "/chat" },
  { id: "daily", label: "每日", href: "/?view=daily" },
  { id: "overview", label: "總覽", href: "/?view=overview" },
  { id: "trends", label: "趨勢", href: "/?view=trends" },
  { id: "settings", label: "設定", href: "/?view=settings" },
];

function TabIcon({ id }: { id: TabId }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "chat") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M12 4.5c4.7 0 8 3 8 6.8s-3.3 6.8-8 6.8c-.9 0-1.8-.1-2.6-.3L5 19.5l1.1-3.6C4.8 14.7 4 13.1 4 11.3 4 7.5 7.3 4.5 12 4.5z" /></svg>;
  if (id === "daily") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.3 2.3 4.8-4.9" /></svg>;
  if (id === "overview") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><rect x="4.5" y="4.5" width="6" height="6" rx="1.6" /><rect x="13.5" y="4.5" width="6" height="6" rx="1.6" /><rect x="4.5" y="13.5" width="6" height="6" rx="1.6" /><rect x="13.5" y="13.5" width="6" height="6" rx="1.6" /></svg>;
  if (id === "trends") return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="m4 17 5-5 3 3 7-8" /><path d="M15 7h4v4" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 8h16M4 16h16" /><circle cx="15" cy="8" r="2.2" fill="var(--tab-bg)" /><circle cx="9" cy="16" r="2.2" fill="var(--tab-bg)" /></svg>;
}

/**
 * `onSelect` lets the dashboard switch views in place; without it (chat page) every tab is a link.
 * The chat tab is always a link because chat is its own page.
 */
export function TabBar({ active, badge = 0, onSelect, className = "" }: { active: TabId | null; badge?: number; onSelect?: (id: Exclude<TabId, "chat">) => void; className?: string }) {
  const index = active ? TABS.findIndex(tab => tab.id === active) : -1;
  return (
    <nav className={`tab-bar ${className}`} aria-label="主要功能" style={{ "--tab-index": Math.max(index, 0), "--tab-count": TABS.length } as React.CSSProperties}>
      {index >= 0 && <span className="tab-indicator" aria-hidden="true" />}
      {TABS.map(tab => {
        const props = { className: `tab${tab.id === active ? " active" : ""}`, "aria-current": tab.id === active ? "page" as const : undefined };
        const content = <>
          <span className="tab-icon">
            <TabIcon id={tab.id} />
            {tab.id === "chat" && badge > 0 && <b key={badge} className="tab-badge" aria-label={`正在記錄 ${badge} 則`}>{badge > 9 ? "9+" : badge}</b>}
          </span>
          <span className="tab-label">{tab.label}</span>
        </>;
        if (tab.id === "chat") return <Link key={tab.id} href={tab.href} prefetch {...props}>{content}</Link>;
        // Dashboard views switch in place; from the chat page they load the dashboard fresh so it opens on that view.
        return <a key={tab.id} href={tab.href} {...props} onClick={event => {
          if (!onSelect) return;
          event.preventDefault();
          onSelect(tab.id as Exclude<TabId, "chat">);
        }}>{content}</a>;
      })}
    </nav>
  );
}
