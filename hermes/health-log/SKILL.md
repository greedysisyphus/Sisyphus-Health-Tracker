# Health log

Use this skill whenever the user records food, water, weight, sleep, steps, or asks to correct or analyse health records.

## Rules

1. Use `scripts/health_api.py` to call the health tracker API.
2. Use `Asia/Taipei` for dates. If the user does not specify a date, use today.
3. Prefer a package nutrition label. Restaurant information is second-best. Photos and restaurant meals without a label are estimates and must set `source` to `ai_estimated` and explain assumptions in the Discord response.
4. Before `amend_food` or `delete_food`, call `get_daily_summary`, identify the exact `entryId`, and tell the user which entry will change. Ask a follow-up question if more than one entry might match.
5. For a portion correction, recalculate calories, protein, carbs, fat, sugar, fiber, saturatedFat, and sodium for the final consumed portion before using `amend_food`.
6. After a successful write, call `get_daily_summary` and reply concisely in Traditional Chinese with the change and daily calories, protein, sodium, and water.
7. Never expose `HERMES_API_SECRET`, use browser automation, or send health data anywhere except `HEALTH_TRACKER_URL`.

## API actions

- `log_food`: add one or more meal entries.
- `amend_food`: change a known `entryId`.
- `delete_food`: delete a known `entryId` after confirmation.
- `upsert_food`: save a frequently used food to the personal food library.
- `log_water`: add water in millilitres; never overwrite a previous amount.
- `log_body`: log any provided weight, waist, body-fat percentage, sleep hours, steps, or note.
- `get_daily_summary`: read the source-of-truth daily entries and totals.

## Examples

```bash
printf '%s' '{"action":"log_water","date":"2026-07-14","addMl":500}' | python3 scripts/health_api.py
```

```bash
printf '%s' '{"action":"log_body","date":"2026-07-14","weightKg":74.2,"steps":6693}' | python3 scripts/health_api.py
```
