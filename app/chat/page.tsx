"use client";
/* eslint-disable @next/next/no-img-element -- avatars and in-memory data: URLs; next/image adds nothing here */

import { onAuthStateChanged, signInWithPopup, signInWithRedirect, type User } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { auth, db, googleProvider } from "../../lib/firebase";
import { fitPhotos, newMessageId, outbox, preparePhoto, type OutboxItem } from "../../lib/chat-client";
import { TabBar } from "../tab-bar";

type ServerStatus = "sending" | "retry" | "processing" | "done" | "failed";
type ChatDoc = { id: string; text: string; thumbs: string[]; photoCount: number; status: ServerStatus; reply: string | null; createdAt: number };
type Row = { id: string; text: string; thumbs: string[]; createdAt: number; local?: OutboxItem; doc?: ChatDoc };
type DraftPhoto = { key: string; photo: string; thumb: string };

const MAX_PHOTOS = 10;
const SUGGESTIONS = ["早餐吃了一個鮪魚飯糰和無糖豆漿", "剛喝了 500ml 的水", "今天早上體重 52.3"];

function greeting(hour = new Date().getHours()) {
  if (hour < 5) return "還沒睡呀";
  if (hour < 11) return "早安";
  if (hour < 14) return "午安";
  if (hour < 18) return "下午好";
  return "晚安";
}

function dayLabel(ms: number) {
  const day = new Date(ms); const today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`;
}
const clock = (ms: number) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });

async function idToken(user: User) { return user.getIdToken(); }

/* Dev-only demo (`/chat?demo`): lets the layout be checked without signing in. Stripped from production builds. */
const noopSubscribe = () => () => {};
const DEMO_ALLOWED = process.env.NODE_ENV !== "production";
const readDemoFlag = () => DEMO_ALLOWED && new URLSearchParams(window.location.search).has("demo");
const DEMO_USER = { uid: "demo", email: "demo@example.com" } as unknown as User;
const demoDocs = (now = Date.now()): ChatDoc[] => [
  { id: "d1", text: "早餐", thumbs: ["/eris-180.png", "/eris-180.png"], photoCount: 2, status: "done", createdAt: now - 26 * 3_600_000,
    reply: "記好了：鮪魚飯糰 1 個（約 210 大卡）、無糖豆漿 400ml（142 大卡）。\n今天累計 352 大卡、蛋白質 22g。" },
  { id: "d2", text: "剛喝了 500ml 的水", thumbs: [], photoCount: 0, status: "done", createdAt: now - 3_600_000, reply: "水 500ml 記好了，今天喝了 1,300ml，再喝 700ml 就達標。" },
  { id: "d3", text: "", thumbs: ["/eris-180.png", "/eris-180.png", "/eris-180.png", "/eris-180.png", "/eris-180.png"], photoCount: 5, status: "processing", createdAt: now - 20_000, reply: null },
];

export default function ChatPage() {
  // Coming from the dashboard the session is already restored, so open straight into the chat.
  const [user, setUser] = useState<User | null>(() => auth?.currentUser ?? null);
  const [authReady, setAuthReady] = useState(() => !auth || Boolean(auth.currentUser));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<ChatDoc[]>([]);
  const [pending, setPending] = useState<OutboxItem[]>([]);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [toast, setToast] = useState<{ key: number; text: string; tone: "ok" | "warn" } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  /** On phones the keyboard is up while the message box has focus; the tabs step aside. */
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(new Set<string>());
  const stickToBottom = useRef(true);
  /** Only messages that arrive while the page is open get an entrance animation. */
  const [openedAt] = useState(() => Date.now() - 1500);
  const demo = useSyncExternalStore(noopSubscribe, readDemoFlag, () => false);
  const [demoRows, setDemoRows] = useState<ChatDoc[]>(() => DEMO_ALLOWED ? demoDocs() : []);

  const say = useCallback((message: string, tone: "ok" | "warn" = "ok") => setToast({ key: Date.now(), text: message, tone }), []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 3200); return () => clearTimeout(timer); }, [toast]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, current => { setUser(current); setAuthReady(true); });
  }, []);

  // Keep the app inside the part of the screen the iOS keyboard leaves visible. Safari both shrinks
  // and scrolls the visual viewport, so follow its height and its offset; hide the tabs while typing.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--chat-vh", `${viewport.height}px`);
      root.style.setProperty("--chat-vt", `${viewport.offsetTop}px`);
    };
    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    return () => { viewport.removeEventListener("resize", apply); viewport.removeEventListener("scroll", apply); };
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const messages = query(collection(db, `users/${user.uid}/chatMessages`), orderBy("createdAt", "desc"), limit(60));
    return onSnapshot(messages, snapshot => {
      setDocs(snapshot.docs.map(doc => {
        const data = doc.data();
        const created = (data.createdAt as Timestamp | null)?.toMillis?.() ?? Date.now();
        return { id: doc.id, text: data.text ?? "", thumbs: data.thumbs ?? [], photoCount: data.photoCount ?? 0, status: data.status ?? "processing", reply: data.reply ?? null, createdAt: created };
      }).reverse());
    }, () => say("讀不到對話紀錄，請重新整理", "warn"));
  }, [user, say]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch("/api/chat", { headers: { Authorization: `Bearer ${await idToken(user)}` }, cache: "no-store" });
      if (response.ok) setEnabled(Boolean((await response.json()).enabled));
    } catch { /* offline: try again on next focus */ }
  }, [user]);

  const send = useCallback(async (item: OutboxItem) => {
    if (DEMO_ALLOWED && demo) {
      setTimeout(() => {
        setPending(list => list.filter(entry => entry.id !== item.id));
        setDemoRows(list => [...list, { id: item.id, text: item.text, thumbs: item.thumbs, photoCount: item.thumbs.length, status: "processing", reply: null, createdAt: item.createdAt }]);
        say("已送出，可以關掉 App 了");
      }, 900);
      setTimeout(() => setDemoRows(list => list.map(entry => entry.id === item.id ? { ...entry, status: "done", reply: "（示範）記好了，今天累計 1,020 大卡。" } : entry)), 4200);
      return;
    }
    if (!user || inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    setPending(list => list.map(entry => entry.id === item.id ? { ...entry, failed: false } : entry));
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${await idToken(user)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, text: item.text, photos: item.photos, thumbs: item.thumbs }),
      });
      if (response.ok) {
        await outbox.remove(item.id);
        setPending(list => list.filter(entry => entry.id !== item.id));
        say("已送出，可以關掉 App 了");
        return;
      }
      if (response.status === 400 || response.status === 403) {
        await outbox.remove(item.id);
        setPending(list => list.filter(entry => entry.id !== item.id));
        if (response.status === 403) { say("這個帳號還沒開通聊天", "warn"); return; }
        // Never lose what she typed or picked: put it back in the composer.
        const reasons = ((await response.json().catch(() => ({}))) as { reasons?: string[] }).reasons ?? [];
        setText(current => current || item.text);
        setPhotos(current => current.length ? current : item.photos.map((photo, index) => ({ key: newMessageId(), photo, thumb: item.thumbs[index] ?? photo })));
        say(reasons.some(reason => /photo|thumb/.test(reason)) ? "照片太大沒送出，已放回輸入框，少選幾張再送" : "沒送出，內容已放回輸入框，再按一次送出", "warn");
        return;
      }
      throw new Error(String(response.status));
    } catch {
      const failed = { ...item, failed: true };
      await outbox.put(failed);
      setPending(list => list.map(entry => entry.id === item.id ? failed : entry));
    } finally {
      inFlight.current.delete(item.id);
    }
  }, [user, say, demo]);

  const flush = useCallback(async () => {
    const items = await outbox.all();
    setPending(list => {
      const known = new Set(list.map(entry => entry.id));
      return [...list, ...items.filter(entry => !known.has(entry.id))];
    });
    for (const item of items) await send(item);
  }, [send]);

  useEffect(() => {
    if (!user) return;
    const wake = () => { if (document.visibilityState === "visible") { void refresh(); void flush(); } };
    void Promise.resolve().then(wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [user, refresh, flush]);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map<string, Row>();
    for (const doc of demo ? demoRows : docs) byId.set(doc.id, { id: doc.id, text: doc.text, thumbs: doc.thumbs, createdAt: doc.createdAt, doc });
    for (const item of pending) if (!byId.has(item.id)) byId.set(item.id, { id: item.id, text: item.text, thumbs: item.thumbs, createdAt: item.createdAt, local: item });
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [docs, pending, demo, demoRows]);

  const working = rows.filter(row => row.doc?.status === "processing").length;

  const scrolledOnce = useRef(false);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !rows.length || !stickToBottom.current) return;
    // Jump straight to the newest message on open; glide only for messages that arrive later.
    list.scrollTo({ top: list.scrollHeight, behavior: scrolledOnce.current ? "smooth" : "auto" });
    scrolledOnce.current = true;
  }, [rows]);

  const onScroll = () => {
    const list = listRef.current;
    if (list) stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  };

  const autoGrow = () => {
    const area = textRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 132)}px`;
  };
  useEffect(autoGrow, [text]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PHOTOS - photos.length;
    const picked = Array.from(files).filter(file => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name)).slice(0, Math.max(room, 0));
    if (files.length > room) say(`一次最多 ${MAX_PHOTOS} 張，先放進前 ${Math.max(room, 0)} 張`, "warn");
    setPreparing(count => count + picked.length);
    for (const file of picked) {
      try {
        const prepared = await preparePhoto(file);
        setPhotos(list => list.length >= MAX_PHOTOS ? list : [...list, { key: newMessageId(), ...prepared }]);
      } catch {
        say("有一張照片讀不出來，換一張試試", "warn");
      } finally {
        setPreparing(count => count - 1);
      }
    }
  };

  const submit = async () => {
    const body = text.trim();
    if ((!body && !photos.length) || preparing) return;
    let ready: string[];
    try { ready = await fitPhotos(photos.map(photo => photo.photo)); } catch { say("照片太大了，少選幾張再送", "warn"); return; }
    const item: OutboxItem = { id: newMessageId(), text: body, photos: ready, thumbs: photos.map(photo => photo.thumb), createdAt: Date.now() };
    await outbox.put(item);
    stickToBottom.current = true;
    setPending(list => [...list, item]);
    setText(""); setPhotos([]);
    if (navigator.vibrate) navigator.vibrate(8);
    void send(item);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); }
  };

  const signIn = async () => {
    if (!auth) return;
    try { await signInWithPopup(auth, googleProvider); }
    catch { await signInWithRedirect(auth, googleProvider); }
  };

  const me = demo ? DEMO_USER : user;
  if (!demo && !authReady) return <main className="chat-app chat-center"><span className="chat-spinner" aria-label="載入中" /></main>;

  if (!me) return (
    <main className="chat-app chat-center">
      <section className="chat-gate">
        <img src="/eris-180.png" alt="" className="chat-gate-avatar" />
        <h1>{greeting()}，我是 Eris</h1>
        <p>傳照片或打字給我，我幫你記進日常營養。先用 Google 登入一次就好。</p>
        <button className="chat-primary" onClick={() => void signIn()}>使用 Google 登入</button>
      </section>
    </main>
  );

  if (!demo && enabled === false) return (
    <main className="chat-app chat-center">
      <section className="chat-gate">
        <img src="/eris-180.png" alt="" className="chat-gate-avatar" />
        <h1>這個帳號還沒開通聊天</h1>
        <p>請 Jovi 把這個帳號加進設定。登入的是 {me.email ?? "這個 Google 帳號"}。</p>
        <Link className="chat-secondary" href="/">先去看紀錄</Link>
      </section>
      <div className="chat-tabs"><TabBar active="chat" /></div>
    </main>
  );

  const canSend = (text.trim().length > 0 || photos.length > 0) && preparing === 0;

  return (
    <main className={`chat-app${typing ? " typing" : ""}`}>
      <header className="chat-head">
        <div className="chat-avatar"><img src="/eris-96.png" alt="" /><i className={working ? "busy" : ""} /></div>
        <div className="chat-title">
          <strong>Eris</strong>
          <span key={working ? "busy" : "idle"}>{working ? `正在記錄 ${working} 則…` : "傳照片或打字，我幫你記"}</span>
        </div>
      </header>

      <div className="chat-list" ref={listRef} onScroll={onScroll}>
        {rows.length === 0 && (
          <section className="chat-empty">
            <img src="/eris-180.png" alt="" />
            <h2>{greeting()}！今天吃了什麼？</h2>
            <p>可以一次傳好幾張照片：餐點、包裝正面、營養標示都可以。傳完就能關掉 App，我會自己記好。</p>
            <div className="chat-suggest">
              {SUGGESTIONS.map(suggestion => <button key={suggestion} onClick={() => { setText(suggestion); textRef.current?.focus(); }}>{suggestion}</button>)}
            </div>
          </section>
        )}
        {rows.map((row, index) => {
          const day = dayLabel(row.createdAt);
          const divider = index === 0 || day !== dayLabel(rows[index - 1].createdAt)
            ? <div className="chat-day" key={`d-${row.id}`}><span>{day}</span></div> : null;
          return [divider, <MessageRow key={row.id} row={row} fresh={row.createdAt > openedAt} onRetry={item => void send(item)} onOpen={setViewer} />];
        })}
      </div>

      <footer className="chat-compose">
        {(photos.length > 0 || preparing > 0) && (
          <div className="chat-tray" aria-label="準備送出的照片">
            {photos.map(photo => (
              <figure key={photo.key} className="chat-tray-item">
                <img src={photo.thumb} alt="" />
                <button aria-label="移除這張" onClick={() => setPhotos(list => list.filter(entry => entry.key !== photo.key))}>×</button>
              </figure>
            ))}
            {Array.from({ length: preparing }, (_, index) => <figure key={`p${index}`} className="chat-tray-item loading"><span className="chat-spinner" /></figure>)}
            {photos.length + preparing < MAX_PHOTOS && <button className="chat-tray-add" onClick={() => fileRef.current?.click()} aria-label="再加照片">＋</button>}
          </div>
        )}
        <div className="chat-bar">
          <button className="chat-camera" onClick={() => fileRef.current?.click()} aria-label="加照片">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.2-1.6A1.5 1.5 0 0 1 10.2 4h3.6a1.5 1.5 0 0 1 1.2.6L16.2 6h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.4" r="3.4" /></svg>
            {photos.length > 0 && <b>{photos.length}</b>}
          </button>
          <textarea
            ref={textRef} rows={1} value={text} placeholder={photos.length ? "補充一句（可不填）" : "跟 Eris 說吃了什麼…"}
            onChange={event => setText(event.target.value)} onKeyDown={onKeyDown} enterKeyHint="enter"
            onFocus={() => setTyping(window.matchMedia("(pointer: coarse)").matches)} onBlur={() => setTyping(false)}
          />
          <button className={`chat-send${canSend ? " ready" : ""}`} disabled={!canSend} onClick={() => void submit()} aria-label="送出">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={event => { void addPhotos(event.target.files); event.target.value = ""; }} />
      </footer>
      <div className="chat-tabs"><TabBar active="chat" badge={working} /></div>

      {toast && <div key={toast.key} className={`chat-toast ${toast.tone}`} role="status">
        {toast.tone === "ok" && <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7.5" /></svg>}{toast.text}
      </div>}
      {viewer && <button className="chat-viewer" onClick={() => setViewer(null)} aria-label="關閉照片"><img src={viewer} alt="" /></button>}
    </main>
  );
}

function MessageRow({ row, fresh, onRetry, onOpen }: { row: Row; fresh: boolean; onRetry: (item: OutboxItem) => void; onOpen: (src: string) => void }) {
  const status = row.doc?.status;
  const local = row.local;
  let chip: React.ReactNode;
  if (local && !local.failed) chip = <span className="chip sending"><i className="chat-spinner" />傳送中</span>;
  else if (local?.failed) chip = <button className="chip retry" onClick={() => onRetry(local)}>沒送出・點這裡重試</button>;
  else if (status === "sending" || status === "retry") chip = <span className="chip sending"><i className="chat-spinner" />傳送中</span>;
  else chip = <span className="chip sent">{clock(row.createdAt)}・已送出</span>;

  return (
    <>
      <article className={`msg me${fresh ? " fresh" : ""}`}>
        <div className={`bubble${row.text ? "" : " photo-only"}`}>
          {row.thumbs.length > 0 && (
            <div className={`msg-photos n${Math.min(row.thumbs.length, 4)}`}>
              {row.thumbs.slice(0, 4).map((thumb, index) => (
                <button key={index} onClick={() => onOpen(thumb)} aria-label="放大照片">
                  <img src={thumb} alt="" />
                  {index === 3 && row.thumbs.length > 4 && <span>+{row.thumbs.length - 4}</span>}
                </button>
              ))}
            </div>
          )}
          {row.text && <p>{row.text}</p>}
        </div>
        {chip}
      </article>
      {status === "processing" && (
        <article className="msg eris fresh"><img src="/eris-96.png" alt="" className="msg-avatar" /><div className="eris-working"><div className="bubble typing" aria-label="Eris 正在記錄"><i /><i /><i /></div><small>{row.thumbs.length ? "正在看照片、算熱量，通常 30 秒到 1 分鐘，可以先關掉 App" : "正在處理，可以先關掉 App"}</small></div></article>
      )}
      {status === "done" && (
        <article className={`msg eris${fresh ? " fresh" : ""}`}><img src="/eris-96.png" alt="" className="msg-avatar" /><div className="bubble"><p>{row.doc?.reply || "這則的回覆已經過期了，請到「看紀錄」確認有沒有記上。"}</p></div></article>
      )}
      {status === "failed" && (
        <article className={`msg eris${fresh ? " fresh" : ""}`}><img src="/eris-96.png" alt="" className="msg-avatar" /><div className="bubble warn"><p>這則我沒處理完，可以再傳一次嗎？</p></div></article>
      )}
    </>
  );
}
