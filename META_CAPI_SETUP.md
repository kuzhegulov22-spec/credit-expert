# Meta CAPI — настройка боевого режима

Воронка «Кредитный Expert». Дедупликация Pixel ⇄ Conversions API построена на **едином `event_id`**:
браузер генерирует `event_id`, кладёт его в `dataLayer` (его подхватывает Meta Pixel в GTM)
и в payload на Pipedream (оттуда серверный CAPI шлёт событие с тем же `event_id`).
Meta склеивает дубли по `event_id` + `event_name`.

```
Браузер ──► dataLayer.lead_submit (event_id) ──► GTM ──► Meta Pixel (eventID = event_id)
   │
   └──► fetch → Pipedream webhook (event_id, fbp, fbc, phone, name, ...) ──► CAPI (Graph API) + Telegram
```

## Что уже делает фронтенд (готово)

В payload на webhook для **квалифицированных** лидов уходит всё, что нужно CAPI:

| Поле | Назначение в CAPI |
|---|---|
| `event_id` | дедупликация с Pixel (`eventID`) |
| `event_name` | `Lead` |
| `event_time` | unix-секунды |
| `action_source` | `website` |
| `event_source_url` | URL страницы |
| `client_user_agent` | `navigator.userAgent` |
| `fbp`, `fbc` | cookies `_fbp` / `_fbc` (если `fbc` нет — собирается из `fbclid`) |
| `phone`, `name` | **сырые** — хэшировать на сервере (SHA-256) |
| `utm_*`, `fbclid`, `gclid`, `referrer` | атрибуция (в custom_data / Telegram) |

> Хэширование (`em`, `ph`, `fn`) делается **на сервере** в Pipedream, НЕ в браузере.

## 1. GTM — тег Meta Pixel (дедупликация)

1. Переменная Data Layer: `DLV - event_id` → имя `event_id`.
2. Тег **Meta Pixel** (или Custom HTML с `fbq`), триггер на событие `lead_submit`:
   ```html
   <script>
     fbq('track', 'Lead', {}, { eventID: {{DLV - event_id}} });
   </script>
   ```
   Если используете шаблон Meta Pixel из галереи GTM — в поле **Event ID** подставьте `{{DLV - event_id}}`.
3. Базовый Pixel (`fbq init` + PageView) — на триггере All Pages / `gtm.js`.

## 2. Pipedream — серверный шаг CAPI (Node.js)

Добавьте шаг **после** HTTP-триггера (и рядом с Telegram Send Message).
Секреты (`PIXEL_ID`, `CAPI_TOKEN`) храните в Environment Variables Pipedream, **не в коде**.

```javascript
import crypto from "crypto";

const sha256 = (v) =>
  v ? crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex") : undefined;

// телефон: только цифры, с кодом страны, затем sha256
const hashPhone = (v) => {
  if (!v) return undefined;
  const digits = String(v).replace(/\D/g, "");
  return digits ? crypto.createHash("sha256").update(digits).digest("hex") : undefined;
};

export default defineComponent({
  async run({ steps, $ }) {
    const b = steps.trigger.event.body; // payload с сайта

    // только квалифицированные лиды отправляем как Lead
    if (b.lead_kind !== "qualified" || !b.event_name) {
      return { skipped: true, reason: "not a qualified lead" };
    }

    const PIXEL_ID = process.env.PIXEL_ID;     // 1448492083750122
    const TOKEN = process.env.CAPI_TOKEN;      // System User Access Token

    const userData = {
      ph: hashPhone(b.phone),
      fn: sha256(b.name),
      client_user_agent: b.client_user_agent,
      fbp: b.fbp || undefined,
      fbc: b.fbc || undefined,
      client_ip_address:
        steps.trigger.event.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
    };
    Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

    const payload = {
      data: [
        {
          event_name: b.event_name,                       // "Lead"
          event_time: b.event_time || Math.floor(Date.now() / 1000),
          event_id: b.event_id,                           // ДЕДУП с Pixel
          event_source_url: b.event_source_url || b.page_url,
          action_source: b.action_source || "website",
          user_data: userData,
          custom_data: {
            utm_source: b.utm_source, utm_medium: b.utm_medium,
            utm_campaign: b.utm_campaign, utm_content: b.utm_content,
            utm_term: b.utm_term, fbclid: b.fbclid, gclid: b.gclid,
          },
        },
      ],
      // ⚠️ БОЕВОЙ РЕЖИМ: НЕ передавайте test_event_code.
      // Для отладки во вкладке Test Events временно добавьте:
      // test_event_code: "TESTxxxxx",
    };

    const res = await fetch(
      `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error("CAPI error: " + JSON.stringify(json));
    return json; // { events_received: 1, ... }
  },
});
```

## 3. Чек-лист перехода в боевой режим

- [ ] В GTM Pixel-тег публикует `eventID = {{DLV - event_id}}` и опубликован (Submit/Publish).
- [ ] В Pipedream заданы `PIXEL_ID` и `CAPI_TOKEN` (System User token, не временный).
- [ ] Из CAPI-вызова **удалён** `test_event_code`.
- [ ] В Events Manager → Test Events проверена пара: Browser + Server по одному `event_id`
      показывают **Deduplicated** (а не два отдельных).
- [ ] Event Match Quality ≥ «хорошо» (телефон, fbp/fbc, UA, IP передаются).
- [ ] `telegramWebhookUrl` в `assets/tracking.js` указывает на боевой Pipedream-workflow.

## Ключевые значения проекта

- GTM container: `GTM-NXDMQN28`
- Meta Pixel ID: `1448492083750122`
- Webhook (Pipedream): задаётся в `assets/tracking.js` → `FUNNEL_CONFIG.telegramWebhookUrl`
