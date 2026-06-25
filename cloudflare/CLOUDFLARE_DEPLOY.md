# Деплой на Cloudflare Pages (всё на Cloudflare, без GitHub)

Один проект Cloudflare Pages = статика сайта + бэкенд (Pages Functions).
Фронт и бэкенд на одном домене → **CORS не нужен**, токены живут на сервере.

```
Браузер ──► /api/lead (Pages Function) ──► Telegram + Meta CAPI
   │
   └──► GTM ──► Meta Pixel (eventID = event_id)   ← дедуп Pixel ⇄ CAPI
```

## Структура проекта

```
.
├── index.html, quiz.html, thanks.html   ← статика
├── assets/  (style.css, tracking.js)     ← tracking.js шлёт на /api/lead
├── functions/api/lead.js                 ← бэкенд: Telegram + CAPI
└── wrangler.toml
```

## Вариант 1 — Дашборд (drag-and-drop, без Git и без CLI)

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Upload assets**.
2. Имя проекта: `credit-expert`. Загрузите содержимое папки (или zip `credit-expert-cloudflare.zip`).
3. После создания: **Settings → Environment variables → Production**, добавьте (Encrypt):
   - `TG_BOT_TOKEN`, `TG_CHAT_ID`, `META_PIXEL_ID` = `1448492083750122`, `META_CAPI_TOKEN`
   - (НЕ задавайте `META_TEST_EVENT_CODE` в бою)
4. **Retry deployment** (чтобы переменные применились).
5. Готово: сайт на `https://credit-expert.pages.dev`, бэкенд на `/api/lead`.

> Примечание: при загрузке через дашборд Functions из папки `functions/` подхватываются автоматически.

## Вариант 2 — Wrangler CLI (тоже без GitHub)

```bash
npm i -g wrangler
wrangler login
cd credit-expert            # папка проекта
wrangler pages deploy .     # создаст проект и зальёт
# секреты:
wrangler pages secret put TG_BOT_TOKEN
wrangler pages secret put TG_CHAT_ID
wrangler pages secret put META_PIXEL_ID
wrangler pages secret put META_CAPI_TOKEN
```

## Вариант 3 — Подключить GitHub-репозиторий (авто-деплой)

Если хотите оставить и GitHub: Pages → Create → **Connect to Git** → выбрать репозиторий
`kuzhegulov22-spec/credit-expert`. Build command: пусто, Output dir: `/`.
Каждый push в `main` будет авто-деплоиться.

## Свой домен

Pages → Custom domains → добавить домен (CNAME на `*.pages.dev`). HTTPS — автоматом.

## Проверка

1. Открыть сайт → отправить форму → лид в Telegram.
2. GET `https://<домен>/api/lead` → `{"ok":true,"endpoint":"lead",...}` (функция жива).
3. Events Manager → Test Events: `Lead` от Browser (Pixel) и Server (CAPI) с одним
   `event_id` → статус **Deduplicated**.

## Что с Pixel/GTM

GTM-контейнер (`integration/gtm-container-credit-expert.json`) импортируется так же —
он отвечает за браузерный Pixel и дедуп `eventID`. Серверная часть теперь в `/api/lead`.
