"use client";

import { useEffect, useRef } from "react";

/** The animated Eris from Eris Bot (public/mascot.js): layered rig with blinking, head turns and hair on springs. */
export type MascotState = "idle" | "think" | "focus" | "happy" | "cheer" | "surprise" | "worry" | "sleep";
type MascotApi = { setState: (state: MascotState) => void; gaze: (x: number, y: number, ms?: number) => void; poke: (kind: string) => void };
type MascotGlobal = { mount: (box: HTMLElement, options: { size: number; label: string }) => MascotApi };

let loading: Promise<MascotGlobal> | null = null;
function loadMascot(): Promise<MascotGlobal> {
  const existing = (window as unknown as { Mascot?: MascotGlobal }).Mascot;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/mascot.js";
    script.async = true;
    script.onload = () => { const mascot = (window as unknown as { Mascot?: MascotGlobal }).Mascot; if (mascot) resolve(mascot); else reject(new Error("mascot_missing")); };
    script.onerror = () => { loading = null; reject(new Error("mascot_load_failed")); };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * `pokeKey` changes → a one-off reaction (`poke`), e.g. a nod when a reply arrives.
 * Until the engine has loaded (or if WebGL is unavailable and it fails), the still picture shows through.
 */
export function ErisMascot({ size, state = "idle", poke, pokeKey = 0, label = "Eris" }: { size: number; state?: MascotState; poke?: string; pokeKey?: number; label?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<MascotApi | null>(null);
  const latestState = useRef(state);
  useEffect(() => { latestState.current = state; api.current?.setState(state); }, [state]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let alive = true;
    loadMascot().then(mascot => {
      if (!alive) return;
      element.replaceChildren();
      api.current = mascot.mount(element, { size, label });
      api.current.setState(latestState.current);
    }).catch(() => { /* keep the still picture */ });
    return () => { alive = false; api.current = null; element.replaceChildren(); };
  }, [size, label]);

  useEffect(() => { if (pokeKey && poke) api.current?.poke(poke); }, [poke, pokeKey]);

  return <div className="eris-mascot" style={{ width: size, height: size }}><div ref={box} className="eris-mascot-stage" /></div>;
}
