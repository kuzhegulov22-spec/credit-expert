/**
 * Cloudflare Pages Function — POST /api/lead
 * Бэкенд воронки «Кредитный Expert»: отправляет лид в Telegram
 * и серверное событие в Meta Conversions API (CAPI).
 * Фронт и эта функция живут на одном домене Pages → CORS не нужен.
 *
 * Environment Variables проекта Pages (Settings → Environment variables, Encrypt):
 *   TG_BOT_TOKEN        — токен Telegram-бота
 *   TG_CHAT_ID          — chat_id группы (например -5457549598)
 *   META_PIXEL_ID       — 1448492083750122
 *   META_CAPI_TOKEN     — System User Access Token (Events Manager)
 *   META_TEST_EVENT_CODE — (опционально, ТОЛЬКО для отладки; в бою НЕ задавать)
 */

async function sha256(value) {
  if (!value) return undefined;
  const data = new TextEncoder().encode(String(value).trim().toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPhone(v) {
  if (!v) return undefined;
  const digits = String(v).replace(/\D/g, "");
  if (!digits) return undefined;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digits));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let b;
  try {
    b = await request.json();
  } catch (_e) {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const results = {};

  // chat_id группы: берём из фронта или env, нормализуем.
  // У групп/супергрупп id отрицательный — если минус потеряли, восстановим.
  function normalizeChatId(raw) {
    if (raw === undefined || raw === null) return raw;
    let s = String(raw).trim();
    if (s.startsWith("@")) return s; // публичный username канала
    // только цифры (возможен ведущий минус)
    if (/^-?\d+$/.test(s)) {
      // супергруппы Telegram имеют id вида -100..., обычные группы — отрицательные.
      // Если пришло положительное многозначное (>= 6 цифр, не похоже на личный чат) — добавим минус.
      if (!s.startsWith("-") && s.length >= 6) s = "-" + s;
    }
    return s;
  }
  const chatId = normalizeChatId(b.chat_id || env.TG_CHAT_ID);

  // 1) Telegram — текст готовится на фронте (b.tg_text).
  // Пропускаем, если notify_telegram === false (напр. клик WhatsApp — только CAPI).
  if (b.notify_telegram === false) {
    results.telegram = "skipped";
  } else try {
    const tgRes = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: b.tg_text || "Новый лид:\n" + JSON.stringify(b),
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
      const ua = b.client_user_agent || request.headers.get("User-Agent") || undefined;
      const userData = {
        ph: await hashPhone(b.phone),
        fn: await sha256(b.name),
        client_user_agent: ua,
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
            event_id: b.event_id, // дедуп с браузерным Pixel
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

      // Pixel ID — публичный, не секрет. Берём из env, иначе фолбэк на зашитый.
      const pixelId = env.META_PIXEL_ID || "1448492083750122";
      const capiRes = await fetch(
        `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${env.META_CAPI_TOKEN}`,
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

  return Response.json({ ok: true, ...results });
}

// На GET вернём короткий статус (удобно проверить, что функция жива)
export async function onRequestGet() {
  return Response.json({ ok: true, endpoint: "lead", method: "POST only" });
}
