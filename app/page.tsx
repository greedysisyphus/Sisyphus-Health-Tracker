"use client";

import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, googleProvider, hasFirebaseConfig } from "../lib/firebase";
import { calculateDailyTotals, formatLocalDate, type FoodEntry } from "../lib/nutrition";
import { getBodyLog, getDailyLog, listDailyEntries, removeEntry, saveBodyLog, saveEntry, saveWater } from "../services/health-service";

type Meal = FoodEntry["meal"];
const meals: Meal[] = ["早餐", "午餐", "晚餐", "點心", "飲料", "其他"];
const targets = { calories: 1800, protein: 120, carbs: 200, fat: 60, water: 2800 };
const dateLabel = (date: string) => new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", timeZone: "Asia/Taipei" }).format(new Date(`${date}T12:00:00`));

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [date, setDate] = useState(() => formatLocalDate(new Date()));
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [weightKg, setWeightKg] = useState<number | undefined>();
  const [loading, setLoading] = useState(() => Boolean(auth));
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<FoodEntry | null | undefined>(undefined);
  const totals = useMemo(() => calculateDailyTotals(entries), [entries]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, current => { setUser(current); setLoading(false); });
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [nextEntries, daily, body] = await Promise.all([listDailyEntries(user.uid, date), getDailyLog(user.uid, date), getBodyLog(user.uid, date)]);
      setEntries(nextEntries);
      setWaterMl(daily?.waterMl ?? 0);
      setWeightKg(body?.weightKg);
    } catch { setNotice("讀取資料失敗，請確認 Firebase 設定與登入狀態。"); }
    finally { setLoading(false); }
  }, [date, user]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const saveFoodEntry = async (entry: FoodEntry) => {
    if (!user) return;
    await saveEntry(user.uid, date, entry);
    await load();
    setEditor(undefined);
  };
  const deleteEntry = async (entryId: string) => {
    if (!user || !confirm("確定刪除這筆紀錄？")) return;
    await removeEntry(user.uid, date, entryId);
    await load();
  };
  const addWater = async (amount: number) => {
    if (!user) return;
    const next = waterMl + amount;
    await saveWater(user.uid, date, next);
    setWaterMl(next);
  };
  const updateWeight = async (value: number) => {
    if (!user || !Number.isFinite(value) || value <= 0) return;
    await saveBodyLog(user.uid, { date, weightKg: value });
    setWeightKg(value);
  };
  const signIn = async () => {
    if (!auth || !googleProvider) return;
    try { await signInWithPopup(auth, googleProvider); } catch { setNotice("登入未完成，請確認 Firebase 已啟用 Google 登入，並已加入目前網站網域。"); }
  };

  if (!hasFirebaseConfig) return <SetupScreen />;
  if (loading && !user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>正在確認登入狀態…</h1></main>;
  if (!user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>把健康資料放在你自己手中。</h1><p>登入後即可保存飲食、喝水、體重與 Hermes 的自動紀錄。</p><button className="primary" onClick={() => void signIn()}>使用 Google 登入</button>{notice && <p className="notice">{notice}</p>}</main>;

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><i>n</i><span>日常營養</span></div><p className="side-date">飲食、體重與喝水，都會安全地儲存在你的帳號。</p><nav><button className="active">◌　每日紀錄</button><button disabled>▦　每日總覽（即將推出）</button><button disabled>〽　趨勢（即將推出）</button><button disabled>□　我的食物（即將推出）</button></nav><div className="profile"><div>{(user.displayName ?? user.email ?? "你").slice(0, 1)}</div><span>{user.displayName ?? "我的帳號"}<small>{user.email}</small></span><button className="text-button" onClick={() => void signOut(auth!)}>登出</button></div></aside>
    <section className="content">
      <div className="date-bar"><button onClick={() => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000)))}><b>‹ 前一天</b></button><label>指定日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button onClick={() => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() + 86400000)))}><b>後一天 ›</b></button></div>
      <header><div><p className="eyebrow">DAILY LOG</p><h1>{date === formatLocalDate(new Date()) ? "今天，好好吃飯。" : `${dateLabel(date)}的飲食紀錄`}</h1><p className="muted">新增、修改和 Hermes 寫入的資料都會立即同步。</p></div><button className="primary" onClick={() => setEditor(null)}>＋ 新增紀錄</button></header>
      {notice && <p className="notice">{notice}</p>}
      <section className="hero-card"><div><p>今日熱量</p><div className="calorie"><strong>{Math.round(totals.calories)}</strong><span> / {targets.calories} kcal</span></div><div className="meter"><i style={{ width: `${Math.min(100, totals.calories / targets.calories * 100)}%` }} /></div><p className={totals.calories > targets.calories ? "over" : "remaining"}>{totals.calories > targets.calories ? `超出 ${Math.round(totals.calories - targets.calories)} kcal` : `剩餘 ${Math.round(targets.calories - totals.calories)} kcal`}</p></div><div className="weight"><span>當日紀錄</span><strong>{entries.length} <small>項</small></strong><p>蛋白質 {Math.round(totals.protein)}g · 纖維 {Math.round(totals.fiber)}g</p></div></section>
      <section className="macro-row"><Metric label="蛋白質" value={totals.protein} target={targets.protein} /><Metric label="碳水" value={totals.carbs} target={targets.carbs} /><Metric label="脂肪" value={totals.fat} target={targets.fat} /><div className="water"><span>飲水</span><strong>{waterMl} <small>ml</small></strong><div className="meter water-meter"><i style={{ width: `${Math.min(100, waterMl / targets.water * 100)}%` }} /></div><div className="quick-row"><button onClick={() => void addWater(250)}>＋250 ml</button><button onClick={() => void addWater(500)}>＋500 ml</button></div></div></section>
      <section className="quick-row"><label className="weight-input">體重（kg）<input type="number" min="1" step="0.1" defaultValue={weightKg} key={`${date}-${weightKg}`} onBlur={event => void updateWeight(Number(event.target.value))} /></label><span className="muted">鈉 {Math.round(totals.sodium)} mg · 糖 {Math.round(totals.sugar)} g</span></section>
      <div className="section-heading"><div><h2>{loading ? "載入中…" : "今天吃了什麼"}</h2><p>手動新增與 Hermes 的資料會保留完整營養與來源。</p></div></div>
      <EntryList entries={entries} edit={setEditor} remove={deleteEntry} />
    </section>
    {editor !== undefined && <Editor initial={editor} close={() => setEditor(undefined)} save={saveFoodEntry} />}
  </main>;
}

function SetupScreen() { return <main className="setup"><p className="eyebrow">需要連接 Firebase</p><h1>日常營養準備好了。</h1><p>請先在 Vercel 設定 Firebase 網頁應用程式的環境變數，再重新部署。詳細步驟請參閱專案的部署說明。</p></main>; }
function Metric({ label, value, target }: { label: string; value: number; target: number }) { return <div className="ring-wrap"><div className="ring" style={{ background: `conic-gradient(var(--sage) ${Math.min(100, value / target * 100)}%,var(--ring-track) 0)` }}><div className="ring-hole"><strong>{Math.round(value)}</strong><span>/{target}g</span></div></div><span>{label}</span></div>; }
function EntryList({ entries, edit, remove }: { entries: FoodEntry[]; edit: (entry: FoodEntry) => void; remove: (id: string) => void }) { return <section className="entry-list">{entries.length ? entries.map(entry => <article className="entry" key={entry.id}><div className="food-icon">◈</div><div><b>{entry.name}</b><p>{entry.meal} · {entry.portion}{entry.unit} · {entry.time}</p></div><div className="entry-nutrition"><b>{Math.round(entry.calories)} <small>kcal</small></b><span>P {Math.round(entry.protein)}g　C {Math.round(entry.carbs)}g　F {Math.round(entry.fat)}g</span></div><div className="entry-actions"><button onClick={() => edit(entry)}>編輯</button><button onClick={() => void remove(entry.id)}>刪除</button></div></article>) : <p className="empty">今天還沒有飲食紀錄。可直接新增一筆，或傳訊息給 Hermes。</p>}</section>; }
function Editor({ initial, close, save }: { initial: FoodEntry | null; close: () => void; save: (entry: FoodEntry) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ""); const [meal, setMeal] = useState<Meal>(initial?.meal ?? "點心"); const [calories, setCalories] = useState(initial?.calories ?? 0); const [protein, setProtein] = useState(initial?.protein ?? 0); const [carbs, setCarbs] = useState(initial?.carbs ?? 0); const [fat, setFat] = useState(initial?.fat ?? 0); const [sodium, setSodium] = useState(initial?.sodium ?? 0); const [saving, setSaving] = useState(false);
  const submit = async () => { if (!name || saving) return; setSaving(true); try { await save({ id: initial?.id ?? crypto.randomUUID(), name, meal, calories, protein, carbs, fat, sugar: initial?.sugar ?? 0, fiber: initial?.fiber ?? 0, saturatedFat: initial?.saturatedFat ?? 0, sodium, portion: initial?.portion ?? 1, unit: initial?.unit ?? "份", time: initial?.time ?? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date()) }); } finally { setSaving(false); } };
  return <div className="sheet-backdrop" onClick={close}><section className="sheet" onClick={event => event.stopPropagation()}><div className="grab" /><div className="sheet-title"><div><p className="eyebrow">DAILY LOG</p><h2>{initial ? "修改這筆紀錄" : "新增這筆紀錄"}</h2></div><button onClick={close}>×</button></div><label>食物名稱<input value={name} autoFocus onChange={event => setName(event.target.value)} /></label><div className="form-grid"><label>餐次<select value={meal} onChange={event => setMeal(event.target.value as Meal)}>{meals.map(item => <option key={item}>{item}</option>)}</select></label><label>熱量 kcal<input type="number" min="0" value={calories} onChange={event => setCalories(Number(event.target.value))} /></label><label>蛋白質 g<input type="number" min="0" value={protein} onChange={event => setProtein(Number(event.target.value))} /></label><label>碳水 g<input type="number" min="0" value={carbs} onChange={event => setCarbs(Number(event.target.value))} /></label><label>脂肪 g<input type="number" min="0" value={fat} onChange={event => setFat(Number(event.target.value))} /></label><label>鈉 mg<input type="number" min="0" value={sodium} onChange={event => setSodium(Number(event.target.value))} /></label></div><button className="save-btn" onClick={() => void submit()} disabled={saving}>{saving ? "儲存中…" : "儲存資料"}</button></section></div>;
}
