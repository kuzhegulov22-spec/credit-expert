/**
 * Cloudflare Worker — бесплатная замена Pipedream.
 * Принимает POST с сайта (тот же payload, что шёл на telegramWebhookUrl),
 * отправляет лид в Telegram И серверное событие в Meta Conversions API.
 *
 * Деплой:
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker → вставить этот код.
 *   2. Settings → Variables → добавить секреты (Encrypt):
 *        TG_BOT_TOKEN   — токен Telegram-бота
 *        TG_CHAT_ID     — chat_id группы (например -5457549598)
 *        META_PIXEL_ID  — 1448492083750122
 *        META_CAPI_TOKEN — System User Access Token из Events Manager
 *        ALLOW_ORIGIN   — https://kuzhegulov22-spec.github.io  (для CORS)
 *   3. Скопировать URL воркера (вида https://xxx.workers.dev) и вставить
 *      в assets/tracking.js → FUNNEL_CONFIG.telegramWebhookUrl.
 *
 * Боевой режим: НЕ задавайте META_TEST_EVENT_CODE. Для отладки временно
 * добавьте переменную META_TEST_EVENT_CODE = TESTxxxxx.
 */

async function sha256(value) {
  if (!value) return undefined;
  const data = new TextEncoder().encode(String(value).trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashPhone = async (v) => {
  if (!v) return undefined;
  const digits = String(v).replace(/\D/g, "");
  if (!digits) return undefined;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digits));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(env) });
    }

    let b;
    try {
      b = await request.json();
    } catch (_e) {
      return new Response(JSON.stringify({ error: "bad json" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(env) },
      });
    }

    const results = {};

    // 1) Telegram — текст готовится на фронте (b.tg_text)
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: b.chat_id || env.TG_CHAT_ID,
          text: b.tg_text || ("Новый лид:\n" + JSON.stringify(b)),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      results.telegram = tgRes.status;
    } catch (e) {
      results.telegram_error = String(e);
    }

    // 2) Meta CAPI — только для квалифицированных лидов
    if (b.lead_kind === "qualified" && b.event_name) {
      try {
        const ip = (request.headers.get("CF-Connecting-IP") || "").trim();
        const userData = {
          ph: await hashPhone(b.phone),
          fn: await sha256(b.name),
          client_user_agent: b.client_user_agent,
          fbp: b.fbp || undefined,
          fbc: b.fbc || undefined,
          client_ip_address: ip || undefined,
        };
        Object.keys(userData).forEach((k) => userData[k] === undefined && delete userData[k]);

        const payload = {
          data: [
            {
              event_name: b.event_name, // "Lead"
              event_time: b.event_time || Math.floor(Date.now() / 1000),
              event_id: b.event_id, // дедуп с Pixel
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
        };
        if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

        const capiRes = await fetch(
          `https://graph.facebook.com/v19.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        results.capi = capiRes.status;
        results.capi_body = await capiRes.json();
      } catch (e) {
        results.capi_error = String(e);
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { "Content-Type": "application/json", ...corsHeaders(env) },
    });
  },
};
