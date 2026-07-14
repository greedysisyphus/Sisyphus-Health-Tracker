export type TimestampValue = Date | { toDate(): Date };
export type FoodSource = "自建食物"|"自建食譜"|"包裝食品"|"外食估算"|"AI 估算"|"手動輸入";
export interface UserProfile { name:string; gender:"male"|"female"|"other"; heightCm:number; currentWeightKg:number; targetWeightKg:number; calorieTarget:number; proteinTarget:number; carbTarget:number; fatTarget:number; sugarLimit:number; fiberTarget:number; saturatedFatLimit:number; waterTargetMl:number; timezone:string; createdAt:TimestampValue; updatedAt:TimestampValue }
/** Canonical saved-food shape. Nutrition is always for one serving. */
export interface StoredFood {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  servingWeightG: number | null;
  nutrition: {
    caloriesKcal: number; proteinG: number; carbsG: number; fatG: number;
    fiberG: number; sugarG: number; saturatedFatG: number; transFatG: number | null;
    sodiumMg: number; potassiumMg: number | null; cholesterolMg: number | null; caffeineMg: number;
  };
  notes: string | null;
  favorite: boolean;
  useCount: number;
  lastUsedAt?: TimestampValue;
  createdAt: TimestampValue;
  updatedAt: TimestampValue;
}
export interface BodyLog { date:string; weightKg?:number; waistCm?:number; bodyFatPercent?:number; sleepHours?:number; steps?:number; note?:string; createdAt:TimestampValue; updatedAt:TimestampValue }
export interface DailyLog { date:string; waterMl?:number; weightKg?:number; steps?:number; sleepHours?:number; note?:string; createdAt:TimestampValue; updatedAt:TimestampValue }
