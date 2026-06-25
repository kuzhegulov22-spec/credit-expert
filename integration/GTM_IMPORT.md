# Импорт в Google Tag Manager

Файл: **`gtm-container-credit-expert.json`** — готовый контейнер с Pixel и событиями.

## Что внутри

**Переменные (Data Layer):** `event_id`, `phone`, `name`, `funnel_type`, `is_eligible`,
`utm_source/medium/campaign/content/term`, `fbclid`, `gclid`.

**Триггеры:** `CE - lead_submit`, `CE - whatsapp_click`, `CE - quiz_start` + встроенный All Pages.

**Теги (Meta Pixel, Custom HTML):**

| Тег | Триггер | Событие |
|---|---|---|
| Meta Pixel - Base + PageView | All Pages | init + `PageView` |
| Meta Pixel - Lead | `lead_submit` | `Lead` c **`eventID = event_id`** (дедуп с CAPI) + advanced matching (`ph`, `fn`) |
| Meta Pixel - Contact (WhatsApp) | `whatsapp_click` | `Contact` |
| Meta Pixel - QuizStart (custom) | `quiz_start` | `trackCustom('QuizStart')` |

Pixel ID `1448492083750122` уже вшит в теги.

## Как импортировать

1. GTM → откройте контейнер **GTM-NXDMQN28**.
2. **Admin → Import Container**.
3. Choose container file → выберите `gtm-container-credit-expert.json`.
4. Workspace: **Existing → Default Workspace** (или новый).
5. Import option:
   - **Merge → Rename conflicting tags/triggers/variables** — безопасно, ничего не затрёт.
   - (Overwrite — только если контейнер пустой.)
6. **Confirm** → проверьте в Preview (расширение Tag Assistant), затем **Submit / Publish**.

## Проверка (Preview)

1. Откройте сайт через Preview-режим GTM.
2. Загрузка страницы → должен сработать **Meta Pixel - Base + PageView**.
3. Отправьте форму → событие `lead_submit` → срабатывает **Meta Pixel - Lead**.
4. В Meta Events Manager → Test Events: событие `Lead` приходит с заполненным `eventID`.
5. Если подключён сервер (Cloudflare Worker / Pipedream) — Browser + Server события
   по одному `event_id` показываются как **Deduplicated**.

## Дедупликация Pixel ⇄ CAPI

Браузерный тег `Lead` шлёт `eventID = {{DLV - event_id}}`.
Сервер (Worker/Pipedream) шлёт CAPI-событие `Lead` с тем же `event_id`.
Meta склеивает их по `event_name` + `event_id` — двойного счёта нет.

> Сервер нужен только для CAPI. Если решите обойтись без него — оставьте только
> теги Pixel из этого контейнера (браузерный трекинг будет работать и без сервера).
