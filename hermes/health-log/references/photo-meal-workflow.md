# Photo meal workflow

Treat all 1–10 images attached to one Discord message as one meal dataset.

## Steps

1. Inspect every image once and classify it as package front, nutrition label, full meal, or leftovers/consumed fraction.
2. Prefer a readable package label. Preserve its per-serving nutrition and represent actual consumption with `servings` (for example 0.5 when half was eaten).
3. If only calories or weight are visible, preserve those label values and estimate only missing nutrients; mark the entry `ai_estimated / medium` and explain which fields were estimated.
4. Without a label, estimate visible ingredients and ordinary portions. Use `medium`; use `low` when portion or identity is materially uncertain.
5. Ask only one necessary question when ambiguity would substantially change the result, such as unknown consumed fraction or unknown drink volume.
6. Put all foods plus any white water from the same message into one `log_health_event` and use the Discord message ID for idempotency.
7. Use the returned `dailySummary`; do not perform a second summary call.

Do not use web search, browser automation, old conversations, or unrelated files for a photo meal when the current message already supplies enough evidence.

## Expiry dates

If a clear package expiry date is before the Asia/Taipei log date, still record what the user explicitly consumed. Add one short safety warning, but do not put “expired” in the food name or nutrition estimate.

## Completion criteria

- Every image used at most once
- One meal is not duplicated across package and food photos
- Label values are not overwritten by estimates
- Consumed fraction is represented by servings
- One composite write returns `ok: true` and `dailySummary`
