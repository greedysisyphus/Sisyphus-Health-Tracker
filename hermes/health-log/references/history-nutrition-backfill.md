# Historical nutrition backfill

Use this workflow to add nutrition to exact existing entries without changing log structure.

## Preflight

Read each day with `get_daily_summary` and capture:

- exact date, entry ID, name, meal and entry count
- servings / legacy quantity
- each drink or soup `hydrationMl`
- daily `waterMl`
- body data

Never create replacement foods merely to add nutrition.

## Nutrition

Populate complete per-serving nutrition. Keep package data as `nutrition_label / high`; otherwise use a reasonable ordinary-serving estimate and mark `ai_estimated / medium`, or `low` when the consumed amount is vague. Unknown trans fat, potassium and cholesterol may remain null. Estimate caffeine for coffee, chocolate drinks and caffeinated cola when no label exists, with appropriate confidence.

Legacy totals must be converted to per-serving values. Two eggs use `servings: 2` and one egg's nutrition; six dumplings use `servings: 6` and one dumpling's nutrition.

## Safe amendment

Use:

```json
{
  "action": "amend_food",
  "date": "2026-07-13",
  "entryId": "exact-id",
  "mode": "history_backfill",
  "changes": {
    "nutrition": {},
    "source": "ai_estimated",
    "confidence": "medium",
    "notes": "估算依據"
  }
}
```

History mode permits only nutrition, source, confidence and notes. Date, name, meal, servings, water and hydration are server-protected.

## Verification

After each day verify:

- entry count, IDs and names unchanged
- date, daily water, hydration and body data unchanged
- every intended entry has complete nutrition
- estimates carry source, confidence and assumptions
- daily totals reflect serving multiplication

Stop on the first API failure. Report entries supplemented and the daily calories, protein, carbs, fat, fiber, sugar, saturated fat, sodium, caffeine and water.
