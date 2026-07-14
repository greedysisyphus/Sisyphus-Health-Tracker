"use client";

import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, googleProvider, hasFirebaseConfig } from "../lib/firebase";
import { calculateDailyTotals, formatLocalDate, type FoodEntry } from "../lib/nutrition";
import { getBodyLog, getDailyLog, getUserProfile, listDailyEntries, listDailyOverviews, listFoods, removeEntry, removeSavedFood, saveBodyLog, saveEntry, saveSavedFood, saveWater, type DailyOverview, type SavedFoodInput, type SavedFoodSummary } from "../services/health-service";

type Meal = FoodEntry["meal"];
type View = "daily" | "overview" | "trends" | "foods";
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
  const [view, setView] = useState<View>("daily");
  const [history, setHistory] = useState<DailyOverview[]>([]);
  const [savedFoods, setSavedFoods] = useState<SavedFoodSummary[]>([]);
  const [exporting, setExporting] = useState(false);
  const [foodEditor, setFoodEditor] = useState<SavedFoodInput | null | undefined>(undefined);
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
  useEffect(() => {
    if (!user || view === "daily") return;
    void Promise.all([listDailyOverviews(user.uid), listFoods(user.uid)]).then(([nextHistory, nextFoods]) => { setHistory(nextHistory); setSavedFoods(nextFoods); }).catch(() => setNotice("讀取彙整資料失敗。"));
  }, [user, view]);

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
  const saveCommonFood = async (food: SavedFoodInput) => {
    if (!user) return;
    try { await saveSavedFood(user.uid, food); setSavedFoods(await listFoods(user.uid)); setFoodEditor(undefined); setNotice(`已儲存「${food.name}」。`); }
    catch { setNotice("儲存常用食物失敗，請再試一次。") }
  };
  const deleteCommonFood = async (foodId: string) => {
    if (!user || !confirm("確定刪除這項常用食物？")) return;
    try { await removeSavedFood(user.uid, foodId); setSavedFoods(await listFoods(user.uid)); }
    catch { setNotice("刪除常用食物失敗，請再試一次。") }
  };
  const saveEntryAsCommonFood = async (entry: FoodEntry) => {
    if (!user) return;
    const numberOrZero = (value: number | undefined) => Number.isFinite(value) ? value! : 0;
    try {
      await saveSavedFood(user.uid, {
        id: crypto.randomUUID(), name: entry.name, category: entry.meal, baseAmount: numberOrZero(entry.portion) || 1, unit: entry.unit || "份",
        nutrition: { calories: numberOrZero(entry.calories), protein: numberOrZero(entry.protein), carbs: numberOrZero(entry.carbs), fat: numberOrZero(entry.fat), sugar: numberOrZero(entry.sugar), fiber: numberOrZero(entry.fiber), saturatedFat: numberOrZero(entry.saturatedFat), sodium: numberOrZero(entry.sodium) },
        favorite: true, ...(entry.notes ? { notes: entry.notes } : {})
      });
      setSavedFoods(await listFoods(user.uid)); setNotice(`已將「${entry.name}」加入常用食物。`);
    } catch { setNotice(`「${entry.name}」儲存失敗，請再試一次。`); }
  };
  const signIn = async () => {
    if (!auth || !googleProvider) return;
    try { await signInWithPopup(auth, googleProvider); } catch { setNotice("登入未完成，請確認 Firebase 已啟用 Google 登入，並已加入目前網站網域。"); }
  };
  const exportRecords = async (startDate: string, endDate: string) => {
    if (!user) return;
    const [allDays, profile] = await Promise.all([listDailyOverviews(user.uid, 365), getUserProfile(user.uid)]);
    const dailyRecords = allDays.filter(day => day.date >= startDate && day.date <= endDate).sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
      date: day.date, weight_kg: day.weightKg ?? null, water_ml: day.waterMl || null, steps: day.steps ?? null,
      foods: day.entries.map(entry => ({ name: entry.name, meal: entry.meal, portion: entry.portion, unit: entry.unit, hydration_ml: entry.hydrationMl ?? 0, nutrition: { calories_kcal: entry.calories, protein_g: entry.protein, carbohydrate_g: entry.carbs, fat_g: entry.fat, sugar_g: entry.sugar, fiber_g: entry.fiber, saturated_fat_g: entry.saturatedFat, sodium_mg: entry.sodium }, source: entry.source, confidence: entry.confidence, notes: entry.notes ?? null })),
      summary: { calories_kcal: day.total.calories, protein_g: day.total.protein, carbohydrate_g: day.total.carbs, fat_g: day.total.fat, sugar_g: day.total.sugar, fiber_g: day.total.fiber, saturated_fat_g: day.total.saturatedFat, sodium_mg: day.total.sodium },
    }));
    const payload = { schema_version: "1.1", exported_at: new Date().toISOString(), timezone: "Asia/Taipei", profile, targets, date_range: { start: startDate, end: endDate }, daily_records: dailyRecords, notes: ["每筆營養為實際紀錄值；source 與 confidence 表示資料來源和可信度。", "沒有被記錄的餐點不代表當天沒有吃。"] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `health-records_${startDate}_to_${endDate}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const copyChatGPTAnalysis = async (days: 1 | 3 | 7) => {
    if (!user) return;
    const endDate = formatLocalDate(new Date());
    const startDate = formatLocalDate(new Date(new Date(`${endDate}T12:00:00`).getTime() - (days - 1) * 86400000));
    const allDays = await listDailyOverviews(user.uid, 365);
    const records = allDays.filter(day => day.date >= startDate && day.date <= endDate).sort((a, b) => a.date.localeCompare(b.date));
    const recordText = records.length ? records.map(day => [
      `【${day.date}】`,
      `總計：${Math.round(day.total.calories)} kcal｜蛋白質 ${Math.round(day.total.protein)} g｜碳水 ${Math.round(day.total.carbs)} g｜脂肪 ${Math.round(day.total.fat)} g｜纖維 ${Math.round(day.total.fiber)} g｜鈉 ${Math.round(day.total.sodium)} mg`,
      `水分：${day.waterMl || 0} ml｜體重：${day.weightKg ? `${day.weightKg} kg` : "未記錄"}｜步數：${day.steps ?? "未記錄"}`,
      `食物：${day.entries.length ? day.entries.map(entry => `${entry.name}（${Math.round(entry.calories)} kcal，P${Math.round(entry.protein)}g）`).join("、") : "未記錄"}`,
    ].join("\n")).join("\n\n") : "此區間沒有已記錄資料。";
    await navigator.clipboard.writeText(`請分析以下 ${days === 1 ? "今天" : `最近 ${days} 天`}的健康紀錄。我的目標是減脂、改善 LDL、控制血壓與保留肌肉。請：\n1. 評估熱量、蛋白質、纖維、鈉、水分、體重與步數。\n2. 清楚區分已記錄與缺漏資料，不要把估算當精確值。\n3. 給我 3 個具體、可執行的下一步建議。\n\n健康紀錄：\n${recordText}`);
    setNotice(`已複製${days === 1 ? "今天" : `最近 ${days} 天`}的資料與 ChatGPT 分析指令。`);
  };

  if (!hasFirebaseConfig) return <SetupScreen />;
  if (loading && !user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>正在確認登入狀態…</h1></main>;
  if (!user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>把健康資料放在你自己手中。</h1><p>登入後即可保存飲食、喝水、體重與 Hermes 的自動紀錄。</p><button className="primary" onClick={() => void signIn()}>使用 Google 登入</button>{notice && <p className="notice">{notice}</p>}</main>;

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><i>n</i><span>日常營養</span></div><p className="side-date">飲食、體重與喝水，都會安全地儲存在你的帳號。</p><nav><button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>◌　每日紀錄</button><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>▦　每日總覽</button><button className={view === "trends" ? "active" : ""} onClick={() => setView("trends")}>〽　趨勢</button><button className={view === "foods" ? "active" : ""} onClick={() => setView("foods")}><FoodNavIcon />我的食物</button></nav><div className="profile"><div>{(user.displayName ?? user.email ?? "你").slice(0, 1)}</div><span>{user.displayName ?? "我的帳號"}<small>{user.email}</small></span><button className="text-button" onClick={() => void signOut(auth!)}>登出</button></div></aside>
    <section className="content">
      <div className="mobile-topbar"><div className="brand"><i>n</i><span>日常營養</span></div><button className="text-button" onClick={() => void signOut(auth!)}>登出</button></div>
      {view === "daily" && <div className="date-bar"><button onClick={() => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000)))}><b>‹ 前一天</b></button><label>指定日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button onClick={() => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() + 86400000)))}><b>後一天 ›</b></button></div>}
      {view === "daily" ? <>
      <header><div><p className="eyebrow">DAILY LOG</p><h1>{date === formatLocalDate(new Date()) ? "今天，好好吃飯。" : `${dateLabel(date)}的飲食紀錄`}</h1><p className="muted">新增、修改和 Hermes 寫入的資料都會立即同步。</p></div><div className="header-actions"><button className="copy-btn" onClick={() => setExporting(true)}>匯出資料</button><button className="primary" onClick={() => setEditor(null)}>＋ 新增紀錄</button></div></header>
      {notice && <p className="notice">{notice}</p>}
      <section className="hero-card"><div><p>今日熱量</p><div className="calorie"><strong>{Math.round(totals.calories)}</strong><span> / {targets.calories} kcal</span></div><div className="meter"><i style={{ width: `${Math.min(100, totals.calories / targets.calories * 100)}%` }} /></div><p className={totals.calories > targets.calories ? "over" : "remaining"}>{totals.calories > targets.calories ? `超出 ${Math.round(totals.calories - targets.calories)} kcal` : `剩餘 ${Math.round(targets.calories - totals.calories)} kcal`}</p></div><div className="weight"><span>當日紀錄</span><strong>{entries.length} <small>項</small></strong><p>蛋白質 {Math.round(totals.protein)}g · 纖維 {Math.round(totals.fiber)}g</p></div></section>
      <section className="macro-row"><Metric label="蛋白質" value={totals.protein} target={targets.protein} /><Metric label="碳水" value={totals.carbs} target={targets.carbs} /><Metric label="脂肪" value={totals.fat} target={targets.fat} /><div className="water"><span>水分（含飲品）</span><strong>{waterMl} <small>ml</small></strong><div className="meter water-meter"><i style={{ width: `${Math.min(100, waterMl / targets.water * 100)}%` }} /></div><div className="quick-row"><button onClick={() => void addWater(250)}>＋250 ml</button><button onClick={() => void addWater(500)}>＋500 ml</button></div></div></section>
      <section className="quick-row"><label className="weight-input">體重（kg）<input type="number" min="1" step="0.1" defaultValue={weightKg} key={`${date}-${weightKg}`} onBlur={event => void updateWeight(Number(event.target.value))} /></label><span className="muted">鈉 {Math.round(totals.sodium)} mg · 糖 {Math.round(totals.sugar)} g</span></section>
      <div className="section-heading"><div><h2>{loading ? "載入中…" : "今天吃了什麼"}</h2><p>手動新增與 Hermes 的資料會保留完整營養與來源。</p></div></div>
      <EntryList entries={entries} edit={setEditor} remove={deleteEntry} saveAsCommon={saveEntryAsCommonFood} />
      </> : view === "overview" ? <Overview history={history} openDate={(nextDate) => { setDate(nextDate); setView("daily"); }} exportData={() => setExporting(true)} /> : view === "trends" ? <Trends history={history} /> : <FoodLibrary foods={savedFoods} add={() => setFoodEditor(null)} remove={deleteCommonFood} />}
    </section>
    {editor !== undefined && <Editor initial={editor} close={() => setEditor(undefined)} save={saveFoodEntry} />}
    {foodEditor !== undefined && <FoodEditor initial={foodEditor} close={() => setFoodEditor(undefined)} save={saveCommonFood} />}
    {exporting && <ExportSheet close={() => setExporting(false)} exportRecords={exportRecords} copyChatGPTAnalysis={copyChatGPTAnalysis} />}
    <nav className="bottom-nav" aria-label="主要功能"><button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}><b>◌</b><span>每日</span></button><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><b>▦</b><span>總覽</span></button><button className={view === "trends" ? "active" : ""} onClick={() => setView("trends")}><b>〽</b><span>趨勢</span></button><button className={view === "foods" ? "active" : ""} onClick={() => setView("foods")}><b><FoodNavIcon /></b><span>食物</span></button></nav>
  </main>;
}

function SetupScreen() { return <main className="setup"><p className="eyebrow">需要連接 Firebase</p><h1>日常營養準備好了。</h1><p>請先在 Vercel 設定 Firebase 網頁應用程式的環境變數，再重新部署。詳細步驟請參閱專案的部署說明。</p></main>; }
function FoodNavIcon() { return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11h18a9 9 0 0 1-18 0Z" /><path d="M12 20v2" /><path d="M8 22h8" /><path d="M7 6 4 3" /><path d="m11 7 5-5" /></svg>; }
function Overview({ history, openDate, exportData }: { history: DailyOverview[]; openDate: (date: string) => void; exportData: () => void }) { return <><header><div><p className="eyebrow">DAILY OVERVIEW</p><h1>每一日，都有脈絡。</h1><p className="muted">顯示已紀錄日期；點選任一列可回到當日完整明細。</p></div><button className="copy-btn" onClick={exportData}>匯出資料</button></header><div className="table-wrap"><table><thead><tr><th>日期</th><th>熱量</th><th>蛋白質</th><th>碳水／脂肪</th><th>飲水</th><th>體重</th><th></th></tr></thead><tbody>{history.length ? history.map(day => <tr key={day.date}><td><b>{dateLabel(day.date)}</b><small>{day.entries.length} 項食物紀錄</small></td><td>{Math.round(day.total.calories)} kcal</td><td>{Math.round(day.total.protein)} g</td><td>{Math.round(day.total.carbs)} g ／ {Math.round(day.total.fat)} g</td><td>{day.waterMl || "—"}{day.waterMl ? " ml" : ""}</td><td>{day.weightKg ? `${day.weightKg} kg` : "—"}</td><td><button className="table-edit" onClick={() => openDate(day.date)}>查看</button></td></tr>) : <tr><td colSpan={7}>還沒有可彙整的紀錄。</td></tr>}</tbody></table></div></> }
function Trends({ history }: { history: DailyOverview[] }) { const days = [...history].reverse().slice(-14); const calorieAverage = days.length ? Math.round(days.reduce((sum, day) => sum + day.total.calories, 0) / days.length) : 0; const proteinAverage = days.length ? Math.round(days.reduce((sum, day) => sum + day.total.protein, 0) / days.length) : 0; const weight = days.filter(day => day.weightKg); return <><header><div><p className="eyebrow">TRENDS</p><h1>看見真正的趨勢。</h1><p className="muted">以已有紀錄計算平均；沒有填寫的營養數字不會被猜測補上。</p></div></header><section className="trend-card"><div><div><p>平均熱量</p><h2>{calorieAverage || "—"} <small>{calorieAverage ? "kcal" : ""}</small></h2></div><div><p>平均蛋白質</p><h2>{proteinAverage || "—"} <small>{proteinAverage ? "g" : ""}</small></h2></div><div><p>體重變化</p><h2>{weight.length > 1 ? `${(weight[weight.length - 1].weightKg! - weight[0].weightKg!).toFixed(1)} kg` : "—"}</h2></div></div><div className="nutrition-bars">{days.map(day => <div key={day.date}><div className="bar-pair"><i style={{ height: `${Math.min(100, day.total.calories / targets.calories * 100)}%` }} /><em style={{ height: `${Math.min(100, day.total.protein / targets.protein * 100)}%` }} /></div><span>{day.date.slice(5)}</span><b>{Math.round(day.total.calories)}</b></div>)}</div><p className="legend"><i /> 熱量（相對目標）　<em /> 蛋白質（相對目標）</p></section></> }
function FoodLibrary({ foods, add, remove }: { foods: SavedFoodSummary[]; add: () => void; remove: (id: string) => void }) { const [query, setQuery] = useState(""); const visible = foods.filter(food => `${food.name} ${food.brand ?? ""} ${food.category}`.toLowerCase().includes(query.toLowerCase())); return <><header><div><p className="eyebrow">MY FOODS</p><h1>常用食物，慢慢累積。</h1><p className="muted">可手動新增，或從每日紀錄一鍵儲存。Hermes 也能使用這些營養資料。</p></div><button className="primary" onClick={add}>＋ 新增食物</button></header><input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋名稱、品牌或分類" /><section className="food-library">{visible.length ? visible.map(food => <article key={food.id}><div className="food-icon">{food.favorite ? "★" : "◈"}</div><div><b>{food.name}</b><p>{food.brand ? `${food.brand} · ` : ""}{food.category} · P {food.nutrition.protein}g</p></div><span>{food.nutrition.calories} kcal</span><button aria-label={`刪除 ${food.name}`} onClick={() => remove(food.id)}>×</button></article>) : <p className="empty">尚無符合的常用食物。可新增一筆，或從每日紀錄按「常用」。</p>}</section></> }
function ExportSheet({ close, exportRecords, copyChatGPTAnalysis }: { close: () => void; exportRecords: (startDate: string, endDate: string) => Promise<void>; copyChatGPTAnalysis: (days: 1 | 3 | 7) => Promise<void> }) { const today = formatLocalDate(new Date()); const [startDate, setStartDate] = useState(formatLocalDate(new Date(new Date(`${today}T12:00:00`).getTime() - 6 * 86400000))); const [endDate, setEndDate] = useState(today); const [working, setWorking] = useState(false); const download = async () => { if (startDate > endDate || working) return; setWorking(true); try { await exportRecords(startDate, endDate); } finally { setWorking(false); } }; const copyHermes = async () => { await navigator.clipboard.writeText(`/health-log 請分析 ${startDate} 到 ${endDate} 的健康紀錄。先用 get_range_summary 讀取資料，再比較熱量、蛋白質、纖維、鈉、飲水、體重與步數，說明缺漏資料與估算的限制，最後給我 3 個具體建議。`); }; return <div className="sheet-backdrop" onClick={close}><section className="sheet export-sheet" onClick={event => event.stopPropagation()}><div className="grab" /><div className="sheet-title"><div><p className="eyebrow">ANALYSIS</p><h2>複製給 ChatGPT 分析</h2></div><button onClick={close}>×</button></div><p className="muted export-copy">按一下就會複製「分析指令＋實際紀錄資料」，直接貼到 ChatGPT 即可，不需要下載檔案。</p><div className="analysis-choices"><button className="save-btn" onClick={() => void copyChatGPTAnalysis(1)}>複製今天資料＋分析指令</button><button className="parse-btn" onClick={() => void copyChatGPTAnalysis(3)}>複製最近 3 天資料＋分析指令</button><button className="parse-btn" onClick={() => void copyChatGPTAnalysis(7)}>複製最近 7 天資料＋分析指令</button></div><p className="export-divider">或下載完整資料</p><div className="form-grid"><label>開始日期<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>結束日期<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div><button className="parse-btn" onClick={() => void download()} disabled={working || startDate > endDate}>{working ? "準備中…" : "下載 JSON"}</button><button className="parse-btn" onClick={() => void copyHermes()}>複製 Hermes 分析指令</button></section></div> }
function Metric({ label, value, target }: { label: string; value: number; target: number }) { return <div className="ring-wrap"><div className="ring" style={{ background: `conic-gradient(var(--sage) ${Math.min(100, value / target * 100)}%,var(--ring-track) 0)` }}><div className="ring-hole"><strong>{Math.round(value)}</strong><span>/{target}g</span></div></div><span>{label}</span></div>; }
function EntryList({ entries, edit, remove, saveAsCommon }: { entries: FoodEntry[]; edit: (entry: FoodEntry) => void; remove: (id: string) => void; saveAsCommon: (entry: FoodEntry) => Promise<void> }) { return <section className="entry-list">{entries.length ? entries.map(entry => <article className="entry" key={entry.id}><div className="food-icon">◈</div><div><b>{entry.name}</b><p>{entry.meal} · {entry.portion}{entry.unit} · {entry.time}</p></div><div className="entry-nutrition"><b>{Math.round(entry.calories)} <small>kcal</small></b><span>P {Math.round(entry.protein)}g　C {Math.round(entry.carbs)}g　F {Math.round(entry.fat)}g</span></div><div className="entry-actions"><button onClick={() => void saveAsCommon(entry)}>常用</button><button onClick={() => edit(entry)}>編輯</button><button onClick={() => void remove(entry.id)}>刪除</button></div></article>) : <p className="empty">今天還沒有飲食紀錄。可直接新增一筆，或傳訊息給 Hermes。</p>}</section>; }
function FoodEditor({ initial, close, save }: { initial: SavedFoodInput | null; close: () => void; save: (food: SavedFoodInput) => Promise<void> }) { const [name, setName] = useState(initial?.name ?? ""); const [brand, setBrand] = useState(initial?.brand ?? ""); const [category, setCategory] = useState(initial?.category ?? "飲品"); const [baseAmount, setBaseAmount] = useState(initial?.baseAmount ?? 1); const [unit, setUnit] = useState(initial?.unit ?? "份"); const [calories, setCalories] = useState(initial?.nutrition.calories ?? 0); const [protein, setProtein] = useState(initial?.nutrition.protein ?? 0); const [carbs, setCarbs] = useState(initial?.nutrition.carbs ?? 0); const [fat, setFat] = useState(initial?.nutrition.fat ?? 0); const [sodium, setSodium] = useState(initial?.nutrition.sodium ?? 0); const [favorite, setFavorite] = useState(initial?.favorite ?? true); const [saving, setSaving] = useState(false); const submit = async () => { if (!name || baseAmount <= 0 || saving) return; setSaving(true); try { await save({ id: initial?.id ?? crypto.randomUUID(), name, ...(brand ? { brand } : {}), category, baseAmount, unit, nutrition: { calories, protein, carbs, fat, sodium, sugar: initial?.nutrition.sugar ?? 0, fiber: initial?.nutrition.fiber ?? 0, saturatedFat: initial?.nutrition.saturatedFat ?? 0 }, favorite }); } finally { setSaving(false); } }; return <div className="sheet-backdrop" onClick={close}><section className="sheet" onClick={event => event.stopPropagation()}><div className="grab" /><div className="sheet-title"><div><p className="eyebrow">MY FOODS</p><h2>新增常用食物</h2></div><button onClick={close}>×</button></div><label>食物名稱<input value={name} autoFocus onChange={event => setName(event.target.value)} /></label><div className="form-grid"><label>品牌（選填）<input value={brand} onChange={event => setBrand(event.target.value)} /></label><label>分類<input value={category} onChange={event => setCategory(event.target.value)} /></label><label>基準份量<input type="number" min="0.1" value={baseAmount} onChange={event => setBaseAmount(Number(event.target.value))} /></label><label>單位<input value={unit} onChange={event => setUnit(event.target.value)} /></label><label>熱量 kcal<input type="number" min="0" value={calories} onChange={event => setCalories(Number(event.target.value))} /></label><label>蛋白質 g<input type="number" min="0" value={protein} onChange={event => setProtein(Number(event.target.value))} /></label><label>碳水 g<input type="number" min="0" value={carbs} onChange={event => setCarbs(Number(event.target.value))} /></label><label>脂肪 g<input type="number" min="0" value={fat} onChange={event => setFat(Number(event.target.value))} /></label><label>鈉 mg<input type="number" min="0" value={sodium} onChange={event => setSodium(Number(event.target.value))} /></label><label className="favorite-toggle"><input type="checkbox" checked={favorite} onChange={event => setFavorite(event.target.checked)} /> 加入我的最愛</label></div><button className="save-btn" onClick={() => void submit()} disabled={saving}>{saving ? "儲存中…" : "儲存食物"}</button></section></div> }
function Editor({ initial, close, save }: { initial: FoodEntry | null; close: () => void; save: (entry: FoodEntry) => Promise<void> }) {
  const [name, setName] = useState(initial?.name ?? ""); const [meal, setMeal] = useState<Meal>(initial?.meal ?? "點心"); const [calories, setCalories] = useState(initial?.calories ?? 0); const [protein, setProtein] = useState(initial?.protein ?? 0); const [carbs, setCarbs] = useState(initial?.carbs ?? 0); const [fat, setFat] = useState(initial?.fat ?? 0); const [sodium, setSodium] = useState(initial?.sodium ?? 0); const [saving, setSaving] = useState(false);
  const submit = async () => { if (!name || saving) return; setSaving(true); try { await save({ id: initial?.id ?? crypto.randomUUID(), name, meal, calories, protein, carbs, fat, sugar: initial?.sugar ?? 0, fiber: initial?.fiber ?? 0, saturatedFat: initial?.saturatedFat ?? 0, sodium, portion: initial?.portion ?? 1, unit: initial?.unit ?? "份", time: initial?.time ?? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date()) }); } finally { setSaving(false); } };
  return <div className="sheet-backdrop" onClick={close}><section className="sheet" onClick={event => event.stopPropagation()}><div className="grab" /><div className="sheet-title"><div><p className="eyebrow">DAILY LOG</p><h2>{initial ? "修改這筆紀錄" : "新增這筆紀錄"}</h2></div><button onClick={close}>×</button></div><label>食物名稱<input value={name} autoFocus onChange={event => setName(event.target.value)} /></label><div className="form-grid"><label>餐次<select value={meal} onChange={event => setMeal(event.target.value as Meal)}>{meals.map(item => <option key={item}>{item}</option>)}</select></label><label>熱量 kcal<input type="number" min="0" value={calories} onChange={event => setCalories(Number(event.target.value))} /></label><label>蛋白質 g<input type="number" min="0" value={protein} onChange={event => setProtein(Number(event.target.value))} /></label><label>碳水 g<input type="number" min="0" value={carbs} onChange={event => setCarbs(Number(event.target.value))} /></label><label>脂肪 g<input type="number" min="0" value={fat} onChange={event => setFat(Number(event.target.value))} /></label><label>鈉 mg<input type="number" min="0" value={sodium} onChange={event => setSodium(Number(event.target.value))} /></label></div><button className="save-btn" onClick={() => void submit()} disabled={saving}>{saving ? "儲存中…" : "儲存資料"}</button></section></div>;
}
