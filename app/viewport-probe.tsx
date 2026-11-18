"use client";

import { useEffect, useState } from "react";

/**
 * Test-build only (`?demo&probe`): shows how iOS Safari sizes the screen, so the tab bar position can be
 * fixed from real numbers instead of guesses. Never rendered in production (the caller gates it).
 */
export function ViewportProbe() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;padding-bottom:env(safe-area-inset-bottom);padding-top:env(safe-area-inset-top)";
    const heights = ["100svh", "100lvh", "100dvh"].map(unit => { const d = document.createElement("div"); d.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;height:${unit}`; document.body.appendChild(d); return [unit, d] as const; });
    document.body.appendChild(probe);
    const read = () => {
      const vv = window.visualViewport;
      const bar = document.querySelector(".dash-tab-bar")?.getBoundingClientRect();
      const cs = getComputedStyle(probe);
      setLines([
        `mode ${matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone ? "home-screen app" : "Safari tab"}`,
        `screen ${screen.height}  inner ${innerHeight}  client ${document.documentElement.clientHeight}`,
        `visual ${vv ? Math.round(vv.height) : "-"}  offset ${vv ? Math.round(vv.offsetTop) : "-"}`,
        heights.map(([unit, d]) => `${unit.slice(3)} ${Math.round(d.getBoundingClientRect().height)}`).join("  "),
        `safe top ${cs.paddingTop}  bottom ${cs.paddingBottom}`,
        `app-vh ${getComputedStyle(document.documentElement).getPropertyValue("--app-vh")}  bar ${bar ? `${Math.round(bar.top)}–${Math.round(bar.bottom)}` : "-"}`,
      ]);
    };
    read();
    const timer = setInterval(read, 500);
    return () => { clearInterval(timer); probe.remove(); heights.forEach(([, d]) => d.remove()); };
  }, []);
  return <pre style={{ position: "fixed", top: "calc(env(safe-area-inset-top) + 4px)", left: 8, right: 8, zIndex: 99, margin: 0, padding: "8px 10px", borderRadius: 10, background: "rgba(232,119,74,.92)", color: "#fff", font: "12px/1.45 ui-monospace,Menlo,monospace", pointerEvents: "none", whiteSpace: "pre-wrap" }}>{lines.join("\n")}</pre>;
}
