"use client";

import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth, googleProvider, hasFirebaseConfig } from "../lib/firebase";
import { calculateDailyNutrition, calculateHydrationSummary, calculateSevenDayAverage, emptyNutrition, foodCategories, formatLocalDate, formatNutrition, meals, parseNonNegativeNumber, totalForEntry, type FoodEntry, type MealType, type Nutrition } from "../lib/nutrition";
import { getBodyLog, getDailyLog, getUserProfile, listDailyEntries, listDailyOverviews, listFoods, removeEntry, removeSavedFood, saveBodyLog, saveEntry, saveHealthTargets, saveSavedFood, saveWater, type DailyOverview, type SavedFoodInput, type SavedFoodSummary } from "../services/health-service";

type View = "daily" | "overview" | "trends" | "foods" | "settings";
type EditorState = FoodEntry | null | undefined;
type AnalysisTexts = Partial<Record<1 | 3 | 7, string>>;
type HealthTargets = { caloriesKcal: number; proteinG: number; carbsG: number; fatG: number; waterMl: number; fiberG: number; sodiumMg: number };
const defaultTargets: HealthTargets = { caloriesKcal: 1800, proteinG: 120, carbsG: 200, fatG: 60, waterMl: 2800, fiberG: 25, sodiumMg: 2000 };
const TargetsContext = createContext<HealthTargets>(defaultTargets);
const dateLabel = (date: string) => new Intl.DateTimeFormat("zh-TW", { month: "long", day: "numeric", timeZone: "Asia/Taipei" }).format(new Date(`${date}T12:00:00`));
const nowTime = () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" }).format(new Date());

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [date, setDate] = useState(() => formatLocalDate(new Date()));
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [waterMl, setWaterMl] = useState(0);
  const [weightKg, setWeightKg] = useState<number | undefined>();
  const [loading, setLoading] = useState(Boolean(auth));
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("daily");
  const [history, setHistory] = useState<DailyOverview[]>([]);
  const [savedFoods, setSavedFoods] = useState<SavedFoodSummary[]>([]);
  const [entryEditor, setEntryEditor] = useState<EditorState>(undefined);
  const [foodEditor, setFoodEditor] = useState<SavedFoodInput | null | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [analysisTexts, setAnalysisTexts] = useState<AnalysisTexts>({});
  const [analysisPreparing, setAnalysisPreparing] = useState(false);
  const [targetState, setTargets] = useState<HealthTargets>(defaultTargets);
  const totals = useMemo(() => calculateDailyNutrition(entries), [entries]);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, current => { setUser(current); setLoading(false); });
  }, []);

  const loadDaily = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [nextEntries, daily, body] = await Promise.all([listDailyEntries(user.uid, date), getDailyLog(user.uid, date), getBodyLog(user.uid, date)]);
      setEntries(nextEntries); setWaterMl(daily?.waterMl ?? 0); setWeightKg(body?.weightKg);
    } catch { setNotice("讀取資料失敗，請確認 Firebase 設定與登入狀態。"); }
    finally { setLoading(false); }
  }, [date, user]);

  const loadLibrary = useCallback(async () => { if (user) setSavedFoods(await listFoods(user.uid)); }, [user]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadDaily(); }, 0); return () => window.clearTimeout(timer); }, [loadDaily]);
  useEffect(() => { const timer = window.setTimeout(() => { void loadLibrary().catch(() => setNotice("讀取常用食物失敗。")); }, 0); return () => window.clearTimeout(timer); }, [loadLibrary]);
  useEffect(() => { if (!user) return; void getUserProfile(user.uid).then(profile => { if (!profile) return; setTargets(current => ({ ...current, caloriesKcal: Number(profile.calorieTarget) || current.caloriesKcal, proteinG: Number(profile.proteinTarget) || current.proteinG, carbsG: Number(profile.carbTarget) || current.carbsG, fatG: Number(profile.fatTarget) || current.fatG, waterMl: Number(profile.waterTargetMl) || current.waterMl, fiberG: Number(profile.fiberTarget) || current.fiberG, sodiumMg: Number(profile.sodiumLimit) || current.sodiumMg })); }).catch(() => setNotice("讀取個人目標失敗。")); }, [user]);
  useEffect(() => { if (view === "daily") return; const timer = window.setTimeout(() => { void listDailyOverviews(user?.uid ?? "").then(setHistory).catch(() => setNotice("讀取彙整資料失敗。")); }, 0); return () => window.clearTimeout(timer); }, [user?.uid, view]);

  const saveDailyEntry = async (entry: FoodEntry) => {
    if (!user) return;
    try { await saveEntry(user.uid, date, entry); await loadDaily(); setEntryEditor(undefined); setNotice(`已儲存「${entry.name}」${entry.hydrationMl > 0 ? `，飲品水分 +${Math.round(entry.hydrationMl)} ml。` : "。"}`); }
    catch { setNotice("儲存飲食紀錄失敗，請再試一次。"); }
  };
  const deleteEntry = async (entryId: string) => { if (user && confirm("確定刪除這筆紀錄？")) { await removeEntry(user.uid, date, entryId); await loadDaily(); } };
  const addWater = async (amount: number) => { if (!user) return; try { const next = waterMl + amount; await saveWater(user.uid, date, next); setWaterMl(next); setNotice(`已加入白水 ${amount} ml；今日水分 ${next} ml。`); } catch { setNotice("儲存飲水失敗，請再試一次。"); } };
  const quickAddDrink = async (food: SavedFoodSummary) => {
    if (!user) return;
    try {
      const hydrationMl = food.hydrationMlPerServing;
      await saveEntry(user.uid, date, {
        id: crypto.randomUUID(), name: food.name, brand: food.brand, category: food.category, mealType: food.category === "飲料" || hydrationMl > 0 ? "飲料" : "點心", servings: 1, consumedPercent: 100,
        servingWeightG: food.servingWeightG, ...food.nutrition, hydrationMl, time: nowTime(), notes: food.notes, source: "database", confidence: "high", sourceFoodId: food.id,
      });
      await loadDaily();
      setNotice(`已快速加入「${food.name}」${hydrationMl > 0 ? `，飲品水分 +${Math.round(hydrationMl)} ml。` : "。"}`);
    } catch { setNotice("快速加入飲品失敗，請再試一次。"); }
  };
  const updateWeight = async (value: string) => { const parsed = parseNonNegativeNumber(value); if (!user || parsed === null || parsed <= 0) return; await saveBodyLog(user.uid, { date, weightKg: parsed }); setWeightKg(parsed); };
  const saveFood = async (food: SavedFoodInput) => { if (!user) return; try { await saveSavedFood(user.uid, food); await loadLibrary(); setFoodEditor(undefined); setNotice(`已儲存「${food.name}」。`); } catch { setNotice("儲存常用食物失敗，請再試一次。"); } };
  const applySuggestedHydration = async (food: SavedFoodSummary, hydrationMlPerServing: number) => {
    await saveFood({ ...food, hydrationMlPerServing });
    setNotice(`已為「${food.name}」設定每份水分 ${hydrationMlPerServing} ml。`);
  };
  const deleteFood = async (id: string) => { if (user && confirm("確定刪除這項常用食物？")) { await removeSavedFood(user.uid, id); await loadLibrary(); } };
  const saveAsCommon = async (entry: FoodEntry) => { await saveFood({ id: crypto.randomUUID(), name: entry.name, brand: entry.brand, category: entry.category, servingWeightG: entry.servingWeightG, hydrationMlPerServing: entry.servings > 0 ? entry.hydrationMl / entry.servings : 0, nutrition: { ...entryNutrition(entry) }, favorite: true, notes: entry.notes }); };
  const exportRecords = async (startDate: string, endDate: string) => {
    if (!user) return;
    const [days, profile] = await Promise.all([listDailyOverviews(user.uid, 365), getUserProfile(user.uid)]);
    const records = days.filter(day => day.date >= startDate && day.date <= endDate).sort((a, b) => a.date.localeCompare(b.date)).map(day => ({ date: day.date, weight_kg: day.weightKg ?? null, water_ml: day.waterMl, steps: day.steps ?? null, foods: day.entries, summary: day.total }));
    const payload = { schema_version: "2.0", exported_at: new Date().toISOString(), timezone: "Asia/Taipei", profile, targets: targetState, date_range: { start: startDate, end: endDate }, daily_records: records };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `health-records_${startDate}_to_${endDate}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const prepareChatGPTAnalysis = async () => {
    if (!user) return;
    setAnalysisPreparing(true);
    try {
      const allDays = await listDailyOverviews(user.uid, 365);
      const end = formatLocalDate(new Date());
      const makeText = (days: 1 | 3 | 7) => {
        const start = formatLocalDate(new Date(new Date(`${end}T12:00:00`).getTime() - (days - 1) * 86400000));
        const records = allDays.filter(day => day.date >= start && day.date <= end).sort((a, b) => a.date.localeCompare(b.date));
        const recordsText = records.map(day => `【${day.date}】\n${summaryLine(day.total)}\n水分 ${day.waterMl} ml｜體重 ${day.weightKg ?? "未記錄"} kg｜步數 ${day.steps ?? "未記錄"}\n食物：${day.entries.map(entry => `${entry.name}（${formatNutrition(totalForEntry(entry).caloriesKcal, "kcal")}）`).join("、") || "未記錄"}`).join("\n\n") || "沒有已記錄資料";
        return `請分析以下${days === 1 ? "今天" : `最近 ${days} 天`}健康紀錄。目標：減脂、改善 LDL、控制血壓、保留肌肉。請評估熱量、蛋白質、纖維、鈉、水分、咖啡因與體重趨勢，說明資料缺漏，並給 3 個可執行建議。\n\n${recordsText}`;
      };
      setAnalysisTexts({ 1: makeText(1), 3: makeText(3), 7: makeText(7) });
    } catch { setNotice("無法準備分析資料，請確認網路後再試一次。"); }
    finally { setAnalysisPreparing(false); }
  };
  const openExport = () => { setAnalysisTexts({}); setExporting(true); void prepareChatGPTAnalysis(); };
  const copyChatGPTAnalysis = async (days: 1 | 3 | 7): Promise<boolean> => {
    const text = analysisTexts[days];
    if (!text) { setNotice("分析資料仍在準備中，請稍候再按一次。 "); return false; }
    const copied = await copyPlainText(text);
    setNotice(copied ? "已複製資料與 ChatGPT 分析指令。" : "無法自動複製，請確認 Safari 允許網站使用剪貼簿後再試一次。");
    return copied;
  };

  if (!hasFirebaseConfig) return <SetupScreen />;
  if (loading && !user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>正在確認登入狀態…</h1></main>;
  if (!user) return <main className="setup"><p className="eyebrow">日常營養</p><h1>把健康資料放在你自己手中。</h1><p>登入後即可保存飲食、喝水、體重與 Hermes 的自動紀錄。</p><button className="primary" onClick={() => void signInWithPopup(auth!, googleProvider!)}>使用 Google 登入</button></main>;

  return <TargetsContext.Provider value={targetState}><main className="app-shell">
    <aside className="sidebar"><div className="brand"><i>n</i><span>日常營養</span></div><p className="side-date">飲食、體重與喝水，都會安全地儲存在你的帳號。</p><Nav view={view} setView={setView} /><div className="profile"><div>{(user.displayName ?? user.email ?? "你").slice(0, 1)}</div><span>{user.displayName ?? "我的帳號"}<small>{user.email}</small></span><button className="text-button" onClick={() => void signOut(auth!)}>登出</button></div></aside>
    <section className="content">
      <div className="mobile-topbar"><div className="brand"><i>n</i><span>日常營養</span></div><button className="text-button" onClick={() => void signOut(auth!)}>登出</button></div>
      {view === "daily" && <DailyView date={date} setDate={setDate} totals={totals} entries={entries} waterMl={waterMl} weightKg={weightKg} loading={loading} notice={notice} savedFoods={savedFoods} setEntryEditor={setEntryEditor} deleteEntry={deleteEntry} saveAsCommon={saveAsCommon} addWater={addWater} quickAddDrink={quickAddDrink} updateWeight={updateWeight} exportData={openExport} />}
      {view === "overview" && <Overview history={history} openDate={next => { setDate(next); setView("daily"); }} exportData={openExport} />}
      {view === "trends" && <Trends history={history} />}
      {view === "foods" && <FoodLibrary foods={savedFoods} add={() => setFoodEditor(null)} edit={setFoodEditor} remove={deleteFood} applySuggestedHydration={applySuggestedHydration} />}
      {view === "settings" && <TargetsSettings initial={targetState} save={async next => { if (!user) return; await saveHealthTargets(user.uid, { calorieTarget: next.caloriesKcal, proteinTarget: next.proteinG, carbTarget: next.carbsG, fatTarget: next.fatG, waterTargetMl: next.waterMl, fiberTarget: next.fiberG, sodiumLimit: next.sodiumMg }); setTargets(next); setNotice("已更新每日目標。"); }} />}
    </section>
    {entryEditor !== undefined && <EntryEditor initial={entryEditor} savedFoods={savedFoods} close={() => setEntryEditor(undefined)} save={saveDailyEntry} />}
    {foodEditor !== undefined && <SavedFoodEditor initial={foodEditor} close={() => setFoodEditor(undefined)} save={saveFood} />}
    {exporting && <ExportSheet close={() => setExporting(false)} exportRecords={exportRecords} copyAnalysis={copyChatGPTAnalysis} analysisReady={Boolean(analysisTexts[1])} analysisPreparing={analysisPreparing} />}
    <Nav view={view} setView={setView} mobile />
  </main></TargetsContext.Provider>;
}

function FoodMark() { return <svg className="food-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5v5a3 3 0 0 0 6 0V5M7 5v15M15 4v16M15 4c3 1 4 3 4 6v3h-4" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function NavMark({ id }: { id: View }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (id === "daily") return <svg className="nav-mark" viewBox="0 0 24 24" aria-hidden="true" {...common}><circle cx="12" cy="12" r="8" /><path d="m8.5 12 2.3 2.3 4.8-4.9" /></svg>;
  if (id === "overview") return <svg className="nav-mark" viewBox="0 0 24 24" aria-hidden="true" {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>;
  if (id === "trends") return <svg className="nav-mark" viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="m4 17 5-5 3 3 7-8" /><path d="M15 7h4v4" /></svg>;
  if (id === "foods") return <svg className="nav-mark" viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 5v5a3 3 0 0 0 6 0V5M7 5v15M15 4v16M15 4c3 1 4 3 4 6v3h-4" /></svg>;
  return <svg className="nav-mark" viewBox="0 0 24 24" aria-hidden="true" {...common}><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="7" cy="17" r="1.7" /></svg>;
}
function Nav({ view, setView, mobile = false }: { view: View; setView: (view: View) => void; mobile?: boolean }) { const items: { id: View; label: string }[] = [{ id: "daily", label: "每日" }, { id: "overview", label: "總覽" }, { id: "trends", label: "趨勢" }, { id: "foods", label: "食物" }, { id: "settings", label: "目標" }]; return <nav className={mobile ? "bottom-nav" : "side-nav"} aria-label="主要功能">{items.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><b><NavMark id={item.id} /></b><span>{mobile ? item.label : item.id === "foods" ? "我的食物" : `　${item.label}${item.id === "daily" ? "紀錄" : ""}`}</span></button>)}</nav>; }
function SetupScreen() { return <main className="setup"><p className="eyebrow">需要連接 Firebase</p><h1>日常營養準備好了。</h1><p>請先設定 Firebase 後重新部署。</p></main>; }
function entryNutrition(entry: FoodEntry): Nutrition { const { caloriesKcal, proteinG, carbsG, fatG, fiberG, sugarG, saturatedFatG, transFatG, sodiumMg, potassiumMg, cholesterolMg, caffeineMg } = entry; return { caloriesKcal, proteinG, carbsG, fatG, fiberG, sugarG, saturatedFatG, transFatG, sodiumMg, potassiumMg, cholesterolMg, caffeineMg }; }
function summaryLine(total: Nutrition) { return `熱量 ${formatNutrition(total.caloriesKcal, "kcal")}｜蛋白質 ${formatNutrition(total.proteinG, "g")}｜碳水 ${formatNutrition(total.carbsG, "g")}｜脂肪 ${formatNutrition(total.fatG, "g")}｜纖維 ${formatNutrition(total.fiberG, "g")}｜鈉 ${formatNutrition(total.sodiumMg, "mg")}`; }
async function copyPlainText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Safari can reject Clipboard API access despite HTTPS; use the fallback below. */ }
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function DailyView({ date, setDate, totals, entries, waterMl, weightKg, loading, notice, savedFoods, setEntryEditor, deleteEntry, saveAsCommon, addWater, quickAddDrink, updateWeight, exportData }: { date: string; setDate: (value: string) => void; totals: Nutrition; entries: FoodEntry[]; waterMl: number; weightKg?: number; loading: boolean; notice: string; savedFoods: SavedFoodSummary[]; setEntryEditor: (entry: EditorState) => void; deleteEntry: (id: string) => Promise<void>; saveAsCommon: (entry: FoodEntry) => Promise<void>; addWater: (amount: number) => Promise<void>; quickAddDrink: (food: SavedFoodSummary) => Promise<void>; updateWeight: (value: string) => Promise<void>; exportData: () => void }) {
  const targets = useContext(TargetsContext);
  const previous = () => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() - 86400000)));
  const next = () => setDate(formatLocalDate(new Date(new Date(`${date}T12:00:00`).getTime() + 86400000)));
  const hydration = calculateHydrationSummary(entries, waterMl);
  const quickDrinks = [...savedFoods].sort((left, right) => right.useCount - left.useCount).slice(0, 5);
  const hydratingEntries = entries.filter(entry => entry.hydrationMl > 0);
  return <>
    <div className="date-bar"><button onClick={previous}><b>‹ 前一天</b></button><label>指定日期<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button onClick={next}><b>後一天 ›</b></button></div>
    <header><div><p className="eyebrow">DAILY LOG</p><h1>{date === formatLocalDate(new Date()) ? "今天，好好吃飯。" : `${dateLabel(date)}的飲食紀錄`}</h1><p className="muted">營養欄位以每份紀錄，總計會依食用份數換算。</p></div><div className="header-actions"><button className="copy-btn" onClick={exportData}>匯出資料</button><button className="primary" onClick={() => setEntryEditor(null)}>＋ 新增紀錄</button></div></header>
    {notice && <p className="notice">{notice}</p>}
    <DailyGuidance totals={totals} waterMl={hydration.totalWaterMl} entries={entries} weightKg={weightKg} />
    <section className="hero-card"><div><p>今日熱量</p><div className="calorie"><strong>{Math.round(totals.caloriesKcal)}</strong><span> / {targets.caloriesKcal} kcal</span></div><div className="meter"><i style={{ width: `${Math.min(100, totals.caloriesKcal / targets.caloriesKcal * 100)}%` }} /></div><p className={totals.caloriesKcal > targets.caloriesKcal ? "over" : "remaining"}>{totals.caloriesKcal > targets.caloriesKcal ? `超出 ${Math.round(totals.caloriesKcal - targets.caloriesKcal)} kcal` : `剩餘 ${Math.round(targets.caloriesKcal - totals.caloriesKcal)} kcal`}</p></div><div className="weight"><span>當日紀錄</span><strong>{entries.length} <small>項</small></strong><p>纖維 {formatNutrition(totals.fiberG, "g")} · 鈉 {formatNutrition(totals.sodiumMg, "mg")}</p></div></section>
    <section className="macro-row"><Metric label="蛋白質" value={totals.proteinG} target={targets.proteinG} /><Metric label="碳水" value={totals.carbsG} target={targets.carbsG} /><Metric label="脂肪" value={totals.fatG} target={targets.fatG} /><div className="water"><span>水分（含飲品）</span><strong>{hydration.totalWaterMl} <small>ml</small></strong><p className="water-breakdown">白水 {hydration.plainWaterMl} ml ・ 飲品 {hydration.beverageWaterMl} ml</p><div className="meter water-meter"><i style={{ width: `${Math.min(100, hydration.totalWaterMl / targets.waterMl * 100)}%` }} /></div><div className="quick-row"><button onClick={() => void addWater(250)}>＋250 ml</button><button onClick={() => void addWater(500)}>＋500 ml</button></div>{quickDrinks.length > 0 && <div className="drink-shortcuts"><span>快速加入常用食物</span><div>{quickDrinks.map(food => <button key={food.id} onClick={() => void quickAddDrink(food)}>＋ {food.name}{food.hydrationMlPerServing > 0 && <small>{Math.round(food.hydrationMlPerServing)} ml</small>}</button>)}</div></div>}{hydratingEntries.length > 0 && <details className="hydration-details"><summary>查看水分明細</summary><div><p>白水 <b>{hydration.plainWaterMl} ml</b></p>{hydratingEntries.map(entry => <p key={entry.id}>{entry.name} <b>{Math.round(entry.hydrationMl)} ml</b></p>)}</div></details>}</div></section>
    <section className="daily-secondary"><b>纖維 {formatNutrition(totals.fiberG, "g")}</b><b>糖 {formatNutrition(totals.sugarG, "g")}</b><b>飽和脂肪 {formatNutrition(totals.saturatedFatG, "g")}</b><b>咖啡因 {formatNutrition(totals.caffeineMg, "mg")}</b><b>鉀 {formatNutrition(totals.potassiumMg, "mg")}</b><b>膽固醇 {formatNutrition(totals.cholesterolMg, "mg")}</b></section>
    <section className="quick-row"><label className="weight-input">體重（kg）<input type="number" inputMode="decimal" min="1" step="0.1" defaultValue={weightKg} key={`${date}-${weightKg}`} onBlur={event => void updateWeight(event.target.value)} /></label></section>
    <div className="section-heading"><div><h2>{loading ? "載入中…" : "今天吃了什麼"}</h2><p>修改單次紀錄不會影響常用食物。</p></div></div><EntryList entries={entries} edit={setEntryEditor} remove={deleteEntry} saveAsCommon={saveAsCommon} />
  </>;
}
function Metric({ label, value, target }: { label: string; value: number; target: number }) { return <div className="ring-wrap"><div className="ring" style={{ background: `conic-gradient(var(--sage) ${Math.min(100, value / target * 100)}%,var(--ring-track) 0)` }}><div className="ring-hole"><strong>{Math.round(value)}</strong><span>/{target}g</span></div></div><span>{label}</span></div>; }
function DailyGuidance({ totals, waterMl, entries, weightKg }: { totals: Nutrition; waterMl: number; entries: FoodEntry[]; weightKg?: number }) {
  const targets = useContext(TargetsContext);
  const reminders: string[] = [];
  if (!entries.length) reminders.push("今天尚未登記食物。");
  if (waterMl < targets.waterMl) reminders.push(`水分還差 ${Math.max(0, targets.waterMl - waterMl)} ml。`);
  if (totals.proteinG < targets.proteinG) reminders.push(`蛋白質距離目標還差 ${Math.round(targets.proteinG - totals.proteinG)} g。`);
  if (entries.length && totals.fiberG < 25) reminders.push(`纖維目前 ${formatNutrition(totals.fiberG, "g")}；可補一份蔬果或全穀。`);
  if (totals.sodiumMg > 2000) reminders.push(`鈉已達 ${formatNutrition(totals.sodiumMg, "mg")}；下一餐建議少湯、少醬。`);
  if (weightKg === undefined) reminders.push("尚未登記今天體重。");
  return reminders.length ? <details className="daily-guidance"><summary>今日提醒 <small>{reminders.length}</small></summary><ul>{reminders.slice(0, 3).map(reminder => <li key={reminder}>{reminder}</li>)}</ul></details> : null;
}
function EntryList({ entries, edit, remove, saveAsCommon }: { entries: FoodEntry[]; edit: (entry: FoodEntry) => void; remove: (id: string) => Promise<void>; saveAsCommon: (entry: FoodEntry) => Promise<void> }) {
  const groups = meals.map(meal => ({ meal, entries: entries.filter(entry => entry.mealType === meal) })).filter(group => group.entries.length);
  const renderEntry = (entry: FoodEntry) => { const total = totalForEntry(entry); return <article className="entry" key={entry.id}><div className="food-icon"><FoodMark /></div><div><b>{entry.name}</b><p>{entry.time !== "現在" ? `${entry.time} · ` : ""}{entry.servings} 份{entry.brand ? ` · ${entry.brand}` : ""}</p></div><div className="entry-nutrition"><b>{Math.round(total.caloriesKcal)} <small>kcal</small></b><span>P {formatNutrition(total.proteinG, "g")}　C {formatNutrition(total.carbsG, "g")}　F {formatNutrition(total.fatG, "g")}</span></div><div className="entry-actions"><button onClick={() => void saveAsCommon(entry)}>常用</button><button onClick={() => edit(entry)}>編輯</button><button onClick={() => void remove(entry.id)}>刪除</button></div></article>; };
  return <section className="entry-list">{entries.length ? groups.map(group => <section className="meal-group" key={group.meal}><div className="meal-group-heading"><span>{group.meal}</span><small>{group.entries.length} 項</small></div>{group.entries.map(renderEntry)}</section>) : <p className="empty">今天還沒有飲食紀錄。可直接新增一筆，或傳訊息給 Hermes。</p>}</section>;
}
function Overview({ history, openDate, exportData }: { history: DailyOverview[]; openDate: (date: string) => void; exportData: () => void }) { return <><header><div><p className="eyebrow">DAILY OVERVIEW</p><h1>每一日，都有脈絡。</h1><p className="muted">顯示已紀錄日期；點選任一列回到完整明細。</p></div><button className="copy-btn" onClick={exportData}>匯出資料</button></header><div className="table-wrap"><table><thead><tr><th>日期</th><th>熱量</th><th>蛋白質</th><th>碳水／脂肪</th><th>纖維／鈉</th><th>飲水</th><th></th></tr></thead><tbody>{history.length ? history.map(day => <tr key={day.date}><td><b>{dateLabel(day.date)}</b><small>{day.entries.length} 項食物紀錄</small></td><td>{formatNutrition(day.total.caloriesKcal, "kcal")}</td><td>{formatNutrition(day.total.proteinG, "g")}</td><td>{formatNutrition(day.total.carbsG, "g")} ／ {formatNutrition(day.total.fatG, "g")}</td><td>{formatNutrition(day.total.fiberG, "g")} ／ {formatNutrition(day.total.sodiumMg, "mg")}</td><td>{day.waterMl} ml</td><td><button className="table-edit" onClick={() => openDate(day.date)}>查看</button></td></tr>) : <tr><td colSpan={7}>還沒有可彙整的紀錄。</td></tr>}</tbody></table></div></> }
function Trends({ history }: { history: DailyOverview[] }) {
  const targets = useContext(TargetsContext);
  const today = formatLocalDate(new Date());
  const start = formatLocalDate(new Date(new Date(`${today}T12:00:00`).getTime() - 6 * 86400000));
  const days = history.filter(day => day.date >= start && day.date <= today).sort((left, right) => left.date.localeCompare(right.date));
  const timeline = Array.from({ length: 7 }, (_, index) => {
    const date = formatLocalDate(new Date(new Date(`${start}T12:00:00`).getTime() + index * 86400000));
    return { date, day: days.find(day => day.date === date) };
  });
  const average = (key: keyof Nutrition) => days.length ? days.reduce((sum, day) => sum + Number(day.total[key] ?? 0), 0) / days.length : 0;
  const completed = (predicate: (day: DailyOverview) => boolean) => days.filter(predicate).length;
  const weightAverage = calculateSevenDayAverage(days.map(day => day.weightKg ?? null));
  return <>
    <header><div><p className="eyebrow">WEEKLY REPORT</p><h1>這一週，走得怎麼樣？</h1><p className="muted">最近 7 天中已有 {days.length} 天紀錄；平均只計入已記錄的日期。</p></div></header>
    {!days.length ? <p className="empty">最近 7 天尚無可分析的紀錄。</p> : <>
      <section className="trend-card weekly-summary"><div><div><p>平均熱量</p><h2>{formatNutrition(average("caloriesKcal"), "kcal")}</h2></div><div><p>平均蛋白質</p><h2>{formatNutrition(average("proteinG"), "g")}</h2></div><div><p>平均纖維</p><h2>{formatNutrition(average("fiberG"), "g")}</h2></div><div><p>平均鈉</p><h2>{formatNutrition(average("sodiumMg"), "mg")}</h2></div><div><p>平均水分</p><h2>{Math.round(days.reduce((sum, day) => sum + day.waterMl, 0) / days.length)} <small>ml</small></h2></div><div><p>體重 7 日平均</p><h2>{weightAverage ?? "—"} <small>{weightAverage === null ? "未記錄" : "kg"}</small></h2></div></div></section>
      <section className="weekly-goals"><h2>目標達成率</h2><div><GoalProgress label={`蛋白質 ≥ ${targets.proteinG} g`} value={completed(day => day.total.proteinG >= targets.proteinG)} total={days.length} /><GoalProgress label={`水分 ≥ ${targets.waterMl} ml`} value={completed(day => day.waterMl >= targets.waterMl)} total={days.length} /><GoalProgress label={`纖維 ≥ ${targets.fiberG} g`} value={completed(day => day.total.fiberG >= targets.fiberG)} total={days.length} /><GoalProgress label={`鈉 ≤ ${targets.sodiumMg} mg`} value={completed(day => day.total.sodiumMg <= targets.sodiumMg)} total={days.length} /></div></section>
      <section className="weekly-trends"><div className="weekly-trends-heading"><div><h2>7 日變化</h2><p>空白日期會顯示為「—」，不會當作 0 計算。</p></div></div><div className="weekly-trends-grid"><TrendSparkline label="體重" unit="kg" points={timeline.map(point => ({ date: point.date, value: point.day?.weightKg ?? null }))} /><TrendSparkline label="水分" unit="ml" target={targets.waterMl} points={timeline.map(point => ({ date: point.date, value: point.day?.waterMl ?? null }))} /><TrendSparkline label="蛋白質" unit="g" target={targets.proteinG} points={timeline.map(point => ({ date: point.date, value: point.day?.total.proteinG ?? null }))} /></div></section>
      <section className="trend-card"><h2>每日熱量與蛋白質</h2><div className="nutrition-bars">{days.map(day => <div key={day.date}><div className="bar-pair"><i style={{ height: `${Math.min(100, day.total.caloriesKcal / targets.caloriesKcal * 100)}%` }} /><em style={{ height: `${Math.min(100, day.total.proteinG / targets.proteinG * 100)}%` }} /></div><span>{day.date.slice(5)}</span><b>{Math.round(day.total.caloriesKcal)}</b></div>)}</div><p className="legend"><i /> 熱量　<em /> 蛋白質</p></section>
    </>}
  </>;
}
type TrendPoint = { date: string; value: number | null };
function TrendSparkline({ label, unit, points, target }: { label: string; unit: "kg" | "ml" | "g"; points: TrendPoint[]; target?: number }) {
  const values = points.flatMap(point => point.value === null || !Number.isFinite(point.value) ? [] : [point.value]);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const bounds = target === undefined ? values : [...values, target];
  const baseMin = bounds.length ? Math.min(...bounds) : 0;
  const baseMax = bounds.length ? Math.max(...bounds) : 1;
  const padding = baseMin === baseMax ? (unit === "kg" ? 0.5 : Math.max(1, baseMax * 0.1)) : 0;
  const min = baseMin - padding;
  const max = baseMax + padding;
  const range = Math.max(1, max - min);
  const x = (index: number) => points.length > 1 ? 14 + index / (points.length - 1) * 322 : 175;
  const y = (value: number) => 88 - (value - min) / range * 76;
  const path = points.reduce((result, point, index) => {
    if (point.value === null || !Number.isFinite(point.value)) return { path: result.path, connected: false };
    const command = result.connected ? "L" : "M";
    return { path: `${result.path}${result.path ? " " : ""}${command}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`, connected: true };
  }, { path: "", connected: false }).path;
  const valueText = (value: number) => unit === "kg" ? (Math.round(value * 10) / 10).toFixed(1) : String(Math.round(value));
  const enoughForTrend = values.length >= 3;
  return <article className="trend-sparkline"><div className="trend-sparkline-title"><div><b>{label} 7 日平均</b><strong>{average === null ? "—" : valueText(average)} <small>{unit}</small></strong></div>{target !== undefined && <span>目標 {valueText(target)} {unit}</span>}</div>{enoughForTrend ? <><svg viewBox="0 0 350 100" role="img" aria-label={`${label}最近 7 天趨勢`}><path className="spark-grid" d="M14 12H336M14 50H336M14 88H336" />{target !== undefined && <path className="spark-target" d={`M14 ${y(target).toFixed(1)}H336`} />}<path className="spark-line" d={path} />{points.map((point, index) => point.value === null ? null : <circle key={point.date} className="spark-dot" cx={x(index)} cy={y(point.value)} r="3.1" />)}</svg><div className="spark-labels">{points.map(point => <span key={point.date}>{point.date.slice(8)}<b>{point.value === null ? "—" : valueText(point.value)}</b></span>)}</div></> : <p className="spark-empty">{values.length ? `已有 ${values.length} 筆${label}；累積至 3 筆後顯示走勢` : `尚無${label}紀錄`}</p>}</article>;
}
function GoalProgress({ label, value, total }: { label: string; value: number; total: number }) { return <article><div><b>{label}</b><span>{value} / {total} 天</span></div><div className="goal-meter"><i style={{ width: `${total ? value / total * 100 : 0}%` }} /></div></article>; }
function TargetsSettings({ initial, save }: { initial: HealthTargets; save: (targets: HealthTargets) => Promise<void> }) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const fields: { key: keyof HealthTargets; label: string; unit: string }[] = [{ key: "caloriesKcal", label: "每日熱量", unit: "kcal" }, { key: "proteinG", label: "蛋白質", unit: "g" }, { key: "carbsG", label: "碳水", unit: "g" }, { key: "fatG", label: "脂肪", unit: "g" }, { key: "waterMl", label: "飲水", unit: "ml" }, { key: "fiberG", label: "纖維", unit: "g" }, { key: "sodiumMg", label: "鈉上限", unit: "mg" }];
  return <><header><div><p className="eyebrow">MY TARGETS</p><h1>你的目標，由你決定。</h1><p className="muted">設定後會套用到每日卡片、提醒、週報與匯出資料。</p></div></header><section className="targets-card"><div className="form-grid">{fields.map(field => <label key={field.key}>{field.label} {field.unit}<input type="number" inputMode="decimal" min="0" step="any" value={values[field.key]} onChange={event => { const value = parseNonNegativeNumber(event.target.value); if (value !== null) setValues({ ...values, [field.key]: value }); }} /></label>)}</div><button className="save-btn" disabled={saving} onClick={() => { setSaving(true); void save(values).finally(() => setSaving(false)); }}>{saving ? "儲存中…" : "儲存每日目標"}</button></section></>;
}
const hydrationSuggestionFor = (food: SavedFoodSummary): number | null => {
  const text = `${food.name} ${food.brand ?? ""}`.toLowerCase();
  if (text.includes("coke zero") || text.includes("可樂 zero") || text.includes("可口可樂 zero")) return 330;
  if (text.includes("黑豆漿") || text.includes("無糖豆漿")) return 400;
  if (text.includes("美式") || text.includes("americano")) return 350;
  return null;
};
function FoodLibrary({ foods, add, edit, remove, applySuggestedHydration }: { foods: SavedFoodSummary[]; add: () => void; edit: (food: SavedFoodInput) => void; remove: (id: string) => Promise<void>; applySuggestedHydration: (food: SavedFoodSummary, hydrationMl: number) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [showDrinksOnly, setShowDrinksOnly] = useState(false);
  const visible = foods.filter(food => `${food.name} ${food.brand ?? ""} ${food.category ?? ""}`.toLowerCase().includes(query.toLowerCase())).filter(food => !showDrinksOnly || food.category === "飲料" || hydrationSuggestionFor(food) !== null || food.hydrationMlPerServing > 0);
  const missingHydration = foods.filter(food => food.hydrationMlPerServing === 0 && hydrationSuggestionFor(food) !== null);
  return <>
    <header><div><p className="eyebrow">MY FOODS</p><h1>常用食物，慢慢累積。</h1><p className="muted">可新增、修改、刪除，並在新增紀錄時套用。</p></div><button className="primary" onClick={add}>＋ 新增食物</button></header>
    {missingHydration.length > 0 && <section className="hydration-reminder"><b>有 {missingHydration.length} 項常用飲品尚未設定水分</b><p>套用後，手動與 Hermes 登記都會自動計入每日水分。</p><div>{missingHydration.map(food => { const suggestion = hydrationSuggestionFor(food); return suggestion === null ? null : <button key={food.id} onClick={() => void applySuggestedHydration(food, suggestion)}>設定「{food.name}」為 {suggestion} ml</button>; })}</div></section>}
    <div className="library-toolbar"><input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋名稱、品牌或分類" /><button className={showDrinksOnly ? "active" : ""} onClick={() => setShowDrinksOnly(!showDrinksOnly)}>飲品</button></div>
    <section className="food-library">{visible.length ? visible.map(food => <article key={food.id}><div className="food-icon"><FoodMark /></div><div><b>{food.name}</b><p>{food.brand ? `${food.brand} · ` : ""}{food.category ?? "未分類"} · P {formatNutrition(food.nutrition.proteinG, "g")}{food.hydrationMlPerServing > 0 ? ` · 水分 ${Math.round(food.hydrationMlPerServing)} ml` : ""}</p></div><span>{formatNutrition(food.nutrition.caloriesKcal, "kcal")}</span><button onClick={() => edit(food)}>編輯</button><button aria-label={`刪除 ${food.name}`} onClick={() => void remove(food.id)}>×</button></article>) : <p className="empty">尚無符合的常用食物。</p>}</section>
  </>;
}

type NumericKey = keyof Nutrition | "servings" | "consumedPercent" | "servingWeightG" | "hydrationMl";
const primaryKeys: { key: NumericKey; label: string; optional?: boolean }[] = [{ key: "caloriesKcal", label: "熱量 kcal" }, { key: "proteinG", label: "蛋白質 g" }, { key: "carbsG", label: "碳水 g" }, { key: "fatG", label: "脂肪 g" }, { key: "fiberG", label: "纖維 g" }, { key: "sodiumMg", label: "鈉 mg" }];
const otherKeys: { key: NumericKey; label: string; optional?: boolean }[] = [{ key: "sugarG", label: "糖 g" }, { key: "saturatedFatG", label: "飽和脂肪 g" }, { key: "caffeineMg", label: "咖啡因 mg" }, { key: "transFatG", label: "反式脂肪 g", optional: true }, { key: "cholesterolMg", label: "膽固醇 mg", optional: true }, { key: "potassiumMg", label: "鉀 mg", optional: true }];
type Draft = { name: string; brand: string; category: string; mealType: MealType; notes: string; sourceFoodId: string | null; values: Record<NumericKey, string> };
const draftFrom = (entry?: FoodEntry, saved?: SavedFoodInput): Draft => { const source = entry ?? (saved ? { ...saved, mealType: "其他" as MealType, servings: 1, consumedPercent: 100, hydrationMl: saved.hydrationMlPerServing, time: nowTime(), ...saved.nutrition } : undefined); const nutrition = source ? entryNutrition(source as FoodEntry) : emptyNutrition(); const numeric = (value: number | null | undefined) => value === null || value === undefined ? "" : String(value); return { name: source?.name ?? "", brand: source?.brand ?? "", category: source?.category ?? "", mealType: (source?.mealType ?? "點心") as MealType, notes: source?.notes ?? "", sourceFoodId: entry?.sourceFoodId ?? saved?.id ?? null, values: { caloriesKcal: numeric(nutrition.caloriesKcal), proteinG: numeric(nutrition.proteinG), carbsG: numeric(nutrition.carbsG), fatG: numeric(nutrition.fatG), fiberG: numeric(nutrition.fiberG), sugarG: numeric(nutrition.sugarG), saturatedFatG: numeric(nutrition.saturatedFatG), transFatG: numeric(nutrition.transFatG), sodiumMg: numeric(nutrition.sodiumMg), potassiumMg: numeric(nutrition.potassiumMg), cholesterolMg: numeric(nutrition.cholesterolMg), caffeineMg: numeric(nutrition.caffeineMg), servings: numeric((source as FoodEntry | undefined)?.servings ?? 1), consumedPercent: numeric((source as FoodEntry | undefined)?.consumedPercent ?? 100), servingWeightG: numeric((source as FoodEntry | undefined)?.servingWeightG ?? saved?.servingWeightG), hydrationMl: numeric((source as FoodEntry | undefined)?.hydrationMl ?? 0) } }; };
function FoodFields({ draft, setDraft, includeMeal, savedFoods, applySaved, hydrationLabel }: { draft: Draft; setDraft: (next: Draft) => void; includeMeal: boolean; savedFoods?: SavedFoodSummary[]; applySaved?: (food: SavedFoodSummary) => void; hydrationLabel: string }) {
  const [advanced, setAdvanced] = useState(false);
  const updateValue = (key: NumericKey, value: string) => setDraft({ ...draft, values: { ...draft.values, [key]: value } });
  const updateServings = (value: string) => {
    const previousServings = parseNonNegativeNumber(draft.values.servings) ?? 0;
    const nextServings = parseNonNegativeNumber(value) ?? 0;
    const previousHydration = parseNonNegativeNumber(draft.values.hydrationMl) ?? 0;
    const hydrationMl = previousServings > 0 ? Math.round(previousHydration / previousServings * nextServings * 10) / 10 : previousHydration;
    setDraft({ ...draft, values: { ...draft.values, servings: value, hydrationMl: String(hydrationMl) } });
  };
  const updateConsumedPercent = (value: string) => {
    const previousPercent = parseNonNegativeNumber(draft.values.consumedPercent) ?? 100;
    const nextPercent = parseNonNegativeNumber(value) ?? 0;
    const previousHydration = parseNonNegativeNumber(draft.values.hydrationMl) ?? 0;
    const hydrationMl = previousPercent > 0 ? Math.round(previousHydration / previousPercent * nextPercent * 10) / 10 : previousHydration;
    setDraft({ ...draft, values: { ...draft.values, consumedPercent: value, hydrationMl: String(hydrationMl) } });
  };
  const input = (item: { key: NumericKey; label: string; optional?: boolean }) => <label key={item.key}>{item.label}<input type="number" inputMode="decimal" min="0" step="any" value={draft.values[item.key]} onChange={event => updateValue(item.key, event.target.value)} placeholder={item.optional ? "選填" : "0"} /></label>;
  return <>
    <section className="form-section"><h3>基本資料</h3>{savedFoods && <label>套用常用食物<select value="" onChange={event => { const food = savedFoods.find(item => item.id === event.target.value); if (food) applySaved?.(food); }}><option value="">選擇後自動填入</option>{savedFoods.map(food => <option key={food.id} value={food.id}>{food.name}{food.brand ? ` · ${food.brand}` : ""}</option>)}</select></label>}<div className="form-grid"><label>食物名稱<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>品牌（選填）<input value={draft.brand} onChange={event => setDraft({ ...draft, brand: event.target.value })} /></label><label>食物分類<select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}><option value="">未分類</option>{foodCategories.map(category => <option key={category}>{category}</option>)}</select></label>{includeMeal && <label>餐次<select value={draft.mealType} onChange={event => setDraft({ ...draft, mealType: event.target.value as MealType })}>{meals.map(meal => <option key={meal}>{meal}</option>)}</select></label>}<label>食用份數<input type="number" inputMode="decimal" min="0.1" step="any" value={draft.values.servings} onChange={event => updateServings(event.target.value)} /></label>{includeMeal && <label>吃完比例<select value={draft.values.consumedPercent} onChange={event => updateConsumedPercent(event.target.value)}>{[100, 75, 50, 25].map(percent => <option key={percent} value={percent}>{percent}%</option>)}</select></label>}<label>每份重量 g（選填）<input type="number" inputMode="decimal" min="0" step="any" value={draft.values.servingWeightG} onChange={event => updateValue("servingWeightG", event.target.value)} /></label><label>{hydrationLabel}<input type="number" inputMode="decimal" min="0" step="any" value={draft.values.hydrationMl} onChange={event => updateValue("hydrationMl", event.target.value)} placeholder="0" /></label></div></section>
    <section className="form-section"><h3>主要營養 <small>每份</small></h3><div className="form-grid">{primaryKeys.map(input)}</div></section>
    <section className="form-section"><button className="advanced-toggle" type="button" onClick={() => setAdvanced(!advanced)}>其他營養 {advanced ? "收合" : "展開"}</button>{advanced && <div className="form-grid">{otherKeys.map(input)}</div>}</section>
    <section className="form-section"><h3>備註</h3><textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="例如：吃完、包裝標示、餐點估算依據" /></section>
  </>;
}
function parseDraft(draft: Draft): { nutrition: Nutrition; servings: number; consumedPercent: number; servingWeightG: number | null; hydrationMl: number; error?: string } { const servings = parseNonNegativeNumber(draft.values.servings); const consumedPercent = parseNonNegativeNumber(draft.values.consumedPercent); if (servings === null || servings <= 0) return { nutrition: emptyNutrition(), servings: 0, consumedPercent: 100, servingWeightG: null, hydrationMl: 0, error: "食用份數必須大於 0。" }; if (consumedPercent === null || consumedPercent <= 0 || consumedPercent > 100) return { nutrition: emptyNutrition(), servings, consumedPercent: 100, servingWeightG: null, hydrationMl: 0, error: "吃完比例必須介於 1% 到 100%。" }; const hydrationMl = parseNonNegativeNumber(draft.values.hydrationMl); if (hydrationMl === null) return { nutrition: emptyNutrition(), servings, consumedPercent, servingWeightG: null, hydrationMl: 0, error: "水分 ml 必須是有效的非負數。" }; const nutrition = emptyNutrition(); for (const item of [...primaryKeys, ...otherKeys]) { const value = parseNonNegativeNumber(draft.values[item.key]); if (value === null && !item.optional) return { nutrition, servings, consumedPercent, servingWeightG: null, hydrationMl, error: `${item.label} 必須是有效的非負數。` }; (nutrition as Record<string, number | null>)[item.key] = value; } return { nutrition, servings, consumedPercent, servingWeightG: parseNonNegativeNumber(draft.values.servingWeightG), hydrationMl }; }
function EntryEditor({ initial, savedFoods, close, save }: { initial: FoodEntry | null; savedFoods: SavedFoodSummary[]; close: () => void; save: (entry: FoodEntry) => Promise<void> }) { const [draft, setDraft] = useState(() => draftFrom(initial ?? undefined)); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const submit = async () => { if (!draft.name.trim()) return setError("食物名稱不可空白。"); const parsed = parseDraft(draft); if (parsed.error) return setError(parsed.error); setSaving(true); try { await save({ id: initial?.id ?? crypto.randomUUID(), name: draft.name.trim(), brand: draft.brand.trim() || null, category: draft.category || null, mealType: draft.mealType, servings: parsed.servings, consumedPercent: parsed.consumedPercent, servingWeightG: parsed.servingWeightG, ...parsed.nutrition, hydrationMl: parsed.hydrationMl, time: initial?.time ?? nowTime(), notes: draft.notes.trim() || null, ...(initial?.source ? { source: initial.source } : {}), ...(initial?.confidence ? { confidence: initial.confidence } : {}), ...(draft.sourceFoodId ? { sourceFoodId: draft.sourceFoodId } : {}) }); } finally { setSaving(false); } }; return <Sheet title={initial ? "修改這筆紀錄" : "新增這筆紀錄"} close={close}><FoodFields draft={draft} setDraft={setDraft} includeMeal savedFoods={savedFoods} applySaved={food => setDraft(draftFrom(undefined, food))} hydrationLabel="水分 ml（本次；份數會同步換算）" />{error && <p className="form-error">{error}</p>}<button className="save-btn" onClick={() => void submit()} disabled={saving}>{saving ? "儲存中…" : "儲存資料"}</button></Sheet> }
function SavedFoodEditor({ initial, close, save }: { initial: SavedFoodInput | null; close: () => void; save: (food: SavedFoodInput) => Promise<void> }) { const [draft, setDraft] = useState(() => draftFrom(undefined, initial ?? undefined)); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const submit = async () => { if (!draft.name.trim()) return setError("食物名稱不可空白。"); const parsed = parseDraft(draft); if (parsed.error) return setError(parsed.error); setSaving(true); try { await save({ id: initial?.id ?? crypto.randomUUID(), name: draft.name.trim(), brand: draft.brand.trim() || null, category: draft.category || null, servingWeightG: parsed.servingWeightG, hydrationMlPerServing: parsed.hydrationMl, nutrition: parsed.nutrition, favorite: initial?.favorite ?? true, notes: draft.notes.trim() || null }); } finally { setSaving(false); } }; return <Sheet title={initial ? "修改常用食物" : "新增常用食物"} close={close}><FoodFields draft={draft} setDraft={setDraft} includeMeal={false} hydrationLabel="每份水分 ml" />{error && <p className="form-error">{error}</p>}<button className="save-btn" onClick={() => void submit()} disabled={saving}>{saving ? "儲存中…" : "儲存食物"}</button></Sheet> }
function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="sheet-backdrop" onClick={close}><section className="sheet detail-sheet" onClick={event => event.stopPropagation()}><div className="grab" /><div className="sheet-title"><div><p className="eyebrow">DAILY LOG</p><h2>{title}</h2></div><button onClick={close}>×</button></div>{children}</section></div> }
function ExportSheet({ close, exportRecords, copyAnalysis, analysisReady, analysisPreparing }: { close: () => void; exportRecords: (start: string, end: string) => Promise<void>; copyAnalysis: (days: 1 | 3 | 7) => Promise<boolean>; analysisReady: boolean; analysisPreparing: boolean }) { const today = formatLocalDate(new Date()); const [start, setStart] = useState(formatLocalDate(new Date(new Date(`${today}T12:00:00`).getTime() - 6 * 86400000))); const [end, setEnd] = useState(today); const [working, setWorking] = useState(false); const download = async () => { setWorking(true); try { await exportRecords(start, end); } finally { setWorking(false); } }; const copy = (days: 1 | 3 | 7) => { void copyAnalysis(days); }; return <Sheet title="複製給 ChatGPT 分析" close={close}><p className="muted export-copy">先準備資料，再立即複製；這樣 iPhone Safari 可以正常運作。</p><div className="analysis-choices"><button className="save-btn" disabled={!analysisReady} onClick={() => copy(1)}>{analysisPreparing ? "正在準備資料…" : "複製今天資料＋分析指令"}</button><button className="parse-btn" disabled={!analysisReady} onClick={() => copy(3)}>複製最近 3 天資料＋分析指令</button><button className="parse-btn" disabled={!analysisReady} onClick={() => copy(7)}>複製最近 7 天資料＋分析指令</button></div><p className="export-divider">或下載完整資料</p><div className="form-grid"><label>開始日期<input type="date" value={start} onChange={event => setStart(event.target.value)} /></label><label>結束日期<input type="date" value={end} onChange={event => setEnd(event.target.value)} /></label></div><button className="parse-btn" disabled={working || start > end} onClick={() => void download()}>{working ? "準備中…" : "下載 JSON"}</button></Sheet> }
