import { stickerSvg } from './stickers';
import { occasionInfo } from './occasions';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function cardDims(format) {
  return format === 'portrait' ? { w: 1200, h: 1600 } : { w: 1600, h: 1150 };
}

// Renders a list of card_objects rows to a static HTML string, used for the
// cover-lift preview, the "Preview & send" mock cards, and the print pages.
// resolveSignerName maps a text object's owner_id to a display name (or
// falsy if unsigned) — card_objects only stores owner_id, not a
// denormalized name, so the caller must resolve it against the signers
// they already have loaded (see CardScreen's nameMap/meId/meName).
export function objectsToHTML(list, resolveSrc, resolveSignerName) {
  let h = '';
  list.forEach((o) => {
    const rot = o.rotation || 0;
    const sc = o.scale || 1;
    if (o.type === 'text' && o.cover_kind) {
      h += `<div style="position:absolute;left:${o.x}px;top:${o.y}px;width:${o.width}px;transform:rotate(${rot}deg) scale(${sc})"><div style="font-family:${o.font};font-size:${o.fsize}px;font-weight:${o.weight || 700};letter-spacing:-.02em;line-height:1.02;text-align:${o.align || 'center'};color:${o.color};white-space:pre-wrap;word-break:break-word">${esc(o.text)}</div></div>`;
    } else if (o.type === 'text') {
      const sign = resolveSignerName ? resolveSignerName(o.owner_id) : null;
      const fs = o.font === 'Caveat' ? 30 : 18,
        ff = o.font === 'Caveat' ? "'Caveat',cursive" : "'Inter',sans-serif",
        fw = o.font === 'Caveat' ? 600 : 500,
        lh = o.font === 'Caveat' ? 1.15 : 1.45;
      h += `<div style="position:absolute;left:${o.x}px;top:${o.y}px;width:240px;transform:rotate(${rot}deg) scale(${sc})"><div style="font-family:${ff};font-size:${fs}px;line-height:${lh};color:${o.color};font-weight:${fw};white-space:pre-wrap;word-break:break-word">${esc(o.text)}</div>${sign ? `<div style="font-family:${ff};font-size:${o.font === 'Caveat' ? 25 : 16}px;font-weight:${fw};color:${o.color};margin-top:4px;opacity:.9">— ${esc(sign)}</div>` : ''}</div>`;
    } else if (o.type === 'photo') {
      const src = resolveSrc(o.photo_path);
      const inner = src
        ? `<img src="${src}" style="width:200px;height:200px;object-fit:cover;border-radius:6px;display:block"/>`
        : `<div style="width:200px;height:200px;border-radius:6px;background:${o.tint || '#eef3ff'}"></div>`;
      h += `<div style="position:absolute;left:${o.x}px;top:${o.y}px;transform:rotate(${rot}deg) scale(${sc})"><div style="background:#fff;padding:12px 12px 14px;border-radius:8px;box-shadow:0 12px 26px -14px rgba(20,24,29,.45)">${inner}<div style="font-family:'Caveat',cursive;font-size:22px;color:#3a3d45;text-align:center;margin-top:8px">${esc(o.caption || '')}</div></div></div>`;
    } else if (o.type === 'sticker') {
      h += `<div style="position:absolute;left:${o.x}px;top:${o.y}px;transform:rotate(${rot}deg) scale(${sc})">${stickerSvg(o.kind, 90)}</div>`;
    } else if (o.type === 'draw') {
      h += `<div style="position:absolute;left:${o.x}px;top:${o.y}px;transform:rotate(${rot}deg) scale(${sc})"><svg width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" style="overflow:visible;display:block"><path d="${o.path_data}" fill="none" stroke="${o.color}" stroke-width="${o.stroke_width}" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
    }
  });
  return h;
}

// Cover-template pieces (title/name/motif). These are communal (owner_id
// null) card_objects rows with a stable cover_kind so re-templating can
// find-and-replace them.
export function seedCoverObjects(layout, motif, cover, occasion, recipient, format) {
  const dims = cardDims(format);
  const k = dims.w / 1600;
  const S = (n) => Math.round(n * k);
  const W = dims.w,
    H = dims.h;
  const ink = { blue: '#1a44b8', pink: '#b32b6c', green: '#075c3d', yellow: '#946a05', purple: '#5b34c4' }[cover];
  const occ = occasionInfo(occasion).cover;
  const R = (recipient || '').trim() || 'you';

  const T = (coverKind, x, y, w, fsize, family, weight, text, align) => ({
    type: 'text',
    face: 'front',
    communal: true,
    cover_kind: coverKind,
    x,
    y,
    scale: 1,
    rotation: 0,
    text,
    color: ink,
    font: family,
    fsize: S(fsize),
    width: S(w),
    weight,
    align: align || 'center',
  });
  const K = (coverKind, x, y, px, rot) => ({
    type: 'sticker',
    face: 'front',
    communal: true,
    cover_kind: coverKind,
    kind: motif || 'star',
    x,
    y,
    scale: S(px) / 90,
    rotation: rot,
  });

  if (layout === 'bold') {
    const out = [
      T('cv-title', S(130), S(120), 700, 66, "'Caveat',cursive", 600, occ, 'left'),
      T('cv-name', S(130), H - S(420), 1300, 190, 'var(--font-sans)', 800, R, 'left'),
    ];
    if (motif) out.push(K('cv-motif', W - S(300), S(90), 200, 6));
    return out;
  }
  if (layout === 'playful') {
    const m = motif || 'star';
    return [
      { type: 'sticker', face: 'front', communal: true, cover_kind: 'cv-m1', kind: m, x: S(70), y: S(70), scale: S(150) / 90, rotation: -12 },
      { type: 'sticker', face: 'front', communal: true, cover_kind: 'cv-m2', kind: m, x: W - S(200), y: S(90), scale: S(108) / 90, rotation: 14 },
      { type: 'sticker', face: 'front', communal: true, cover_kind: 'cv-m3', kind: m, x: S(110), y: H - S(220), scale: S(118) / 90, rotation: 9 },
      { type: 'sticker', face: 'front', communal: true, cover_kind: 'cv-m4', kind: m, x: W - S(230), y: H - S(230), scale: S(150) / 90, rotation: -8 },
      T('cv-title', (W - S(900)) / 2, H * 0.4, 900, 72, "'Caveat',cursive", 600, occ, 'center'),
      T('cv-name', (W - S(1100)) / 2, H * 0.5, 1100, 140, 'var(--font-sans)', 800, R, 'center'),
    ];
  }
  const out = [
    T('cv-title', (W - S(900)) / 2, H * 0.44, 900, 78, "'Caveat',cursive", 600, occ, 'center'),
    T('cv-name', (W - S(1200)) / 2, H * 0.53, 1200, 150, 'var(--font-sans)', 800, R, 'center'),
  ];
  if (motif) out.push(K('cv-motif', W / 2 - 45, H * 0.16, 300, 0));
  return out;
}

export function leafShadowSvg() {
  const leaf = (cx, cy, rx, ry, rot) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})"/>`;
  let g = '';
  const stems = [
    [560, 40, -118, 150],
    [640, 20, -95, 190],
    [720, 60, -70, 120],
  ];
  stems.forEach(([sx, sy, dx, dy]) => {
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = sx + dx * t + (i % 2 ? 26 : -26);
      const y = sy + dy * t;
      const r = 18 - i * 0.7;
      g += leaf(x, y, r, r * 0.5, 35 + i * 20 + dx);
    }
    g += `<path d="M${sx} ${sy} Q ${sx + dx * 0.5} ${sy + dy * 0.5} ${sx + dx} ${sy + dy}" stroke="#39405a" stroke-width="3" fill="none"/>`;
  });
  [
    [300, 180, 40],
    [360, 120, -20],
    [250, 260, 70],
    [430, 240, 10],
  ].forEach(([x, y, r]) => {
    g += leaf(x, y, 17, 8, r);
  });
  return `<svg viewBox="0 0 800 460" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style="display:block"><g fill="#39405a" stroke="none">${g}</g></svg>`;
}
