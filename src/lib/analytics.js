// Google Analytics 4 — production only, loaded async so it never blocks
// first paint. No PII in any event: no names, no note text, no card ids.
// The card UUID is scrubbed from page_location / page_path before every hit
// (see safePath). Fully disabled in dev and whenever VITE_GA4_MEASUREMENT_ID
// is unset.
//
// Consent Mode v2 defaults to denied for everything (DECISIONS.md — "GA4
// analytics"), so GA4 runs cookieless: it sends pings but sets no _ga
// cookie and Google models the gaps. There is no consent UI yet; this is
// the deliberate posture until one exists.
const MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID;
const ENABLED = import.meta.env.PROD && !!MEASUREMENT_ID;

let started = false;

// "/c/<uuid>" -> "/c/:id", "/share/<uuid>" -> "/share/:id". Keeps the route
// shape for analytics without ever sending a real, lookup-able card id.
function safePath() {
  return window.location.pathname.replace(
    /\/(c|share)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    '/$1/:id'
  );
}
function safeLocation() {
  return window.location.origin + safePath();
}

export function initAnalytics() {
  if (started || !ENABLED) return;
  started = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  // Must be set before `config`. Denied by default, no consent UI yet.
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(s);

  window.gtag('js', new Date());
  // send_page_view:false — we send it ourselves, with the id scrubbed out.
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false });

  sendPageView();
}

function sendPageView() {
  if (!ENABLED || !window.gtag) return;
  window.gtag('event', 'page_view', {
    page_location: safeLocation(),
    page_path: safePath(),
    page_title: document.title,
  });
}

// name: GA4 custom event name. params: plain, non-PII scalars only.
export function track(name, params = {}) {
  if (!ENABLED || !window.gtag) return;
  window.gtag('event', name, {
    ...params,
    page_location: safeLocation(),
    page_path: safePath(),
  });
}
