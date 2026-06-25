# Кредитный Expert — лид-воронка

Статический лендинг + квиз с трекингом (GTM + Meta Pixel + Conversions API) и отправкой лидов в Telegram через Pipedream.

## Страницы

| Файл | Назначение |
|---|---|
| `index.html` | Простая форма (имя + телефон) |
| `quiz.html` | Квалифицирующий квиз (4 шага) → форма или дисквалификация (WhatsApp) |
| `thanks.html` | Спасибо-страница (учёт рабочего времени) |
| `assets/tracking.js` | Ядро трекинга: dataLayer, UTM/fbclid, event_id, fbp/fbc, отправка на webhook |
| `assets/style.css` | Стили |
| `META_CAPI_SETUP.md` | Настройка боевого Meta CAPI (GTM-тег + серверный шаг Pipedream) |

## Конфигурация

Все ключевые значения — в `assets/tracking.js` → `window.FUNNEL_CONFIG`:

- `gtmId` — контейнер GTM (`GTM-NXDMQN28`)
- `metaPixelId` — Pixel ID (`1448492083750122`), подключается через GTM
- `telegramWebhookUrl` — боевой Pipedream webhook (Telegram + CAPI)
- `telegramChatId` — чат менеджеров
- `whatsappUrl` — WhatsApp для дисквалифицированных
- `workHours` — рабочие часы для текста на спасибо-странице

## Безопасность

- Токенов/секретов в клиентском коде **нет**. Telegram bot token и CAPI access token живут в Pipedream.
- Страницы помечены `noindex,nofollow`.

## Деплой

Статика — публикуется как есть (GitHub Pages / любой статик-хостинг). Точка входа — `index.html`.

Боевой режим Meta CAPI — см. `META_CAPI_SETUP.md`.
