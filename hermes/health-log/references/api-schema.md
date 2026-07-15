# Health Agent API schema

## Composite write

Use `log_health_event` for every new Discord health event:

```json
{
  "action": "log_health_event",
  "date": "2026-07-15",
  "entries": [],
  "plainWaterMl": 500,
  "body": null,
  "idempotency": {
    "source": "discord",
    "eventId": "message-id",
    "operationKey": "health-event"
  }
}
```

At least one of `entries`, positive `plainWaterMl`, or `body` is required. The API writes the event atomically and returns `dailySummary`.

## Food entry

```json
{
  "name": "茶葉蛋",
  "brand": null,
  "category": "蛋類",
  "meal": "早餐",
  "servings": 2,
  "servingWeightG": 50,
  "hydrationMl": 0,
  "time": "現在",
  "source": "ai_estimated",
  "confidence": "medium",
  "notes": "每顆估算",
  "nutrition": {
    "calories": 70,
    "protein": 6,
    "carbs": 1,
    "fat": 5,
    "fiber": 0,
    "sugar": 0.5,
    "saturatedFat": 1.6,
    "transFat": null,
    "sodium": 300,
    "potassium": null,
    "cholesterol": null,
    "caffeine": 0
  }
}
```

Nutrition is always per serving. Units: kcal for calories; grams for protein/carbs/fat/fiber/sugar/saturatedFat/transFat; milligrams for sodium/potassium/cholesterol/caffeine.

## Daily summary response

```json
{
  "ok": true,
  "replayed": false,
  "dailySummary": {
    "caloriesKcal": 952,
    "proteinG": 55.5,
    "carbsG": 110.2,
    "fatG": 33.9,
    "fiberG": 2,
    "sugarG": 7.8,
    "saturatedFatG": 7.8,
    "transFatG": 0,
    "sodiumMg": 1731.4,
    "potassiumMg": 0,
    "cholesterolMg": 0,
    "caffeineMg": 120,
    "waterMl": 2500
  }
}
```

## Amendment allowlists

Standard mode allows only: `nutrition`, `servings`, `servingWeightG`, `source`, `confidence`, `notes`, `hydrationMl`.

`history_backfill` mode allows only: `nutrition`, `source`, `confidence`, `notes`.

Unknown keys are rejected. Optional fields omitted from `changes` remain unchanged; the server must not synthesize default hydration or overwrite unrelated fields.
