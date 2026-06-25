/* ============================================================
   tracking.js — ядро трекинга воронки «Кредитный эксперт»
   - GTM dataLayer как основная архитектура
   - захват UTM / fbclid / gclid / referrer (с persist через URL)
   - отправка лидов в Telegram через no-code прокси (webhook)
   - НЕТ bot token в клиентском коде (см. CONFIG.telegramWebhookUrl)
   ============================================================ */

/* ----------------------------------------------------------------
   1. КОНФИГУРАЦИЯ — здесь меняются все ключевые значения
   ---------------------------------------------------------------- */
window.FUNNEL_CONFIG = {
  // GTM container ID — уже зашит в <head> каждой страницы.
  gtmId: 'GTM-NXDMQN28',

  // Meta Pixel ID — НЕ инициализируется напрямую здесь.
  // Pixel подключается ЧЕРЕЗ GTM (тег Meta Pixel + триггеры на dataLayer-события).
  // ID оставлен тут только как справка для настройки тега в GTM.
  metaPixelId: '1448492083750122',

  // === BACKEND (Cloudflare Pages Function) ===
  // Same-origin endpoint: фронт и бэкенд на одном домене Cloudflare Pages,
  // поэтому CORS не нужен. Обработчик: /functions/api/lead.js (Telegram + CAPI).
  // Токены (Telegram bot, Meta CAPI) хранятся в Environment Variables проекта Pages,
  // НЕ здесь и НЕ в браузере.
  telegramWebhookUrl: '/api/lead',

  // chat_id группы менеджеров (справочно; реально используется в Pipedream-шаге).
  telegramChatId: '-5457549598',

  // Куда вести после успешной отправки формы
  thankYouUrl: 'thanks',

  // WhatsApp менеджера (для дисквалифицированных лидов)
  whatsappUrl: 'https://wa.me/77771512431',

  // Рабочее время (локальное время устройства пользователя)
  workHours: { start: 10, end: 20 },
};

/* ----------------------------------------------------------------
   2. dataLayer + GTM helper
   ---------------------------------------------------------------- */
window.dataLayer = window.dataLayer || [];

function dl(eventName, params) {
  var payload = Object.assign({ event: eventName }, params || {});
  window.dataLayer.push(payload);
  return payload;
}

/* ----------------------------------------------------------------
   3. Захват маркетинговых меток
   Сохраняем UTM/fbclid/gclid из URL в sessionStorage, чтобы они
   «дожили» от формы до thank-you. (sessionStorage работает в обычном
   браузере; в песочнице деградирует мягко — тогда берём из URL.)
   ---------------------------------------------------------------- */
var TRACK_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid',
];

function getStore() {
  try { return window.sessionStorage; } catch (e) { return null; }
}

function captureMarketingParams() {
  var url = new URLSearchParams(window.location.search);
  var store = getStore();
  var data = {};
  TRACK_KEYS.forEach(function (k) {
    var fromUrl = url.get(k);
    if (fromUrl) {
      data[k] = fromUrl;
      if (store) { try { store.setItem('mk_' + k, fromUrl); } catch (e) {} }
    } else if (store) {
      try { var saved = store.getItem('mk_' + k); if (saved) data[k] = saved; } catch (e) {}
    }
  });
  return data;
}

function getReferrer() {
  // referrer текущей сессии — сохраняем первый внешний referrer
  var store = getStore();
  if (store) {
    try {
      var saved = store.getItem('mk_referrer');
      if (saved) return saved;
      var ref = document.referrer || '';
      if (ref && ref.indexOf(window.location.host) === -1) {
        store.setItem('mk_referrer', ref);
        return ref;
      }
      return ref;
    } catch (e) {}
  }
  return document.referrer || '';
}

// Собирает полный набор маркетинговых параметров (для dataLayer и Telegram)
function getTrackingContext() {
  var mk = captureMarketingParams();
  return {
    utm_source: mk.utm_source || '',
    utm_medium: mk.utm_medium || '',
    utm_campaign: mk.utm_campaign || '',
    utm_content: mk.utm_content || '',
    utm_term: mk.utm_term || '',
    fbclid: mk.fbclid || '',
    gclid: mk.gclid || '',
    referrer: getReferrer(),
    page_url: window.location.href,
  };
}

// Прокидывает UTM/fbclid/gclid в ссылку перехода (сохраняем атрибуцию между страницами)
function appendTrackingToUrl(baseUrl, extraParams) {
  var ctx = getTrackingContext();
  var u;
  try {
    u = new URL(baseUrl, window.location.href);
  } catch (e) { return baseUrl; }
  TRACK_KEYS.forEach(function (k) { if (ctx[k]) u.searchParams.set(k, ctx[k]); });
  if (extraParams) {
    Object.keys(extraParams).forEach(function (k) {
      if (extraParams[k] !== undefined && extraParams[k] !== null && extraParams[k] !== '') {
        u.searchParams.set(k, extraParams[k]);
      }
    });
  }
  return u.pathname.split('/').pop() + u.search; // относительный путь + query
}

/* ----------------------------------------------------------------
   4. Валидация телефона (KZ / СНГ-формат, гибко)
   ---------------------------------------------------------------- */
function normalizePhone(raw) {
  return (raw || '').replace(/[^\d+]/g, '');
}
function isValidPhone(raw) {
  var digits = (raw || '').replace(/\D/g, '');
  // 10–15 цифр — покрывает +7XXXXXXXXXX и местные форматы
  return digits.length >= 10 && digits.length <= 15;
}
function isValidName(raw) {
  return (raw || '').trim().length >= 2;
}

/* ----------------------------------------------------------------
   5. Время отправки формы (created_at) — ISO + локальное
   ---------------------------------------------------------------- */
function nowCreatedAt() {
  var d = new Date();
  return {
    iso: d.toISOString(),
    local: d.toLocaleString('ru-RU', { hour12: false }),
    hour: d.getHours(),
    epoch: d.getTime(),
  };
}

/* ----------------------------------------------------------------
   6. Отправка лида в Telegram через no-code прокси
   Отправляем JSON на webhook. Если URL не задан — мягко пропускаем
   (НО dataLayer-событие всё равно отправляется отдельно).
   ---------------------------------------------------------------- */
// Формирует готовый текст сообщения для Telegram (HTML parse_mode).
// Возвращается в поле tg_text — Pipedream-шаг просто прокидывает его в Send Message.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function row(label, val) {
  return (val !== undefined && val !== null && val !== '') ? ('<b>' + label + ':</b> ' + esc(val) + '\n') : '';
}
function utmBlock(d) {
  return row('UTM source', d.utm_source) + row('UTM medium', d.utm_medium) +
    row('UTM campaign', d.utm_campaign) + row('UTM content', d.utm_content) +
    row('UTM term', d.utm_term) + row('fbclid', d.fbclid) +
    row('gclid', d.gclid) + row('referrer', d.referrer);
}
function buildTgText(d) {
  var time = d.created_at_local || d.created_at;
  if (d.type === 'simple_form') {
    return '\uD83D\uDFE2 <b>Лид — Простая форма</b>\n\n' +
      row('Имя', d.name) + row('Телефон', d.phone) +
      row('Время отправки', time) + row('Страница', d.page_url) + '\n' + utmBlock(d);
  }
  if (d.type === 'quiz') {
    return '\uD83D\uDFE2 <b>Лид — Квиз</b>\n\n' +
      row('Официально работает', d.official_work) +
      row('Пенсионные отчисления', d.pension_last_6m) +
      row('Есть просрочки', d.active_overdue) +
      row('Дней просрочки', d.overdue_days_bucket) +
      row('Подходит под услугу', d.is_eligible ? 'Да' : 'Нет') +
      row('Имя', d.name) + row('Телефон', d.phone) +
      row('Время отправки', time) + row('Страница', d.page_url) + '\n' + utmBlock(d);
  }
  if (d.type === 'quiz_disqualified') {
    return '\uD83D\uDD34 <b>Дисквалификация квиза</b>\n\n' +
      row('Официально работает', d.official_work) +
      row('Пенсионные отчисления', d.pension_last_6m) +
      row('Есть просрочки', d.active_overdue) +
      row('Дней просрочки', d.overdue_days_bucket) +
      row('Причина', d.disqualify_reason) +
      row('Время', time) + row('Страница', d.page_url) + '\n' + utmBlock(d);
  }
  return 'Новый лид:\n' + JSON.stringify(d);
}

function sendToTelegram(leadObject) {
  var url = window.FUNNEL_CONFIG.telegramWebhookUrl;
  // === Обогащение полями для Meta Conversions API (CAPI) ===
  // Pipedream-шаг возьмёт эти поля как есть и отправит серверное событие в Meta
  // с ТЕМ ЖЕ event_id, что и браузерный Pixel (дедупликация Pixel <-> CAPI).
  try {
    if (!leadObject.client_user_agent) {
      leadObject.client_user_agent = (navigator && navigator.userAgent) || '';
    }
    if (!leadObject.event_source_url) {
      leadObject.event_source_url = leadObject.page_url || window.location.href;
    }
    if (!leadObject.event_time) {
      // unix-время в СЕКУНДАХ — формат, который требует Graph API
      leadObject.event_time = Math.floor(Date.now() / 1000);
    }
    if (!leadObject.action_source) {
      leadObject.action_source = 'website';
    }
    // Подстраховка: гарантируем event_id / _fbp / _fbc для квалифицированных лидов
    if (leadObject.event_name) {
      if (!leadObject.event_id) leadObject.event_id = genEventId();
      var _fb = getFbCookies();
      if (leadObject.fbp == null || leadObject.fbp === '') leadObject.fbp = _fb.fbp;
      if (leadObject.fbc == null || leadObject.fbc === '') leadObject.fbc = _fb.fbc;
    }
  } catch (e) {}
  // Добавляем готовый текст и chat_id — Pipedream-шагу остаётся только прокинуть.
  try {
    leadObject.tg_text = buildTgText(leadObject);
    leadObject.chat_id = window.FUNNEL_CONFIG.telegramChatId;
  } catch (e) {}
  if (!url) {
    console.warn('[Кредитный эксперт] telegramWebhookUrl не задан — лид НЕ отправлен в Telegram. Вставьте webhook прокси в FUNNEL_CONFIG.');
    return Promise.resolve({ skipped: true });
  }
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadObject),
    keepalive: true, // долетит даже при навигации на thank-you
  }).then(function (r) {
    return { ok: r.ok, status: r.status };
  }).catch(function (err) {
    console.error('[Кредитный эксперт] Ошибка отправки в Telegram:', err);
    return { ok: false, error: String(err) };
  });
}

/* ----------------------------------------------------------------
   6b. event_id — единый ID события для дедупликации Pixel <-> CAPI.
   Браузер генерирует event_id, кладёт его в dataLayer (Pixel шлёт с eventID)
   И в payload на Pipedream (CAPI шлёт тот же event_id). Meta склеивает дубли.
   ---------------------------------------------------------------- */
function genEventId() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch (e) {}
  return 'evt-' + Date.now() + '-' + Math.random().toString(16).slice(2, 10);
}

// Получить _fbp / _fbc из кук (улучшает матчинг CAPI). Может быть пусто.
function getCookie(name) {
  var m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
  return m ? decodeURIComponent(m[1]) : '';
}
function getFbCookies() {
  var fbp = getCookie('_fbp');
  var fbc = getCookie('_fbc');
  // если fbc нет, но есть fbclid — собираем fbc по формату Meta
  if (!fbc) {
    var ctx = getTrackingContext();
    if (ctx.fbclid) fbc = 'fb.1.' + Date.now() + '.' + ctx.fbclid;
  }
  return { fbp: fbp, fbc: fbc };
}

/* ----------------------------------------------------------------
   7. page_view — отправляем на каждой странице
   ---------------------------------------------------------------- */
function firePageView(funnelType) {
  var ctx = getTrackingContext();
  dl('page_view', Object.assign({
    funnel_type: funnelType,
    created_at: nowCreatedAt().iso,
  }, ctx));
}

// экспорт в глобальную область
window.Tracking = {
  dl: dl,
  getTrackingContext: getTrackingContext,
  appendTrackingToUrl: appendTrackingToUrl,
  normalizePhone: normalizePhone,
  isValidPhone: isValidPhone,
  isValidName: isValidName,
  nowCreatedAt: nowCreatedAt,
  sendToTelegram: sendToTelegram,
  firePageView: firePageView,
  genEventId: genEventId,
  getFbCookies: getFbCookies,
};
