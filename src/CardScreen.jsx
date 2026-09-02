import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as db from './lib/cardData';
import { getParticipant, rememberParticipantName } from './lib/participant';
import { stickerSvg, COVERS } from './lib/stickers';
import { cardDims, objectsToHTML, seedCoverObjects, leafShadowSvg } from './lib/canvasHtml';
import { occasionInfo } from './lib/occasions';
import { FEATURE_MONETIZATION, FEATURE_PREVIEW_AND_SEND_PAGE } from './lib/featureFlags';
import ObjectView from './ObjectView.jsx';

const LIMIT = 20;

// The mobile breakpoint has one source of truth: the `--m-mobile` custom
// property, set by the `@media (max-width:640px)` block in styles.css. JS
// reads that flag instead of hard-coding its own pixel value, so the query
// and this check can never disagree (D-037).
function isMobileView() {
  if (typeof document === 'undefined') return false;
  return getComputedStyle(document.documentElement).getPropertyValue('--m-mobile').trim() === '1';
}

function measuredBarPx(varName, fallback) {
  if (typeof document === 'undefined') return fallback;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function fitZoomFor(format) {
  const d = cardDims(format);
  const w = window.innerWidth || 1200,
    h = window.innerHeight || 800;
  let z;
  if (isMobileView()) {
    // Fit against the real canvas window between the edge-anchored bars,
    // not the whole viewport — fitting against the full viewport is what
    // used to render the card at ~30% with dead space above/below it (D-031).
    const topBar = measuredBarPx('--m-topbar', 56);
    const bottomBar = measuredBarPx('--m-bottombar', 90);
    z = Math.min((w - 24) / d.w, (h - topBar - bottomBar - 24) / d.h);
  } else {
    z = Math.min((w - 150) / d.w, (h - 250) / d.h);
  }
  z = Math.max(0.3, Math.min(1, z));
  return Math.round(z * 100) / 100;
}

const PRINT_SIZES_MM = { a4: [210, 297], a5: [148, 210], a6: [105, 148] };

function printMMFor(format, printSize) {
  const base = PRINT_SIZES_MM[printSize] || PRINT_SIZES_MM.a5;
  const land = format === 'landscape';
  const w = land ? Math.max(base[0], base[1]) : Math.min(base[0], base[1]);
  const h = land ? Math.min(base[0], base[1]) : Math.max(base[0], base[1]);
  return { w, h };
}

function applyPrintPageSize(mm) {
  let el = document.getElementById('warmly-print-page');
  if (!el) {
    el = document.createElement('style');
    el.id = 'warmly-print-page';
    document.head.appendChild(el);
  }
  el.textContent = `@media print{@page{size:${mm.w}mm ${mm.h}mm;margin:0;}.print-page{width:${mm.w}mm !important;height:${mm.h}mm !important;}}`;
}

function slugFor(card) {
  const r =
    (card.recipient || 'card')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'card';
  return `${r}-${card.occasion}`;
}

export default function CardScreen() {
  const { id: cardId } = useParams();
  const participantRef = useRef(getParticipant(cardId));
  const meId = participantRef.current.id;

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [card, setCard] = useState(null);
  const [objects, setObjects] = useState([]);
  const [signers, setSigners] = useState([]);
  const [meName, setMeName] = useState(participantRef.current.name || null);
  const [ready, setReady] = useState(false);

  const [tool, setTool] = useState('write');
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [signName, setSignName] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const [showSigners, setShowSigners] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showFaceCoach, setShowFaceCoach] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [showDownload, setShowDownload] = useState(false);
  const [printSize, setPrintSize] = useState('a5');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackStage, setFeedbackStage] = useState('open');
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeStage, setUpgradeStage] = useState('plan');
  const [payCard, setPayCard] = useState('');
  const [payExp, setPayExp] = useState('');
  const [payCvc, setPayCvc] = useState('');
  const [fullControl, setFullControl] = useState(false);
  const [confirmControl, setConfirmControl] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [captionId, setCaptionId] = useState(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [deliverFace, setDeliverFace] = useState('front');
  const [deliverStage, setDeliverStage] = useState('preview');
  const [showTemplates, setShowTemplates] = useState(false);
  const [toast, setToast] = useState(null);
  const [opening, setOpening] = useState(false);
  const [face, setFace] = useState('inside');
  const [penColor, setPenColor] = useState('#2f6bff');
  const [penWidth] = useState(4);
  const [textColor, setTextColor] = useState('#28407a');
  const [textFont, setTextFont] = useState('Caveat');
  const [stickerKind, setStickerKind] = useState('heart');
  const [copied, setCopied] = useState(false);
  const [panning, setPanning] = useState(false);
  const [liveTick, setLiveTick] = useState(0);
  const [mobileView, setMobileView] = useState(() => isMobileView());

  const surfaceRef = useRef(null);
  const scrollRef = useRef(null);
  const topBarRef = useRef(null);
  const bottomBarRef = useRef(null);
  const fileRef = useRef(null);
  const gestureRef = useRef(null);
  // Two-finger touch tracking for app-owned pinch (D-053). Plain refs, not
  // state, so onDocMove/onDocUp can read/update them synchronously without
  // waiting on a render, exactly like gestureRef.
  const ptsRef = useRef(null);
  const objPinchRef = useRef(null);
  const pinchRef = useRef(null);
  // Mirrors state the pinch pointerdown handler needs to read without being
  // in the gesture effect's dependency array — objects/selectedId/panning
  // change on every keystroke and drag frame, and re-subscribing six window
  // listeners that often would be wasteful and could drop a gesture mid-flight.
  const pinchLiveRef = useRef({});
  const drawPtsRef = useRef(null);
  const pendingPointRef = useRef(null);
  const fillPhotoIdRef = useRef(null);
  const toastTimerRef = useRef(null);
  const openTimerRef = useRef(null);
  const copyTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  // Guards against commitBox being invoked twice for the same box — the
  // canvas's onSurfaceDown (pointerdown, fires first) and the editing box's
  // native onBlur (fires shortly after, once focus actually leaves) can both
  // resolve to the same id for a single click-away. A plain ref (not React
  // state) makes the guard effective immediately, regardless of whether
  // React has flushed the state updates from the first call yet.
  const commitBoxRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    toastTimerRef.current && clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const cardRow = await db.getCard(cardId);
        if (!cardRow) {
          if (alive) {
            setNotFound(true);
            setLoading(false);
          }
          return;
        }
        const [objs, signerRows] = await Promise.all([db.listCardObjects(cardId), db.listSigners(cardId)]);
        const participant = participantRef.current;
        await db.ensureSigner(cardId, participant.id, participant.color);

        let rosterRows = signerRows;
        let mine = rosterRows.find((s) => s.id === participant.id);
        if (!mine) {
          mine = { id: participant.id, card_id: cardId, name: participant.name || null, color: participant.color };
          rosterRows = [...rosterRows, mine];
        } else if (mine.name && mine.name !== participant.name) {
          rememberParticipantName(cardId, mine.name);
        }

        let finalObjects = objs;
        let finalCard = cardRow;
        if (!objs.some((o) => o.cover_kind)) {
          const motif = occasionInfo(cardRow.occasion).motif;
          await db.updateCard(cardId, { cover_motif: motif, cover_layout: 'centered' });
          finalCard = { ...cardRow, cover_motif: motif, cover_layout: 'centered' };
          const seeds = seedCoverObjects('centered', motif, cardRow.cover_color, cardRow.occasion, cardRow.recipient, cardRow.format).map((s) => ({
            ...s,
            card_id: cardId,
            owner_id: null,
          }));
          try {
            const inserted = await db.insertObjects(seeds);
            finalObjects = [...objs, ...inserted];
          } catch (seedErr) {
            if (db.isCoverSeedRace(seedErr)) {
              // another concurrent first-load already seeded the cover — use its rows
              finalObjects = await db.listCardObjects(cardId);
            } else {
              throw seedErr;
            }
          }
        }

        if (!alive) return;
        setCard(finalCard);
        setObjects(finalObjects);
        setSigners(rosterRows);
        setMeName(mine.name || null);
        setZoom(fitZoomFor(finalCard.format));
        setLoading(false);
        setOpening(true);
        openTimerRef.current = setTimeout(() => setOpening(false), 760);
        setReady(true);
      } catch (err) {
        console.error(err);
        if (alive) {
          setNotFound(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
      openTimerRef.current && clearTimeout(openTimerRef.current);
      toastTimerRef.current && clearTimeout(toastTimerRef.current);
      copyTimerRef.current && clearTimeout(copyTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // ---- realtime -------------------------------------------------------------
  useEffect(() => {
    if (!ready) return undefined;
    const unsubscribe = db.subscribeToCard(cardId, {
      onObject: (eventType, row, oldRow) => {
        if (eventType === 'DELETE') {
          setObjects((prev) => prev.filter((o) => o.id !== (oldRow && oldRow.id)));
          return;
        }
        setObjects((prev) => {
          const idx = prev.findIndex((o) => o.id === row.id);
          if (idx === -1) return [...prev, row];
          const next = [...prev];
          // preserve local-only ephemeral fields (editing drafts, local photo preview)
          next[idx] = { ...next[idx], ...row };
          return next;
        });
      },
      onSigner: (eventType, row, oldRow) => {
        if (eventType === 'DELETE') {
          setSigners((prev) => prev.filter((s) => s.id !== (oldRow && oldRow.id)));
          return;
        }
        setSigners((prev) => {
          const idx = prev.findIndex((s) => s.id === row.id);
          if (idx === -1) return [...prev, row];
          const next = [...prev];
          next[idx] = row;
          return next;
        });
        if (row.id === meId && row.name) {
          setMeName(row.name);
          rememberParticipantName(cardId, row.name);
        }
      },
      onCard: (row) => {
        if (row) setCard(row);
      },
    });
    return unsubscribe;
  }, [cardId, ready, meId]);

  // ---- zoom / pan / draw gesture plumbing -----------------------------------
  const scroller = useCallback(() => scrollRef.current, []);

  const setZoomAt = useCallback((nz, cx, cy) => {
    nz = Math.max(0.3, Math.min(2, Math.round(nz * 100) / 100));
    const sc = scroller();
    const oz = zoom || 1;
    if (!sc || nz === oz) {
      setZoom(nz);
      return;
    }
    const r = sc.getBoundingClientRect();
    // point under cursor, in surface (unzoomed) coords
    const px = (sc.scrollLeft + (cx - r.left)) / oz;
    const py = (sc.scrollTop + (cy - r.top)) / oz;
    setZoom(nz);
    requestAnimationFrame(() => {
      sc.scrollLeft = px * nz - (cx - r.left);
      sc.scrollTop = py * nz - (cy - r.top);
    });
  }, [scroller, zoom]);

  const surfacePoint = useCallback(
    (e) => {
      const r = surfaceRef.current.getBoundingClientRect();
      return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
    },
    [zoom]
  );

  const finishDraw = useCallback(async () => {
    const pts = drawPtsRef.current || [];
    drawPtsRef.current = null;
    if (pts.length < 2) {
      setLiveTick((t) => t + 1);
      return;
    }
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y),
      pad = penWidth + 8;
    const minX = Math.min(...xs) - pad,
      minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2,
      h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const d = 'M ' + pts.map((p) => (p.x - minX).toFixed(1) + ' ' + (p.y - minY).toFixed(1)).join(' L ');
    const row = {
      id: crypto.randomUUID(),
      card_id: cardId,
      owner_id: meId,
      type: 'draw',
      face,
      communal: face === 'front',
      x: minX,
      y: minY,
      width: w,
      height: h,
      rotation: 0,
      scale: 1,
      path_data: d,
      color: penColor,
      stroke_width: penWidth,
    };
    setLiveTick((t) => t + 1);
    setObjects((prev) => [...prev, row]);
    try {
      await db.insertObject(row);
    } catch (err) {
      console.error(err);
      setObjects((prev) => prev.filter((o) => o.id !== row.id));
    }
  }, [cardId, meId, face, penColor, penWidth]);

  useEffect(() => {
    pinchLiveRef.current = { objects, selectedId, panning, fullControl, card, meId };
  });

  useEffect(() => {
    // Two-finger pinch on the canvas (D-053). Tracked in capture phase
    // because objects stopPropagation on pointerdown, and every object sets
    // touch-action:none — a bubble-phase listener would never see the
    // second finger once an object has claimed the first.
    function onDocDown(e) {
      if (e.pointerType !== 'touch') return;
      const sc = scroller();
      if (!sc || !sc.contains(e.target)) return;
      const pts = ptsRef.current || (ptsRef.current = new Map());
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        if (gestureRef.current && gestureRef.current.type === 'draw') {
          drawPtsRef.current = null;
          setLiveTick((t) => t + 1);
        }
        gestureRef.current = null;
        const live = pinchLiveRef.current;
        if (live.panning) setPanning(false);
        const d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const ang0 = Math.atan2(b.y - a.y, b.x - a.x);
        // With something selected, pinch resizes/rotates it; otherwise it
        // zooms the canvas (D-054).
        const sel = live.selectedId && (live.objects || []).find((o) => o.id === live.selectedId);
        const canManip = sel && (sel.owner_id === live.meId || sel.communal || sel.type === 'sticker' || (live.card && live.card.unlimited && live.fullControl));
        if (canManip) {
          objPinchRef.current = { id: sel.id, d0, ang0, s0: sel.scale || 1, rot0: sel.rotation || 0 };
          return;
        }
        pinchRef.current = { d0, z0: zoom || 1 };
      }
    }
    function onDocMove(e) {
      const pts = ptsRef.current;
      if (pts && pts.has(e.pointerId)) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) {
          if (e.cancelable) e.preventDefault();
          const [a, b] = [...pts.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (objPinchRef.current) {
            const g = objPinchRef.current;
            const deg = ((Math.atan2(b.y - a.y, b.x - a.x) - g.ang0) * 180) / Math.PI;
            const ns = Math.max(0.35, Math.min(4, +((g.s0 * d) / g.d0).toFixed(3)));
            const nr = +(g.rot0 + deg).toFixed(1);
            setObjects((prev) => prev.map((o) => (o.id === g.id ? { ...o, scale: ns, rotation: nr } : o)));
            return;
          }
          if (pinchRef.current) {
            const g = pinchRef.current;
            setZoomAt(g.z0 * (d / g.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
            return;
          }
        }
      }
      const g = gestureRef.current;
      if (!g) return;
      if (g.type === 'pan') {
        const sc = scroller();
        if (sc) {
          sc.scrollLeft = g.sl - (e.clientX - g.sx);
          sc.scrollTop = g.st - (e.clientY - g.sy);
        }
      } else if (g.type === 'move') {
        const z = zoom || 1;
        // Distinguish tap from drag by travel, decided on pointer-up (D-049)
        // — under ~4px is a tap, so repositioning still works from the same
        // press that a tap would otherwise treat as "open for editing".
        if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
        const nx = g.ox + (e.clientX - g.sx) / z;
        const ny = g.oy + (e.clientY - g.sy) / z;
        setObjects((prev) => prev.map((o) => (o.id === g.id ? { ...o, x: nx, y: ny } : o)));
      } else if (g.type === 'draw') {
        drawPtsRef.current.push(surfacePoint(e));
        setLiveTick((t) => t + 1);
      } else if (g.type === 'resize') {
        const d = Math.hypot(e.clientX - g.center.x, e.clientY - g.center.y);
        const ns = Math.max(0.35, +((g.oscale * d) / g.odist).toFixed(3));
        setObjects((prev) => prev.map((o) => (o.id === g.id ? { ...o, scale: ns } : o)));
      } else if (g.type === 'rotate') {
        const a = Math.atan2(e.clientY - g.center.y, e.clientX - g.center.x);
        const nr = +(g.orot + ((a - g.oang) * 180) / Math.PI).toFixed(1);
        setObjects((prev) => prev.map((o) => (o.id === g.id ? { ...o, rotation: nr } : o)));
      }
    }
    function onDocUp(e) {
      if (e && ptsRef.current) {
        ptsRef.current.delete(e.pointerId);
        if (ptsRef.current.size < 2) {
          if (objPinchRef.current) {
            const id = objPinchRef.current.id;
            objPinchRef.current = null;
            setObjects((prev) => {
              const o = prev.find((x) => x.id === id);
              if (o) db.updateObject(id, { scale: o.scale, rotation: o.rotation }).catch(console.error);
              return prev;
            });
          }
          pinchRef.current = null;
        }
      }
      const g = gestureRef.current;
      if (g && g.type === 'draw') finishDraw();
      if (g && (g.type === 'move' || g.type === 'resize' || g.type === 'rotate')) {
        setObjects((prev) => {
          const o = prev.find((x) => x.id === g.id);
          if (o) {
            const patch = g.type === 'move' ? { x: o.x, y: o.y } : g.type === 'resize' ? { scale: o.scale } : { rotation: o.rotation };
            db.updateObject(g.id, patch).catch(console.error);
          }
          return prev;
        });
      }
      const wasPan = g && g.type === 'pan';
      gestureRef.current = null;
      if (wasPan) setPanning(false);
      // A single tap (no travel) on your own note opens it for editing —
      // no double-click needed (D-049). Real drags (g.moved) never do this.
      if (g && g.type === 'move' && !g.moved && g.tapEdit && editingId !== g.id) {
        setEditingId(g.id);
        setSelectedId(g.id);
        setSignName(g.signPrefill);
      }
    }
    function onWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      setZoomAt((zoom || 1) * factor, e.clientX, e.clientY);
    }
    function onKeyZoom(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const sc = scroller();
      const cx = sc ? sc.getBoundingClientRect().left + sc.clientWidth / 2 : window.innerWidth / 2;
      const cy = sc ? sc.getBoundingClientRect().top + sc.clientHeight / 2 : window.innerHeight / 2;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        setZoomAt((zoom || 1) + 0.1, cx, cy);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoomAt((zoom || 1) - 0.1, cx, cy);
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(fitZoomFor(card ? card.format : 'landscape'));
      }
    }
    // Capture phase: see the onDocDown comment above for why.
    window.addEventListener('pointerdown', onDocDown, true);
    window.addEventListener('pointermove', onDocMove);
    window.addEventListener('pointerup', onDocUp);
    // A touch gesture can be cancelled mid-stroke (e.g. an interruption the
    // OS decides takes priority) — treat that exactly like pointerup so an
    // interrupted drawing stroke still commits instead of hanging forever
    // with drawPtsRef still holding points nothing will ever flush (D-039).
    window.addEventListener('pointercancel', onDocUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyZoom);
    return () => {
      window.removeEventListener('pointerdown', onDocDown, true);
      window.removeEventListener('pointermove', onDocMove);
      window.removeEventListener('pointerup', onDocUp);
      window.removeEventListener('pointercancel', onDocUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyZoom);
    };
  }, [zoom, scroller, surfacePoint, finishDraw, setZoomAt, card, editingId]);

  useEffect(() => {
    if (editingId) {
      const el = document.getElementById('ta-' + editingId);
      if (el) {
        el.focus();
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    }
  }, [editingId]);
  useEffect(() => {
    if (captionId) {
      const el = document.getElementById('cap-' + captionId);
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [captionId]);

  // Keeps `mobileView` in sync with the CSS breakpoint on resize (rotation,
  // window resize, devtools). isMobileView() itself always reads the current
  // CSS state live, so this is just what triggers a re-render when it flips.
  useEffect(() => {
    const onResize = () => setMobileView(isMobileView());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // One-time coach mark teaching the Cover/Content toggle on mobile (D-032)
  // — shown once per browser, ever, then dismissed on interaction, tap, or
  // ~6s, whichever comes first.
  useEffect(() => {
    if (!mobileView) return;
    let already;
    try {
      already = localStorage.getItem('warmly_face_coach');
    } catch {
      already = '1';
    }
    if (already) return;
    setShowFaceCoach(true);
    const t = setTimeout(dismissFaceCoach, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileView]);

  // Measures the real, current height of the edge-anchored top/bottom bars
  // into CSS custom properties, so the canvas can be positioned against
  // them (never clipping behind a taller bar) and fitZoomFor can fit against
  // the real window between them, both reading the same single measurement
  // instead of duplicating a guessed constant (D-031/D-037). A ResizeObserver
  // is used because the bars' height genuinely varies — the bottom bar is a
  // 1-3 row stack depending on which context row is open.
  useEffect(() => {
    const topEl = topBarRef.current;
    const bottomEl = bottomBarRef.current;
    if (!topEl && !bottomEl) return;
    const apply = () => {
      if (topEl) document.documentElement.style.setProperty('--m-topbar', topEl.offsetHeight + 'px');
      if (bottomEl) document.documentElement.style.setProperty('--m-bottombar', bottomEl.offsetHeight + 'px');
    };
    apply();
    const ro = new ResizeObserver(apply);
    if (topEl) ro.observe(topEl);
    if (bottomEl) ro.observe(bottomEl);
    return () => ro.disconnect();
  }, []);

  // ---- creation helpers ------------------------------------------------------
  const createObjectOptimistic = useCallback(
    async (partialRow) => {
      const row = { id: crypto.randomUUID(), card_id: cardId, ...partialRow };
      setObjects((prev) => [...prev, row]);
      try {
        await db.insertObject(row);
      } catch (err) {
        setObjects((prev) => prev.filter((o) => o.id !== row.id));
        throw err;
      }
      return row;
    },
    [cardId]
  );

  const placeSticker = useCallback(
    (x, y) => {
      const isFront = face === 'front';
      if (stickerKind === 'polaroid') {
        createObjectOptimistic({
          owner_id: meId,
          type: 'photo',
          face,
          communal: isFront,
          x: x - 112,
          y: y - 130,
          rotation: Math.random() * 8 - 4,
          scale: 1,
          photo_path: null,
          caption: '',
          tint: '#eef3ff',
        })
          .then((row) => setSelectedId(row.id))
          .catch((err) => console.error(err));
        return;
      }
      createObjectOptimistic({
        owner_id: meId,
        type: 'sticker',
        face,
        communal: isFront,
        x: x - 45,
        y: y - 45,
        rotation: Math.random() * 22 - 11,
        scale: 1,
        kind: stickerKind,
      })
        .then((row) => setSelectedId(row.id))
        .catch((err) => console.error(err));
    },
    [face, stickerKind, meId, createObjectOptimistic]
  );

  const chooseSticker = (kind) => {
    setStickerKind(kind);
    setTool('sticker');
    setShowStickers(false);
    showToast(kind === 'polaroid' ? 'Tap the card to place a photo frame' : 'Tap the card to place it');
  };

  const createText = (x, y) => {
    const id = crypto.randomUUID();
    const obj = {
      id,
      card_id: cardId,
      owner_id: meId,
      type: 'text',
      face: 'inside',
      x: x - 120,
      y: y - 18,
      rotation: 0,
      scale: 1,
      text: '',
      color: textColor,
      font: textFont,
      pending: true,
    };
    setObjects((prev) => [...prev, obj]);
    setEditingId(id);
    setSelectedId(id);
    // Pre-fill with the existing signature if there is one — the field is
    // always present while editing (README "Signing"), doubling as a
    // rename control once you've signed, not just a first-time prompt.
    setSignName(meName || '');
  };

  const onTextChange = (id, e) => {
    const el = e.target;
    const val = el.value;
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, text: val } : o)));
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  // Persists a name adoption: sets it as this participant's signature going
  // forward, both locally and on the signers row, and clears any lingering
  // "sign your name" prompt on their other notes. Called from commitBox —
  // signing/renaming only ever happens inline, inside the edit box.
  const adoptName = async (name, isRename) => {
    setMeName(name);
    rememberParticipantName(cardId, name);
    setSigners((prev) =>
      prev.some((s) => s.id === meId)
        ? prev.map((s) => (s.id === meId ? { ...s, name } : s))
        : [...prev, { id: meId, card_id: cardId, name, color: participantRef.current.color }]
    );
    setObjects((prev) => prev.map((o) => (o.owner_id === meId ? { ...o, promptSign: false } : o)));
    showToast(isRename ? 'Signed as ' + name + '.' : 'Signed. Warmly, ' + name + '.');
    try {
      await db.setSignerName(meId, name);
    } catch (err) {
      console.error(err);
    }
  };

  // The single commit path for an editing box (D-028): called both from the
  // box's own onBlur (focus genuinely leaving it) and from onSurfaceDown
  // (clicking elsewhere on the canvas). Saves the text and, if the inline
  // sign field held a name and this participant hasn't signed yet, adopts
  // it in the same motion. Handles both regular notes and cover-template
  // text (which never signs) — cover objects just skip the signing half.
  const commitBox = async (id) => {
    if (commitBoxRef.current === id) return;
    commitBoxRef.current = id;
    try {
      const o = objects.find((x) => x.id === id);
      if (!o) return;
      if (!(o.text || '').trim() && !o.cover_kind) {
        setObjects((prev) => prev.filter((x) => x.id !== id));
        setEditingId(null);
        setSignName('');
        return;
      }
      const name = (signName || '').trim();
      const isRename = !!meName;
      const nameChanged = !!name && name !== meName && !o.cover_kind;
      const shouldPrompt = !meName && !nameChanged && !o.cover_kind;
      setEditingId(null);
      setSignName('');
      if (o.pending) {
        const { pending, ...rest } = o;
        try {
          await db.insertObject(rest);
          setObjects((prev) => prev.map((x) => (x.id === id ? { ...x, pending: false, promptSign: shouldPrompt } : x)));
        } catch (err) {
          setObjects((prev) => prev.filter((x) => x.id !== id));
          if (db.isCapRejection(err)) {
            showToast('This card’s full of signatures — time to send it');
          } else if (db.isRestingRejection(err)) {
            showToast('This card has settled — no more changes');
          } else {
            console.error(err);
            showToast('Could not save your note — try again');
          }
          return;
        }
      } else {
        db.updateObject(id, { text: o.text }).catch(console.error);
      }
      if (nameChanged) await adoptName(name, isRename);
    } finally {
      commitBoxRef.current = null;
    }
  };

  const startMove = (o, e, force) => {
    e.stopPropagation();
    if (editingId === o.id && !force) return;
    const isMine = o.owner_id === meId;
    if (!isMine && o.type !== 'sticker' && !o.communal) {
      if (card && card.unlimited) {
        if (!fullControl) {
          setConfirmControl(true);
          setSelectedId(null);
          return;
        }
      } else {
        setSelectedId(null);
        return;
      }
    }
    // tapEdit/signPrefill are captured now (fresh o/isMine/meName), so the
    // pointerup tap-check (D-049) never needs a stale re-lookup of objects.
    const tapEdit = o.type === 'text' && (isMine || o.communal || (card && card.unlimited && fullControl));
    gestureRef.current = { type: 'move', id: o.id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false, tapEdit, signPrefill: isMine ? meName || '' : '' };
    setSelectedId(o.id);
  };
  const centerOf = (id) => {
    const el = document.getElementById('obj-' + id);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const startResize = (o, e) => {
    e.stopPropagation();
    const c = centerOf(o.id);
    gestureRef.current = { type: 'resize', id: o.id, center: c, odist: Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1, oscale: o.scale || 1 };
  };
  const startRotate = (o, e) => {
    e.stopPropagation();
    const c = centerOf(o.id);
    gestureRef.current = { type: 'rotate', id: o.id, center: c, oang: Math.atan2(e.clientY - c.y, e.clientX - c.x), orot: o.rotation || 0 };
  };

  const deleteObject = (id) => {
    setObjects((prev) => prev.filter((x) => x.id !== id));
    setSelectedId(null);
    db.deleteObject(id).catch(console.error);
  };

  // Where a newly-written note appears on mobile: the centre of the
  // currently visible canvas, clamped inside the card — not the tap point
  // (D-034). Finger imprecision and the on-screen keyboard obstructing the
  // view make the actual touch point a poor landing spot there. Desktop
  // instead places the note at the click point (D-052, via clampToCard
  // below) — this platform split is deliberate, not a workaround.
  const viewportCenterCard = () => {
    const sc = scroller();
    if (!sc) return { x: dims.w / 2, y: dims.h / 2 };
    const r = sc.getBoundingClientRect();
    const p = surfacePoint({ clientX: r.left + sc.clientWidth / 2, clientY: r.top + sc.clientHeight / 2 });
    return { x: Math.max(0, Math.min(dims.w, p.x)), y: Math.max(0, Math.min(dims.h, p.y)) };
  };

  // Desktop: the note lands at the click point, clamped so the 240px box
  // (createText offsets by -120,-18) stays fully on the card (D-052).
  const clampToCard = (p) => ({
    x: Math.max(130, Math.min(dims.w - 130, p.x)),
    y: Math.max(30, Math.min(dims.h - 60, p.y)),
  });

  const onSurfaceDown = (e) => {
    if (!e.target || e.target.getAttribute('data-surface') !== '1') return;
    // The canvas itself isn't focusable, so without this the browser's
    // default mouseup-driven focus resolution blurs whatever we focus
    // programmatically in response to this same click (e.g. the textarea
    // just created below) — deleting a just-created empty note instantly.
    e.preventDefault();
    if (showSigners) setShowSigners(false);
    if (showCoverPicker) setShowCoverPicker(false);
    if (editingId) commitBox(editingId);
    if (selectedId) {
      setSelectedId(null);
      if (tool === 'write' || tool === 'photo') return;
    }
    const p = surfacePoint(e);
    if (tool === 'select') {
      const sc = scroller();
      if (sc) {
        gestureRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
        setPanning(true);
      }
    } else if (tool === 'write') {
      const c = mobileView ? viewportCenterCard() : clampToCard(p);
      createText(c.x, c.y);
    } else if (tool === 'draw') {
      drawPtsRef.current = [p];
      gestureRef.current = { type: 'draw' };
      setSelectedId(null);
      setLiveTick((t) => t + 1);
    } else if (tool === 'sticker') placeSticker(p.x, p.y);
    else if (tool === 'photo') {
      pendingPointRef.current = p;
      fileRef.current && fileRef.current.click();
    }
  };

  const setToolFn = (t) => {
    if (t === 'photo') {
      setTool('write');
      setShowStickers(false);
      pendingPointRef.current = { x: 700, y: 420 };
      fileRef.current && fileRef.current.click();
      return;
    }
    if (t === 'sticker') {
      setTool('sticker');
      setShowStickers((s) => !s);
      return;
    }
    setTool(t);
    setShowStickers(false);
    setShowCoverPicker(false);
    setShowTemplates(false);
    if (t === 'select') setSelectedId(null);
  };

  const onSwatch = (c) => {
    if (tool === 'draw') {
      setPenColor(c);
      return;
    }
    setTextColor(c);
    const selObj = selectedId ? objects.find((o) => o.id === selectedId) : null;
    const tid = editingId || (selObj && selObj.type === 'text' && selObj.owner_id === meId ? selectedId : null);
    if (tid) {
      setObjects((prev) => prev.map((o) => (o.id === tid ? { ...o, color: c } : o)));
      db.updateObject(tid, { color: c }).catch(console.error);
    }
  };
  const setFontFn = (f) => {
    setTextFont(f);
    const selObj = selectedId ? objects.find((o) => o.id === selectedId) : null;
    const tid = editingId || (selObj && selObj.type === 'text' && selObj.owner_id === meId ? selectedId : null);
    if (tid) {
      setObjects((prev) => prev.map((o) => (o.id === tid ? { ...o, font: f } : o)));
      db.updateObject(tid, { font: f }).catch(console.error);
    }
  };

  const addPhotoTo = (id) => {
    fillPhotoIdRef.current = id;
    fileRef.current && fileRef.current.click();
  };
  const editCaption = (id) => setCaptionId(id);
  const finishCaption = () => {
    if (captionId) {
      const o = objects.find((x) => x.id === captionId);
      if (o) db.updateObject(captionId, { caption: o.caption }).catch(console.error);
    }
    setCaptionId(null);
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) {
      fillPhotoIdRef.current = null;
      return;
    }
    const localUrl = URL.createObjectURL(f);
    if (fillPhotoIdRef.current) {
      const id = fillPhotoIdRef.current;
      fillPhotoIdRef.current = null;
      setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, _localPreview: localUrl } : o)));
      setSelectedId(id);
      try {
        const path = await db.uploadPhoto(cardId, id, f);
        await db.updateObject(id, { photo_path: path });
        setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, photo_path: path, _localPreview: undefined } : o)));
      } catch (err) {
        console.error(err);
        showToast('Could not upload photo');
      }
      return;
    }
    const p = pendingPointRef.current || { x: 700, y: 420 };
    const id = crypto.randomUUID();
    const dbRow = {
      id,
      card_id: cardId,
      owner_id: meId,
      type: 'photo',
      face,
      communal: face === 'front',
      x: p.x - 110,
      y: p.y - 110,
      rotation: Math.random() * 8 - 4,
      scale: 1,
      photo_path: null,
      caption: '',
      tint: '#eef3ff',
    };
    setObjects((prev) => [...prev, { ...dbRow, _localPreview: localUrl }]);
    setSelectedId(id);
    setTool('write');
    try {
      await db.insertObject(dbRow);
      const path = await db.uploadPhoto(cardId, id, f);
      await db.updateObject(id, { photo_path: path });
      setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, photo_path: path, _localPreview: undefined } : o)));
    } catch (err) {
      console.error(err);
      setObjects((prev) => prev.filter((o) => o.id !== id));
      showToast('Could not upload photo');
    }
  };

  // ---- cover template -------------------------------------------------------
  const reseedCover = async (patch) => {
    // Commit before leaving, never just clear editingId (D-044) — otherwise
    // a note left open when the cover re-seeds keeps rendering as an
    // uncloseable edit box, since nothing points editingId at it any more.
    if (editingId) commitBox(editingId);
    const nextCard = { ...card, ...patch };
    setCard(nextCard);
    setSelectedId(null);
    try {
      await db.updateCard(cardId, {
        cover_color: nextCard.cover_color,
        cover_motif: nextCard.cover_motif,
        cover_layout: nextCard.cover_layout,
      });
      await db.deleteCoverObjects(cardId);
      const seeds = seedCoverObjects(nextCard.cover_layout, nextCard.cover_motif, nextCard.cover_color, nextCard.occasion, nextCard.recipient, nextCard.format).map((s) => ({
        ...s,
        card_id: cardId,
        owner_id: null,
      }));
      const inserted = await db.insertObjects(seeds);
      setObjects((prev) => [...prev.filter((o) => !(o.face === 'front' && o.cover_kind)), ...inserted]);
    } catch (err) {
      console.error(err);
      showToast('Could not update the cover');
    }
  };
  const setCover = (k) => {
    setShowCoverPicker(false);
    reseedCover({ cover_color: k });
  };
  const setMotif = (m) => reseedCover({ cover_motif: m });
  const setCoverLayout = (l) => {
    setShowTemplates(false);
    reseedCover({ cover_layout: l });
  };

  const dismissFaceCoach = () => {
    if (!showFaceCoach) return;
    setShowFaceCoach(false);
    try {
      localStorage.setItem('warmly_face_coach', '1');
    } catch {
      // ignore
    }
  };

  const setCanvasFace = (f) => {
    // Commit before leaving, never just clear editingId (D-044) — same
    // reasoning as reseedCover above.
    if (editingId) commitBox(editingId);
    dismissFaceCoach();
    setFace(f);
    setTool((t) => (f === 'front' && t === 'write' ? 'select' : t));
    setShowStickers(false);
    setShowCoverPicker(false);
    setShowTemplates(false);
    setSelectedId(null);
    setTimeout(() => setZoom(fitZoomFor(card ? card.format : 'landscape')), 0);
  };

  const copyLink = () => {
    const link = `${window.location.origin}/c/${cardId}`;
    try {
      navigator.clipboard && navigator.clipboard.writeText(link);
    } catch {
      // ignore
    }
    setCopied(true);
    showToast('Link copied — go share it!');
    copyTimerRef.current && clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2200);
  };

  const payNow = async () => {
    setUpgradeStage('done');
    try {
      await db.updateCard(cardId, { unlimited: true });
      setCard((c) => ({ ...c, unlimited: true }));
    } catch (err) {
      console.error(err);
    }
    showToast('Warmly Unlimited — no more signature limit');
  };

  const submitEmail = () => {
    const e = (sendEmail || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      showToast('Add a valid email address');
      return;
    }
    setShowSend(false);
    setSendEmail('');
    showToast('On its way to ' + e);
  };

  const openFeedback = () => {
    setShowFeedback(true);
    setFeedbackStage('open');
    setShowSigners(false);
    setShowSend(false);
    setSelectedId(null);
  };
  const closeFeedback = () => {
    setShowFeedback(false);
    setFeedbackStage('open');
    setFeedbackRating(0);
    setFeedbackText('');
  };
  const submitFeedback = async () => {
    if (!feedbackRating) {
      showToast('Pick a rating first');
      return;
    }
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, signerId: meId, rating: feedbackRating, comment: feedbackText }),
      });
      if (!res.ok) throw new Error('feedback_submit_failed');
      setFeedbackStage('sent');
      setFeedbackDone(true);
    } catch (err) {
      console.error(err);
      showToast('Could not send feedback — try again');
    }
    setFeedbackSubmitting(false);
  };

  const openDownload = () => {
    setShowDownload(true);
    setShowSend(false);
    setShowSigners(false);
    setShowCoverPicker(false);
    setSelectedId(null);
  };
  const closeDownload = () => setShowDownload(false);

  const armFeedbackTimer = () => {
    feedbackTimerRef.current && clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      if (!feedbackDone) openFeedback();
    }, 1200);
  };

  const fallbackToPrint = () => {
    const t = card ? COVERS[card.cover_color].tint : '#fff';
    try {
      document.documentElement.style.setProperty('--pg', t);
    } catch {
      // ignore
    }
    if (card) applyPrintPageSize(printMMFor(card.format, printSize));
    setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore
      }
      armFeedbackTimer();
    }, 80);
  };

  const rasterFace = async (html) => {
    const dims = cardDims(card.format);
    const tint = COVERS[card.cover_color].tint;
    const node = document.createElement('div');
    node.style.cssText = `position:fixed;left:-99999px;top:0;width:${dims.w}px;height:${dims.h}px;background:${tint};background-image:radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0);background-size:26px 26px;overflow:hidden;`;
    node.innerHTML = html;
    document.body.appendChild(node);
    try {
      const mm = printMMFor(card.format, printSize);
      const targetW = (mm.w / 25.4) * 300;
      const scale = Math.min(4, Math.max(1, targetW / dims.w));
      const canvas = await html2canvas(node, { scale, backgroundColor: tint, useCORS: true, logging: false });
      return canvas.toDataURL('image/jpeg', 0.95);
    } finally {
      document.body.removeChild(node);
    }
  };

  const downloadPdf = async () => {
    if (pdfBusy || !card) return;
    setShowSigners(false);
    setSelectedId(null);
    setPdfBusy(true);
    showToast('Building your PDF…');
    try {
      const mm = printMMFor(card.format, printSize);
      const land = mm.w > mm.h;
      const cover = await rasterFace(coverHtml.__html);
      const inside = await rasterFace(insideHtml.__html);
      const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: [mm.w, mm.h] });
      pdf.addImage(cover, 'JPEG', 0, 0, mm.w, mm.h, '', 'FAST');
      pdf.addPage([mm.w, mm.h], land ? 'landscape' : 'portrait');
      pdf.addImage(inside, 'JPEG', 0, 0, mm.w, mm.h, '', 'FAST');
      pdf.save(`warmly-${slugFor(card)}-${printSize}.pdf`);
      showToast('Card downloaded — ' + printSize.toUpperCase());
      setShowDownload(false);
      armFeedbackTimer();
    } catch (err) {
      console.error(err);
      setShowDownload(false);
      fallbackToPrint();
    }
    setPdfBusy(false);
  };

  const photoUrlFor = (o) => o._localPreview || (o.photo_path ? db.photoUrl(o.photo_path) : null);

  // ---- derived / computed values ---------------------------------------------
  const cov = card ? COVERS[card.cover_color] : COVERS.blue;
  const dims = card ? cardDims(card.format) : { w: 1600, h: 1150 };

  // The 14-day lifespan is stated only in the Share dialog now — no
  // near-expiry nudge and no countdown anywhere on the canvas (D-046).
  const DAY_MS = 24 * 60 * 60 * 1000;
  const archivesAt = card ? new Date(new Date(card.created_at).getTime() + 14 * DAY_MS) : null;
  const expiryDate = archivesAt ? archivesAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

  const nameMap = useMemo(() => {
    const m = {};
    signers.forEach((s) => {
      m[s.id] = s.name;
    });
    return m;
  }, [signers]);

  const otherSignerIds = useMemo(() => {
    const set = [];
    objects.forEach((o) => {
      if (o.owner_id && o.owner_id !== meId && o.type === 'text' && nameMap[o.owner_id] && !set.includes(o.owner_id)) set.push(o.owner_id);
    });
    return set;
  }, [objects, nameMap, meId]);

  const meHasText = objects.some((o) => o.owner_id === meId && o.type === 'text');
  const count = otherSignerIds.length + (meName && meHasText ? 1 : 0);
  const unlimited = !!(card && card.unlimited);
  const remaining = Math.max(0, LIMIT - count);
  const full = !unlimited && count >= LIMIT;
  const near = !unlimited && remaining <= 3;
  const signerLabel = unlimited ? count + ' signed' : count + ' of ' + LIMIT + ' signed';
  const pct = unlimited ? 100 : Math.min(100, Math.round((count / LIMIT) * 100));
  const capNote = unlimited ? 'Unlimited signatures on this card' : full ? 'This card’s full of signatures — time to send it' : remaining + ' of ' + LIMIT + ' spots left';

  const ownerColorFor = (ownerId) => (signers.find((s) => s.id === ownerId) || {}).color || '#2f6bff';
  const hasText = (ownerId) => objects.some((o) => o.owner_id === ownerId && o.type === 'text');

  let signersAvatars = otherSignerIds.map((ownerId, i) => ({
    key: ownerId,
    initial: ((nameMap[ownerId] || '?')[0] || '?').toUpperCase(),
    style: {
      width: 30,
      height: 30,
      borderRadius: 999,
      background: ownerColorFor(ownerId),
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 13,
      fontWeight: 700,
      border: '2px solid var(--canvas)',
      marginLeft: i ? '-8px' : '0',
      boxShadow: 'var(--shadow-xs)',
    },
  }));
  if (meName && meHasText) {
    signersAvatars = signersAvatars.concat([
      {
        key: 'me',
        initial: meName[0].toUpperCase(),
        style: {
          width: 30,
          height: 30,
          borderRadius: 999,
          background: participantRef.current.color,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          border: '2px solid var(--canvas)',
          marginLeft: signersAvatars.length ? '-8px' : '0',
          boxShadow: 'var(--shadow-xs)',
        },
      },
    ]);
  }
  // Cap the stack at 5 chips: 4 avatars + a "+N" overflow, so 20 signatures
  // can't widen the top bar (D-050). The full list stays in the popover.
  if (signersAvatars.length > 5) {
    signersAvatars = signersAvatars.slice(0, 4).concat([
      {
        key: 'overflow',
        initial: '+' + (signersAvatars.length - 4),
        style: {
          minWidth: 30,
          height: 30,
          padding: '0 7px',
          borderRadius: 999,
          background: 'var(--sunken)',
          color: 'var(--ink-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          border: '2px solid var(--canvas)',
          marginLeft: '-8px',
          boxShadow: 'var(--shadow-xs)',
        },
      },
    ]);
  }

  const signersFull = signers
    .filter((s) => s.name)
    .map((s) => {
      const removed = !hasText(s.id);
      return {
        id: s.id,
        name: s.name,
        dotStyle: { width: 12, height: 12, borderRadius: 999, background: s.color, flexShrink: 0, display: 'block', opacity: removed ? 0.4 : 1 },
        nameStyle: {
          fontFamily: "'Caveat',cursive",
          fontSize: 22,
          color: removed ? 'var(--ink-4)' : s.color,
          lineHeight: 1,
          flex: 1,
          textDecoration: removed ? 'line-through' : 'none',
          opacity: removed ? 0.7 : 1,
        },
        removed,
        isYou: s.id === meId,
      };
    });

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-sans)' }}>
        Loading…
      </div>
    );
  }
  if (notFound) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>This card doesn't exist.</div>
        <a href="/">Start a new one →</a>
      </div>
    );
  }
  if (archivesAt && Date.now() > archivesAt.getTime()) {
    // Temporary placeholder — a real "expired" page design is still pending
    // (see DECISIONS.md). This is deliberately plain: it only needs to stop
    // the canvas from rendering, not carry the final look.
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', textAlign: 'center', padding: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>This card has settled.</div>
        <p style={{ maxWidth: 360, color: 'var(--ink-3)', fontSize: 14, lineHeight: 1.5, margin: 0 }}>It was open for signing for two weeks and isn't taking new changes anymore.</p>
        <a href="/">Start a new one →</a>
      </div>
    );
  }

  const swatchColors = ['#16181d', '#2f6bff', '#ec5b9c', '#8b5cf6', '#0ead74', '#fb7b43'];
  const stop = (e) => e.stopPropagation();

  const objs = objects
    .filter((o) => (o.face || 'inside') === face)
    .map((o) => buildObjectDescriptor(o));

  function buildObjectDescriptor(o) {
    const fc = unlimited && fullControl;
    const mine = o.owner_id === meId;
    const canEdit = mine || o.communal || fc;
    const grabbable = mine || o.type === 'sticker' || o.communal || fc;
    const selected = selectedId === o.id;
    // `editingId` is the only source of truth for "this note is open" — never
    // mirror it in a per-object flag, or a path that clears editingId without
    // committing (e.g. switching faces) can leave an object rendering as open
    // with nothing that still points at it to close it (D-044).
    const isThisEditing = editingId === o.id;
    const scale = o.scale || 1;
    const rot = o.rotation || 0;
    const base = { position: 'absolute', left: o.x + 'px', top: o.y + 'px', transformOrigin: 'center center', zIndex: selected ? 50 : o.type === 'draw' ? 6 : 12, touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' };
    const d = { id: o.id, isText: o.type === 'text', isPhoto: o.type === 'photo', isSvg: o.type === 'sticker' || o.type === 'draw', stop };
    d.onDown = (e) => startMove(o, e);
    d.onEdit = () => {
      if (canEdit && o.type === 'text') {
        setEditingId(o.id);
        setSelectedId(o.id);
        // Pre-fill with the existing signature (own notes only — cover
        // text and others' notes never sign) so the always-present sign
        // field in the edit box doubles as a rename control, not just a
        // first-time prompt.
        setSignName(mine ? meName || '' : '');
      }
    };
    d.onResize = (e) => startResize(o, e);
    d.onRotate = (e) => startRotate(o, e);
    d.onDeleteDown = (e) => e.stopPropagation();
    d.onDelete = (e) => {
      e.stopPropagation();
      deleteObject(o.id);
    };
    // Selection chrome stays visible while editing too (D-054) — the frame
    // and rotate/resize/remove handles don't disappear just because the
    // note is open, and a dedicated move grip appears since dragging the
    // object body while a textarea has focus would fight text selection.
    d.showFrame = grabbable && selected;
    // Handles are chrome, not content: they sit inside an element scaled by
    // objectScale × canvasZoom, so without counter-scaling a 32px control
    // would render at a few px on a zoomed-out phone. Counter-scale to a
    // constant on-screen size (D-054).
    const k = Math.max(0.05, scale * (zoom || 1));
    const inv = 1 / k;
    const hSize = mobileView ? 42 : 32,
      hIcon = mobileView ? 17 : 14;
    const hBase = { position: 'absolute', width: hSize + 'px', height: hSize + 'px', borderRadius: '999px', background: 'var(--white)', boxShadow: 'var(--shadow-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', zIndex: 60 };
    d.hIcon = hIcon;
    d.frameStyle = { position: 'absolute', inset: '-8px', border: 1.5 * inv + 'px solid var(--blue)', borderRadius: 12 * inv + 'px', pointerEvents: 'none' };
    d.hMove = { ...hBase, left: 0, bottom: 0, transform: `translate(-50%,50%) scale(${inv})`, border: '1.5px solid var(--blue)', cursor: 'grab' };
    d.hRotate = { ...hBase, left: '50%', top: 0, transform: `translate(-50%,-50%) translateY(${-26 * inv}px) scale(${inv})`, border: '1.5px solid var(--blue)', cursor: 'grab' };
    d.hResize = { ...hBase, right: 0, bottom: 0, transform: `translate(50%,50%) scale(${inv})`, border: '1.5px solid var(--blue)', cursor: 'nwse-resize' };
    d.hDelete = { ...hBase, left: 0, top: 0, transform: `translate(-50%,-50%) scale(${inv})`, border: '1.5px solid var(--line-strong)', cursor: 'pointer' };
    d.showMoveGrip = grabbable && selected && isThisEditing;
    d.onGripMove = (e) => startMove(o, e, true);

    if (o.type === 'text' && o.cover_kind) {
      const cfam = o.font || 'var(--font-sans)';
      d.style = { ...base, width: o.width + 'px', transform: `rotate(${rot}deg) scale(${scale})`, cursor: isThisEditing ? 'text' : 'grab' };
      d.text = o.text;
      d.isEditing = isThisEditing;
      d.notEditing = !isThisEditing;
      const ctstyle = { fontFamily: cfam, fontSize: o.fsize + 'px', lineHeight: 1.02, color: o.color, fontWeight: o.weight || 700, letterSpacing: '-0.02em', textAlign: o.align || 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
      d.textStyle = ctstyle;
      d.taStyle = { ...ctstyle, width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', padding: 0, margin: 0, minHeight: o.fsize + 'px', overflow: 'hidden', display: 'block' };
      d.showSig = false;
      d.showPlaceholder = false;
      d.showEditSign = false;
      d.taId = 'ta-' + o.id;
      d.onTextChange = (e) => onTextChange(o.id, e);
      d.onBoxBlur = (e) => {
        if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
        commitBox(o.id);
      };
    } else if (o.type === 'text') {
      const fs = o.font === 'Caveat' ? 30 : 18;
      d.style = { ...base, width: '240px', transform: `rotate(${rot}deg) scale(${scale})`, cursor: isThisEditing ? 'text' : mine ? 'grab' : 'default' };
      d.text = o.text;
      d.isEditing = isThisEditing;
      d.notEditing = !isThisEditing;
      const tstyle = { fontFamily: o.font === 'Caveat' ? "'Caveat',cursive" : 'var(--font-sans)', fontSize: fs + 'px', lineHeight: o.font === 'Caveat' ? 1.15 : 1.45, color: o.color, fontWeight: o.font === 'Caveat' ? 600 : 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
      d.textStyle = tstyle;
      d.taStyle = { ...tstyle, width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', padding: 0, margin: 0, minHeight: fs + 'px', overflow: 'hidden', display: 'block' };
      // The signature is never independently editable — tapping it opens
      // the whole note's edit box, exactly like tapping the message, via
      // the same onDoubleClick on the outer element. There is no separate
      // tap-to-rename mode (that was removed, D-036 — do not reintroduce
      // it); renaming happens through d.showEditSign inside the edit box.
      const existingSignerName = mine ? meName : nameMap[o.owner_id];
      d.showSig = !!existingSignerName;
      d.sigName = existingSignerName ? '— ' + existingSignerName : '';
      const sigFam = o.font === 'Caveat' ? "'Caveat',cursive" : 'var(--font-sans)';
      const sigFs = o.font === 'Caveat' ? 25 : 16;
      d.sigStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', fontWeight: o.font === 'Caveat' ? 600 : 500, color: o.color, marginTop: 4, opacity: 0.9, display: 'inline-block' };
      d.showPlaceholder = mine && !meName && o.promptSign;
      d.placeholderStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', color: '#b9bbc1', marginTop: 4 };
      d.taId = 'ta-' + o.id;
      d.onTextChange = (e) => onTextChange(o.id, e);
      d.onBoxBlur = (e) => {
        if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
        commitBox(o.id);
      };
      // Always present while editing your own note — pre-filled once
      // signed, so it doubles as the rename control (README "Signing").
      d.showEditSign = mine;
      d.editSignId = 'esign-' + o.id;
      d.editSignValue = signName;
      d.onEditSignChange = (e) => setSignName(e.target.value);
      d.onEditSignKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitBox(o.id);
        }
      };
      d.editSignRowStyle = { marginTop: 6, paddingTop: 6, borderTop: '1px dashed color-mix(in srgb,' + o.color + ' 35%,transparent)' };
      d.editSignStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', fontWeight: o.font === 'Caveat' ? 600 : 500, color: o.color, border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, width: '100%', display: 'block' };
    } else if (o.type === 'photo') {
      d.style = { ...base, transform: `rotate(${rot}deg) scale(${scale})`, cursor: mine ? 'grab' : 'default' };
      d.photoCardStyle = { background: '#fff', padding: '12px 12px 14px', borderRadius: 8, boxShadow: 'var(--shadow-md)' };
      const src = photoUrlFor(o);
      const empty = !src;
      if (empty && mine) {
        d.photoHtml = {
          __html: `<div style="width:200px;height:200px;border-radius:6px;background:${o.tint || '#eef3ff'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#7d8aa8;cursor:pointer;"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#7d8aa8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="8.5" cy="11" r="1.6"/><path d="M21 17l-5-5-8 8"/><path d="M12 3v3M10.5 4.5h3" /></svg><span style="font-family:'Inter',sans-serif;font-size:14px;font-weight:600;">Add photo</span></div>`,
        };
      } else {
        const isrc = src || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        d.photoHtml = {
          __html: `<img src="${isrc}" draggable="false" style="width:200px;height:200px;object-fit:cover;border-radius:6px;display:block;pointer-events:none;background-color:${o.tint || '#eef3ff'};background-image:radial-gradient(circle at 30% 30%, rgba(255,255,255,.4) 0 1px, transparent 0);background-size:14px 14px;">`,
        };
      }
      d.onPhotoTap = empty && mine ? (e) => { e.stopPropagation(); addPhotoTo(o.id); } : () => {};
      d.photoAreaDown = empty && mine ? (e) => e.stopPropagation() : () => {};
      const capEditing = mine && captionId === o.id;
      d.editingCaption = capEditing;
      d.notEditingCaption = !capEditing;
      d.capId = 'cap-' + o.id;
      d.caption = o.caption || '';
      d.captionDisplay = o.caption && o.caption.trim() ? o.caption : mine ? 'Add a caption…' : '';
      d.captionStyle = { fontFamily: "'Caveat',cursive", fontSize: 22, color: o.caption && o.caption.trim() ? 'var(--ink-2)' : '#b9bbc1', textAlign: 'center', marginTop: 8, minHeight: 26, cursor: mine ? 'text' : 'default' };
      d.onEditCap = mine ? (e) => { e.stopPropagation(); editCaption(o.id); } : () => {};
      d.capDown = mine ? (e) => e.stopPropagation() : () => {};
      d.onCapChange = (e) => {
        const val = e.target.value;
        setObjects((prev) => prev.map((x) => (x.id === o.id ? { ...x, caption: val } : x)));
      };
      d.onCapKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finishCaption();
        }
      };
      d.onCapBlur = () => finishCaption();
      d.capInputStyle = { fontFamily: "'Caveat',cursive", fontSize: 22, color: 'var(--ink-2)', textAlign: 'center', marginTop: 8, width: '100%', border: 'none', borderBottom: '1.5px dashed var(--line-strong)', outline: 'none', background: 'transparent', padding: '0 0 2px' };
    } else {
      d.style = { ...base, transform: `rotate(${rot}deg) scale(${scale})`, cursor: grabbable ? 'grab' : 'default' };
      d.svgHtml = o.type === 'sticker' ? { __html: stickerSvg(o.kind, 90) } : { __html: `<svg width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" style="overflow:visible;display:block;"><path d="${o.path_data}" fill="none" stroke="${o.color}" stroke-width="${o.stroke_width}" stroke-linecap="round" stroke-linejoin="round"/></svg>` };
    }
    return d;
  }

  const tb = (active) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 60, padding: '8px 0', borderRadius: 16, border: 'none', cursor: 'pointer', background: active ? 'var(--ink-1)' : 'transparent', color: active ? '#fff' : 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, transition: 'background var(--dur-base) var(--ease-standard),color var(--dur-base)' });
  const selObj = selectedId ? objects.find((o) => o.id === selectedId) : null;
  const activeFont = selObj && selObj.type === 'text' ? selObj.font : textFont;
  const swatches = swatchColors.map((c) => {
    const act = (tool === 'draw' ? penColor : textColor) === c;
    return { key: c, style: { width: 24, height: 24, borderRadius: 999, background: c, cursor: 'pointer', border: act ? '2px solid var(--ink-1)' : '2px solid var(--white)', boxShadow: act ? '0 0 0 1.5px var(--ink-1)' : 'var(--shadow-xs)', outline: 'none', transform: act ? 'scale(1.12)' : 'none', transition: 'transform var(--dur-fast) var(--ease-bounce)' }, onClick: () => onSwatch(c) };
  });
  const stickerBtn = (sel) => ({ width: 46, height: 46, borderRadius: 14, border: 'none', background: sel ? 'var(--sunken)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 });
  const stickerChoices = ['heart', 'star', 'balloon', 'cake', 'spark', 'flower'].map((k) => ({ key: k, svgHtml: { __html: stickerSvg(k, 34) }, style: stickerBtn(stickerKind === k && tool === 'sticker'), onClick: () => chooseSticker(k) }));
  const fontBtn = (sel, fam) => ({ width: 40, height: 32, borderRadius: 10, border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line)', background: sel ? 'var(--ink-1)' : 'transparent', color: sel ? '#fff' : 'var(--ink-2)', cursor: 'pointer', fontFamily: fam, fontSize: fam.indexOf('Caveat') >= 0 ? 20 : 15, fontWeight: 600, lineHeight: 1 });
  const tplStyle = (sel) => ({ flex: 1, height: 40, borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12.5, background: sel ? 'var(--ink-1)' : 'var(--white)', color: sel ? '#fff' : 'var(--ink-2)', border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line-strong)' });
  const faceTabStyle = (sel) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, background: sel ? 'var(--ink-1)' : 'transparent', color: sel ? '#fff' : 'var(--ink-3)', transition: 'background var(--dur-base),color var(--dur-base)' });

  const coverSwatches = ['blue', 'pink', 'green', 'yellow', 'purple'].map((k) => {
    const c = COVERS[k];
    const sel = card.cover_color === k;
    return { key: k, name: k, onClick: () => setCover(k), style: { width: 30, height: 30, borderRadius: 999, cursor: 'pointer', background: c.dot, border: sel ? '3px solid var(--ink-1)' : '3px solid var(--white)', boxShadow: sel ? '0 0 0 1.5px var(--ink-1)' : 'var(--shadow-xs)', outline: 'none', transform: sel ? 'scale(1.08)' : 'none', transition: 'transform var(--dur-fast) var(--ease-bounce)' } };
  });

  // The surface is scaled with `transform`, never CSS `zoom` — every
  // coordinate downstream (surfacePoint, draw points, gesture math) divides
  // by `zoom` after reading this element's getBoundingClientRect(), and
  // `zoom`'s effect on that rect is inconsistent across engines (iOS in
  // particular), which used to collapse taps/strokes toward the top-left at
  // non-1.0 scale. `transform`'s contribution to the rect is well-specified
  // everywhere. The box below supplies the *layout* size (so the scroll
  // container gets correct, zoom-aware scroll bounds); this element supplies
  // only the *visual* scale, anchored at its own top-left.
  const surfaceBoxStyle = { position: 'relative', width: dims.w * zoom + 'px', height: dims.h * zoom + 'px', margin: 'auto', flexShrink: 0 };
  const surfaceStyle = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: dims.w + 'px',
    height: dims.h + 'px',
    transform: `scale(${zoom})`,
    transformOrigin: 'top left',
    borderRadius: 24,
    backgroundColor: cov.tint,
    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)',
    backgroundSize: '26px 26px',
    boxShadow: '0 34px 70px -26px rgba(20,24,29,.34), 0 8px 22px -10px rgba(20,24,29,.20)',
    cursor: tool === 'draw' ? 'crosshair' : tool === 'write' ? 'text' : tool === 'sticker' ? 'copy' : tool === 'select' ? (panning ? 'grabbing' : 'grab') : 'default',
    // Draw needs explicit gesture ownership on touch, or the scroll
    // container claims the drag as a scroll before any pointermove fires
    // (D-039). Scoped to Draw only so panning/scrolling is unaffected with
    // every other tool. Everywhere else: pan-x pan-y (not the default auto)
    // so one-finger scrolling still works while the browser yields the
    // two-finger gesture to the app's own pinch handling (D-053) instead of
    // native pinch-zoom, which never reliably applied here anyway since
    // every object sets touch-action:none.
    touchAction: tool === 'draw' ? 'none' : 'pan-x pan-y',
  };
  // On mobile the canvas fills exactly the window between the edge-anchored
  // bars (never clipping behind either), using the same measured heights
  // fitZoomFor reads (D-031). Desktop's floating chrome sits on top of a
  // full-bleed canvas instead, so it keeps inset:0.
  // Mobile gets a solid, edge-anchored top app bar instead of a floating
  // pill row (D-031) — the same header controls, just docked to the edge so
  // they can't overlap the way five independent floating pills did on a
  // narrow viewport.
  const headerStyle = mobileView
    ? { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 56, background: 'var(--white)', borderBottom: '1px solid var(--line)', padding: 'calc(8px + env(safe-area-inset-top)) 12px 8px' }
    : { position: 'absolute', top: 16, left: 16, right: 16, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, pointerEvents: 'none', zIndex: 100 };
  const wrapStyle = mobileView
    ? { position: 'absolute', top: 'var(--m-topbar, 56px)', bottom: 'var(--m-bottombar, 90px)', left: 0, right: 0, overflow: 'hidden', backgroundColor: '#ece8e0', backgroundImage: 'radial-gradient(circle at 50% 32%, rgba(255,255,255,.5), transparent 60%)', '--pg': cov.tint }
    : { position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#ece8e0', backgroundImage: 'radial-gradient(circle at 50% 32%, rgba(255,255,255,.5), transparent 60%)', '--pg': cov.tint };
  const coverFrontStyle = { position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px', animation: 'coverLift .76s var(--ease-out) forwards' };
  // Mobile gets a solid, edge-anchored bottom tool bar instead of a floating
  // column (D-031) — context rows (colour/font, stickers, templates,
  // background) dock full-width above the tool row inside the same bar.
  const toolbarStyle = mobileView
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, width: '100%', maxWidth: '100%', background: 'var(--white)', borderTop: '1px solid var(--line)', padding: '8px 10px calc(8px + env(safe-area-inset-bottom))' }
    : { position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 'max-content', maxWidth: 'calc(100vw - 24px)' };

  let liveDrawHtml = null;
  if (drawPtsRef.current && drawPtsRef.current.length > 1) {
    const dd = 'M ' + drawPtsRef.current.map((p) => p.x + ' ' + p.y).join(' L ');
    liveDrawHtml = { __html: `<path d="${dd}" fill="none" stroke="${penColor}" stroke-width="${penWidth}" stroke-linecap="round" stroke-linejoin="round"/>` };
  }

  const recipientName = (card.recipient || '').trim() || 'them';
  const occasionWord = occasionInfo(card.occasion).cover;
  const link = `${window.location.origin}/c/${cardId}`;
  const showColorRow = (tool === 'write' && face === 'inside') || tool === 'draw' || (selObj && selObj.type === 'text');
  const showFontToggle = (tool === 'write' && face === 'inside') || (selObj && selObj.type === 'text' && !selObj.cover_kind);
  const showHint = !objects.some((o) => (o.face || 'inside') === 'inside');

  const resolveSignerName = (ownerId) => (ownerId === meId ? meName : nameMap[ownerId]);
  const insideHtml = { __html: objectsToHTML(objects.filter((o) => (o.face || 'inside') === 'inside'), (p) => (p ? db.photoUrl(p) : null), resolveSignerName) };
  const coverHtml = { __html: objectsToHTML(objects.filter((o) => o.face === 'front'), (p) => (p ? db.photoUrl(p) : null), resolveSignerName) };

  const previewScale = () => {
    const w = (typeof window !== 'undefined' && window.innerWidth) || 1000;
    return Math.min(720, Math.max(300, w - 380)) / dims.w;
  };
  const printMM = printMMFor(card.format, printSize);
  const printPxW = (printMM.w * 96) / 25.4;
  const printPxH = (printMM.h * 96) / 25.4;
  const printScale = Math.min(printPxW / dims.w, printPxH / dims.h);
  const orientationLabel = card.format === 'landscape' ? 'Landscape' : 'Portrait';
  const sizeDetail = printSize.toUpperCase() + ' · ' + printMM.w + ' × ' + printMM.h + ' mm — copy these numbers to your print shop.';
  const mockW = card.format === 'portrait' ? 270 : 330;
  const mockK = mockW / dims.w;
  const mockH = Math.round(dims.h * mockK);

  // Shared between the desktop Signatures pill and the mobile ⋯ overflow —
  // same popover, two different triggers/anchors. Desktop anchors to the
  // pill's own wrapper (left:0); mobile anchors to the ⋯ icon group (right:0)
  // — it was appearing under Download when both used the same right:0.
  const renderSignersPopover = (anchor) => showSigners && (
    <div style={{ position: 'absolute', ...anchor, width: 250, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', padding: '16px 18px', animation: 'fadeUp .2s var(--ease-out)', zIndex: 140 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Signatures</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: full ? 'var(--green-ink)' : 'var(--ink-3)' }}>
          {count} / {unlimited ? '∞' : LIMIT}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--sunken)', overflow: 'hidden', marginBottom: 7 }}>
        <div style={{ height: '100%', width: pct + '%', borderRadius: 999, background: full || unlimited ? 'var(--green)' : 'var(--orange)', transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16 }}>{capNote}.</div>
      {FEATURE_MONETIZATION && !unlimited && (
        <button
          onClick={() => {
            setShowUpgrade(true);
            setUpgradeStage('plan');
            setShowSigners(false);
            setSelectedId(null);
          }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', height: 40, borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13.5, marginBottom: 16, background: near ? 'var(--green)' : 'var(--green-soft)', color: near ? '#fff' : 'var(--green-ink)', boxShadow: near ? 'var(--shadow-brand)' : 'none' }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2.4 5.3 5.6.5-4.3 3.7 1.3 5.5L12 20.6 6.9 23.5l1.3-5.5L4 14.3l5.6-.5z"></path>
          </svg>
          <span>{full ? 'Upgrade to add more' : 'Upgrade for unlimited'}</span>
        </button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 260, overflow: 'auto' }}>
        {signersFull.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={s.dotStyle} />
            <span style={s.nameStyle}>{s.name}</span>
            {s.removed && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', background: 'var(--sunken)', padding: '2px 8px', borderRadius: 999 }}>removed</span>}
            {s.isYou && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-4)', background: 'var(--sunken)', padding: '2px 8px', borderRadius: 999 }}>you</span>}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
    <div data-app="" style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--canvas)', fontFamily: 'var(--font-sans)', color: 'var(--ink-1)' }}>
      <div data-cardwrap="" style={wrapStyle}>
        <div data-scroll="" ref={scrollRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', padding: 56, boxSizing: 'border-box' }}>
          <div data-surfacebox="" style={surfaceBoxStyle}>
          <div ref={surfaceRef} data-surface="1" onPointerDown={onSurfaceDown} style={surfaceStyle}>
            {face === 'inside' && showHint && (
              <div style={{ position: 'absolute', left: '50%', top: '44%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none', color: 'var(--ink-4)' }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8, opacity: 0.7 }}>
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                </svg>
                <div style={{ fontFamily: "'Caveat',cursive", fontSize: 30, color: 'var(--ink-3)' }}>Tap anywhere to write inside…</div>
              </div>
            )}

            {objs.map((d) => (
              <ObjectView key={d.id} d={d} />
            ))}

            {!!liveDrawHtml && <svg style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 60 }} dangerouslySetInnerHTML={liveDrawHtml} />}

            {opening && (
              <div style={coverFrontStyle}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Caveat',cursive", fontSize: 26, color: cov.ink, opacity: 0.85, marginBottom: 6 }}>{occasionWord}</div>
                  <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em', color: cov.ink }}>{card.recipient}</div>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* header */}
        <div ref={topBarRef} data-chrome="" data-topbar="" style={headerStyle}>
          <a
            href="/"
            title="Back to Warmly"
            style={
              mobileView
                ? { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 999, flexShrink: 0, textDecoration: 'none' }
                : { justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 9, background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '9px 18px', boxShadow: 'var(--shadow-sm)', pointerEvents: 'auto', cursor: 'pointer', fontFamily: 'var(--font-sans)', textDecoration: 'none' }
            }
          >
            <svg width="22" height="26" viewBox="13 3 56 66" fill="none" style={{ display: 'block', flexShrink: 0 }} aria-label="Warmly">
              <rect x="48.5332" y="5.04541" width="7.46" height="52.1592" rx="3.73" transform="rotate(41.5282 48.5332 5.04541)" fill="var(--orange)" />
              <rect x="44.0662" y="29.4248" width="8.46" height="19.7078" rx="4.23" transform="rotate(41.5282 44.0662 29.4248)" fill="var(--orange)" />
              <rect width="7.46" height="39.8291" rx="3.73" transform="matrix(-0.748629 -0.662989 -0.662989 0.748629 66.3255 37.2725)" fill="var(--orange)" />
              <rect x="42.0993" y="38.0718" width="9.45987" height="26.384" rx="4.72993" transform="rotate(86.5282 42.0993 38.0718)" fill="var(--orange)" />
              <rect width="9.45987" height="26.384" rx="4.72993" transform="matrix(0.998165 -0.0605567 -0.0605567 -0.998165 34.5342 65.6387)" fill="var(--orange)" />
              <path d="M17.9235 49.1211L25.8523 56.1429L33.7811 63.1647L20.8268 63.9506C19.7243 64.0175 18.7763 63.1779 18.7094 62.0754L17.9235 49.1211Z" fill="#FA6828" />
            </svg>
            {!mobileView && <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>Warmly</span>}
          </a>

          <div style={{ position: 'relative', justifySelf: 'center', display: 'flex', alignItems: 'center', gap: 3, background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 4, boxShadow: 'var(--shadow-sm)', pointerEvents: 'auto' }}>
            <button onClick={() => setCanvasFace('front')} style={faceTabStyle(face === 'front')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="3" width="14" height="18" rx="2"></rect>
                <path d="M9 7h6"></path>
              </svg>
              {(!mobileView || face === 'front') && 'Cover'}
            </button>
            <button onClick={() => setCanvasFace('inside')} style={faceTabStyle(face === 'inside')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6l10 3 10-3"></path>
                <path d="M2 6v12l10 3 10-3V6"></path>
                <path d="M12 9v12"></path>
              </svg>
              {(!mobileView || face === 'inside') && 'Content'}
            </button>
            {mobileView && showFaceCoach && (
              <div
                onClick={dismissFaceCoach}
                style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: 'var(--ink-1)', color: '#fff', padding: '8px 14px', borderRadius: 'var(--radius-md)', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: 'var(--shadow-lg)', zIndex: 150, cursor: 'pointer', animation: 'fadeUp .3s var(--ease-out)' }}
              >
                Your card has two sides · Tap to flip
              </div>
            )}
          </div>

          {mobileView ? (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setShowMore((s) => !s)}
                title="More"
                style={{ position: 'relative', width: 40, height: 40, borderRadius: 999, border: '1px solid var(--line)', background: showMore ? 'var(--ink-1)' : 'var(--white)', color: showMore ? '#fff' : 'var(--ink-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5" cy="12" r="1.6"></circle>
                  <circle cx="12" cy="12" r="1.6"></circle>
                  <circle cx="19" cy="12" r="1.6"></circle>
                </svg>
                {count > 0 && (
                  <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 999, background: 'var(--brand)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', border: '1.5px solid var(--white)' }}>{count}</span>
                )}
              </button>
              <button
                onClick={() => { setShowSend(true); setShowSigners(false); setShowMore(false); setSelectedId(null); }}
                title="Share"
                style={{ width: 40, height: 40, padding: 0, borderRadius: 999, border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--ink-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <path d="M8.6 13.5l6.8 4"></path>
                  <path d="M15.4 6.5l-6.8 4"></path>
                </svg>
              </button>
              <button
                onClick={() => { openDownload(); setShowMore(false); }}
                title="Download"
                style={{ width: 40, height: 40, padding: 0, borderRadius: 999, border: 'none', background: 'var(--brand)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <path d="M7 10l5 5 5-5"></path>
                  <path d="M12 15V3"></path>
                </svg>
              </button>

              {showMore && (
                <div style={{ position: 'absolute', top: 48, left: 0, width: 190, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 140, animation: 'fadeUp .2s var(--ease-out)' }}>
                  <button
                    onClick={() => { setShowSigners(true); setShowMore(false); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}
                  >
                    <span>Signatures</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>{unlimited ? count : `${count}/${LIMIT}`}</span>
                  </button>
                  <button
                    onClick={() => { setShowMore(false); openFeedback(); }}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14, fontWeight: 600, color: 'var(--ink-1)' }}
                  >
                    Feedback
                  </button>
                </div>
              )}
              {renderSignersPopover({ top: 52, right: 0 })}
            </div>
          ) : (
            <div style={{ justifySelf: 'end', position: 'relative', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowSigners((s) => !s)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '6px 12px 6px 10px', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    {signersAvatars.map((s) => (
                      <div key={s.key} style={s.style}>
                        {s.initial}
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>{signerLabel}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform var(--dur-fast) var(--ease-standard)', transform: showSigners ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
                    <path d="M6 9l6 6 6-6"></path>
                  </svg>
                </button>
                {renderSignersPopover({ top: 'calc(100% + 8px)', left: 0 })}
              </div>
              <button onClick={() => { setShowSend(true); setShowSigners(false); setSelectedId(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', borderRadius: 999, border: '1px solid var(--line)', background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', color: 'var(--ink-1)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-sm)', flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"></circle>
                  <circle cx="6" cy="12" r="3"></circle>
                  <circle cx="18" cy="19" r="3"></circle>
                  <path d="M8.6 13.5l6.8 4"></path>
                  <path d="M15.4 6.5l-6.8 4"></path>
                </svg>
                <span>Share</span>
              </button>
              <button
                onClick={openDownload}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', borderRadius: 999, border: 'none', background: 'var(--brand)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-brand)', flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <path d="M7 10l5 5 5-5"></path>
                  <path d="M12 15V3"></path>
                </svg>
                <span>Download</span>
              </button>
            </div>
          )}
        </div>

        {/* toolbar */}
        <div ref={bottomBarRef} data-chrome="" data-bottombar="" style={toolbarStyle}>
          {showTemplates && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '7px 12px', boxShadow: 'var(--shadow-lg)', animation: 'fadeUp .25s var(--ease-out)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginRight: 2 }}>Template</span>
              <button onClick={() => setCoverLayout('centered')} style={tplStyle(card.cover_layout === 'centered')}>Centered</button>
              <button onClick={() => setCoverLayout('bold')} style={tplStyle(card.cover_layout === 'bold')}>Big name</button>
              <button onClick={() => setCoverLayout('playful')} style={tplStyle(card.cover_layout === 'playful')}>Playful</button>
            </div>
          )}

          {showStickers && (
            <div style={{ display: 'flex', gap: 6, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '8px 10px', boxShadow: 'var(--shadow-lg)', animation: 'fadeUp .25s var(--ease-out)' }}>
              {stickerChoices.map((k) => (
                <button key={k.key} onClick={k.onClick} style={k.style}>
                  <div dangerouslySetInnerHTML={k.svgHtml} />
                </button>
              ))}
            </div>
          )}

          {showCoverPicker && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '8px 14px 8px 12px', boxShadow: 'var(--shadow-lg)', animation: 'fadeUp .25s var(--ease-out)' }}>
              {coverSwatches.map((c) => (
                <button key={c.key} onClick={c.onClick} title={c.name} style={c.style} />
              ))}
              <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>Sets the card colour for everyone</span>
            </div>
          )}

          {showColorRow && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '8px 12px', boxShadow: 'var(--shadow-lg)', animation: 'fadeUp .25s var(--ease-out)' }}>
              {swatches.map((c) => (
                <button key={c.key} onClick={c.onClick} style={c.style} />
              ))}
              {showFontToggle && (
                <>
                  <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 2px' }} />
                  <button onClick={() => setFontFn('Caveat')} style={fontBtn(activeFont === 'Caveat', "'Caveat',cursive")}>Aa</button>
                  <button onClick={() => setFontFn('Inter')} style={fontBtn(activeFont === 'Inter', 'var(--font-sans)')}>Aa</button>
                </>
              )}
            </div>
          )}

          <div data-toolpill="" style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 8, boxShadow: 'var(--shadow-lg)' }}>
            <button onClick={() => setToolFn('select')} style={tb(tool === 'select' && !showTemplates && !showStickers && !showCoverPicker)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"></path>
                <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"></path>
                <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"></path>
                <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>
              </svg>
              <span>Move</span>
            </button>
            <div style={{ width: 1, height: 30, background: 'var(--line)', margin: '0 2px' }} />
            {face === 'inside' && (
              <button onClick={() => setToolFn('write')} style={tb(tool === 'write')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                </svg>
                <span>Write</span>
              </button>
            )}
            {face === 'front' && (
              <button onClick={() => setShowTemplates((s) => !s)} style={tb(showTemplates)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                  <path d="M3 9h18"></path>
                  <path d="M9 21V9"></path>
                </svg>
                <span>Template</span>
              </button>
            )}
            <button onClick={() => setToolFn('draw')} style={tb(tool === 'draw' && !showTemplates)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17c3-4 4 3 7-1s3-7 6-4 4 1 5 0"></path>
              </svg>
              <span>Draw</span>
            </button>
            <button onClick={() => setToolFn('sticker')} style={tb(tool === 'sticker')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5Z"></path>
              </svg>
              <span>Sticker</span>
            </button>
            <button onClick={() => setToolFn('photo')} style={tb(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="3"></rect>
                <circle cx="8.5" cy="9.5" r="1.6"></circle>
                <path d="M21 16l-5-5-8 8"></path>
              </svg>
              <span>Photo</span>
            </button>
            <button
              onClick={() => {
                const open = !showCoverPicker;
                setShowCoverPicker(open);
                setShowStickers(false);
                setShowTemplates(false);
                setTool(open ? null : tool || 'write');
                if (open) {
                  setSelectedId(null);
                  // Commit before leaving, never just clear editingId
                  // (D-044) — same reasoning as reseedCover/setCanvasFace.
                  if (editingId) commitBox(editingId);
                }
              }}
              style={tb(showCoverPicker)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 7-7 7-7-7 7-7Z"></path>
                <path d="M5 10h14"></path>
                <path d="M18 14c1.5 2 2.5 3 2.5 4a2.5 2.5 0 0 1-5 0c0-1 1-2 2.5-4Z"></path>
              </svg>
              <span>Background</span>
            </button>
          </div>
        </div>

        <div data-chrome="" data-zoompill="" style={{ position: 'absolute', bottom: 28, left: 20, zIndex: 100, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 6, boxShadow: 'var(--shadow-lg)' }}>
          <button onClick={() => setZoomAt(zoom - 0.1, window.innerWidth / 2, window.innerHeight / 2)} title="Zoom out" style={{ width: 34, height: 34, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-1)" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 12h14"></path>
            </svg>
          </button>
          <button onClick={() => setZoom(fitZoomFor(card.format))} title="Fit to screen (⌘0) — pinch or ⌘± to zoom" style={{ width: 54, height: 34, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoomAt(zoom + 0.1, window.innerWidth / 2, window.innerHeight / 2)} title="Zoom in" style={{ width: 34, height: 34, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-1)" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"></path>
            </svg>
          </button>
        </div>

        {/* Mobile reaches Feedback via the header's ⋯ overflow instead — this
            floating pill only makes sense once chrome is floating too. */}
        {!mobileView && (
          <button
            onClick={openFeedback}
            data-chrome=""
            title="Share feedback"
            style={{ position: 'absolute', bottom: 28, right: 20, zIndex: 100, display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 18px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--line)', background: 'var(--white)', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Feedback</span>
          </button>
        )}

        {showFeedback && (
          <div data-chrome="" onPointerDown={closeFeedback} style={{ position: 'absolute', inset: 0, zIndex: 345, background: 'rgba(20,24,29,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeUp .25s var(--ease-out)', overflow: 'auto' }}>
            <div onPointerDown={stop} style={{ width: '100%', maxWidth: 410, background: 'var(--white)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '30px 30px 26px', position: 'relative' }}>
              <button onClick={closeFeedback} style={{ position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--sunken)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>

              {feedbackStage === 'open' && (
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>How was making this card?</div>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.4, margin: '0 0 20px' }}>Two seconds, and it genuinely helps.</p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setFeedbackRating(n)}
                        title={n + ' star' + (n === 1 ? '' : 's')}
                        style={{ width: 44, height: 44, borderRadius: 14, border: 'none', background: n <= feedbackRating ? 'var(--yellow-soft)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, transform: n === feedbackRating ? 'scale(1.08)' : 'none' }}
                      >
                        <svg width="26" height="26" viewBox="0 0 24 24" fill={n <= feedbackRating ? 'var(--yellow)' : 'none'} stroke={n <= feedbackRating ? 'var(--yellow)' : 'var(--ink-4)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3l2.7 5.8 6.3.6-4.8 4.2 1.4 6.2L12 16.9 6.4 19.8l1.4-6.2L3 9.4l6.3-.6z"></path>
                        </svg>
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="How could we do better? (optional)"
                    style={{ width: '100%', minHeight: 88, padding: '13px 15px', fontSize: 14.5, fontFamily: 'var(--font-sans)', lineHeight: 1.45, border: '1.5px solid var(--line-strong)', borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--white)', color: 'var(--ink-1)', resize: 'vertical', marginBottom: 16 }}
                  />
                  <button
                    onClick={submitFeedback}
                    disabled={feedbackSubmitting}
                    style={{ width: '100%', height: 50, borderRadius: 'var(--radius-pill)', border: 'none', cursor: feedbackSubmitting ? 'default' : 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, opacity: feedbackSubmitting ? 0.7 : 1, background: feedbackRating ? 'var(--brand)' : 'var(--sunken)', color: feedbackRating ? '#fff' : 'var(--ink-4)', boxShadow: feedbackRating ? 'var(--shadow-brand)' : 'none' }}
                  >
                    {feedbackSubmitting ? 'Sending…' : 'Send feedback'}
                  </button>
                </div>
              )}

              {feedbackStage === 'sent' && (
                <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
                  <div style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', animation: 'popIn .5s var(--ease-bounce)' }}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6 }}>Thank you — truly.</div>
                  <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.45, margin: '0 0 22px' }}>Every note helps Warmly get a little warmer.</p>
                  <button onClick={closeFeedback} style={{ width: '100%', height: 48, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--ink-1)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                    Back to the card
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />

        {!!toast && (
          <div data-chrome="" style={{ position: 'absolute', bottom: 118, left: '50%', transform: 'translateX(-50%)', zIndex: 120, background: 'var(--ink-1)', color: '#fff', padding: '11px 20px', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 500, boxShadow: 'var(--shadow-lg)', whiteSpace: 'nowrap', animation: 'toastIn .3s var(--ease-out)' }}>
            {toast}
          </div>
        )}

        {showSend && (
          <div data-chrome="" onPointerDown={() => setShowSend(false)} style={{ position: 'absolute', inset: 0, zIndex: 300, background: 'rgba(20,24,29,.34)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeUp .2s var(--ease-out)' }}>
            <div onPointerDown={stop} style={{ width: '100%', maxWidth: 430, background: 'var(--white)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '32px 30px 28px', position: 'relative' }}>
              <button onClick={() => setShowSend(false)} style={{ position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--sunken)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>
              <h2 style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 8px', lineHeight: 1.1 }}>Share {recipientName}'s card</h2>
              <p style={{ fontSize: 15, color: 'var(--ink-3)', margin: '0 0 24px', lineHeight: 1.5 }}>Invite people to sign — anyone with the link can add to the card.</p>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 9 }}>Invite people to sign</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--sunken)', borderRadius: 'var(--radius-md)', padding: '6px 6px 6px 16px', marginBottom: 22 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{link}</span>
                <button onClick={copyLink} style={{ height: 38, padding: '0 18px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', background: copied ? 'var(--green-soft)' : 'var(--ink-1)', color: copied ? 'var(--green-ink)' : '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background var(--dur-base)' }}>
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--green-soft)', borderRadius: 'var(--radius-md)', padding: '11px 14px', marginBottom: 14 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 8v4l3 2"></path>
                </svg>
                <span style={{ fontSize: 13, color: 'var(--green-ink)', lineHeight: 1.35 }}>
                  Open for signing until <strong style={{ fontWeight: 700 }}>{expiryDate}</strong> — two weeks from today. After that it gently rests.
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.45, margin: '2px 0 0' }}>Anyone who opens it can start writing straight away — no accounts. Up to 20 people can sign, free.</p>
            </div>
          </div>
        )}

        {showDownload && (
          <div data-chrome="" onPointerDown={closeDownload} style={{ position: 'absolute', inset: 0, zIndex: 340, background: 'rgba(20,24,29,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeUp .25s var(--ease-out)', overflow: 'auto' }}>
            <div onPointerDown={stop} style={{ width: '100%', maxWidth: 440, background: 'var(--white)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '30px 30px 26px', position: 'relative' }}>
              <button onClick={closeDownload} style={{ position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'var(--sunken)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Download the card</div>
              <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.4, margin: '0 0 22px' }}>A two-page PDF — the cover, then everyone's inside spread.</p>

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Choose a size</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>{orientationLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                {['a4', 'a5', 'a6'].map((id) => {
                  const helper = { a4: 'A full sheet of paper', a5: 'Half of A4', a6: 'A quarter of A4' }[id];
                  const base = PRINT_SIZES_MM[id];
                  const land = card.format === 'landscape';
                  const k = 58 / 297;
                  const long = Math.max(base[0], base[1]) * k,
                    short = Math.min(base[0], base[1]) * k;
                  const rw = land ? long : short,
                    rh = land ? short : long;
                  const sel = printSize === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setPrintSize(id)}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '12px 8px 13px', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontFamily: 'var(--font-sans)', background: sel ? 'var(--sunken)' : 'var(--white)', border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line-strong)', color: 'var(--ink-1)', boxShadow: sel ? 'var(--shadow-sm)' : 'var(--shadow-xs)' }}
                    >
                      <div style={{ height: 70, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div style={{ width: rw, height: rh, borderRadius: 3, background: sel ? 'var(--ink-1)' : 'var(--sunken)', border: sel ? 'none' : '1.5px solid var(--line-strong)' }} />
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{id.toUpperCase()}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.25 }}>{helper}</div>
                    </button>
                  );
                })}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.4, margin: '9px 0 18px' }}>{sizeDetail}</p>

              <button
                onClick={downloadPdf}
                disabled={pdfBusy}
                style={{ width: '100%', height: 52, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--brand)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 15, cursor: pdfBusy ? 'default' : 'pointer', opacity: pdfBusy ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: 'var(--shadow-brand)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <path d="M7 10l5 5 5-5"></path>
                  <path d="M12 15V3"></path>
                </svg>
                {pdfBusy ? 'Preparing…' : 'Download as PDF'}
              </button>
              <p style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.45, margin: '10px 0 0' }}>Free to download as many times as you like.</p>
            </div>
          </div>
        )}

        {FEATURE_MONETIZATION && showUpgrade && (
          <div data-chrome="" onPointerDown={() => setShowUpgrade(false)} style={{ position: 'absolute', inset: 0, zIndex: 340, background: 'rgba(20,24,29,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeUp .25s var(--ease-out)', overflow: 'auto' }}>
            <div onPointerDown={stop} style={{ width: '100%', maxWidth: 440, background: 'var(--white)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden', position: 'relative' }}>
              <button onClick={() => setShowUpgrade(false)} style={{ position: 'absolute', top: 16, right: 16, width: 34, height: 34, borderRadius: 999, border: 'none', background: 'color-mix(in srgb,var(--white) 60%,transparent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"></path>
                </svg>
              </button>

              {upgradeStage === 'plan' && (
                <div>
                  <div style={{ padding: '30px 30px 22px', background: 'linear-gradient(160deg,var(--green-soft),color-mix(in srgb,var(--blue-soft) 70%,var(--white)))' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--white)', borderRadius: 999, padding: '6px 13px', marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3l2.4 5.3 5.6.5-4.3 3.7 1.3 5.5L12 20.6 6.9 23.5l1.3-5.5L4 14.3l5.6-.5z"></path>
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-ink)', letterSpacing: '.02em' }}>Warmly Unlimited</span>
                    </div>
                    <h2 style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: '0 0 6px' }}>Make sure no one gets left out.</h2>
                    <p style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.45, margin: 0 }}>
                      {full ? "You've hit the free limit of 10 signatures. Lift it so everyone can add their name." : 'The free plan holds 10 signatures. Go unlimited so nobody misses the chance to sign.'}
                    </p>
                  </div>
                  <div style={{ padding: '22px 30px 28px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
                      {[
                        { title: 'Unlimited signatures', desc: 'Invite the whole team — no cap on this card.' },
                        { title: 'Full control of the card', desc: "Move, edit or remove anything — even others' notes — to arrange it just right." },
                        { title: 'Keep it forever', desc: 'Download and re-send the card as many times as you like.' },
                      ].map((b) => (
                        <div key={b.title} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5"></path>
                            </svg>
                          </div>
                          <div>
                            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink-1)', lineHeight: 1.3 }}>{b.title}</div>
                            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.4 }}>{b.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
                      <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>$19</span>
                      <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>one-off · this card, unlimited signatures</span>
                    </div>
                    <button onClick={() => setUpgradeStage('pay')} style={{ width: '100%', height: 52, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--green)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                      Upgrade this card
                    </button>
                    <p style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', margin: '12px 0 0' }}>Everything you've written stays exactly as it is.</p>
                  </div>
                </div>
              )}

              {upgradeStage === 'pay' && (
                <div style={{ padding: 30 }}>
                  <button onClick={() => setUpgradeStage('plan')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, color: 'var(--ink-3)', marginBottom: 14, padding: 0 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 12H5"></path>
                      <path d="M11 6l-6 6 6 6"></path>
                    </svg>
                    Back
                  </button>
                  <h2 style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Payment</h2>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--sunken)', borderRadius: 'var(--radius-md)', margin: '16px 0 20px' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Warmly Unlimited · this card</span>
                    <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>$19</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>Card details</div>
                  <input value={payCard} onChange={(e) => setPayCard(e.target.value)} placeholder="Card number" inputMode="numeric" style={{ width: '100%', height: 48, padding: '0 16px', fontSize: 15, fontFamily: 'var(--font-mono)', border: '1.5px solid var(--line-strong)', borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--white)', color: 'var(--ink-1)', marginBottom: 10 }} />
                  <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
                    <input value={payExp} onChange={(e) => setPayExp(e.target.value)} placeholder="MM / YY" style={{ flex: 1, height: 48, padding: '0 16px', fontSize: 15, fontFamily: 'var(--font-mono)', border: '1.5px solid var(--line-strong)', borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--white)', color: 'var(--ink-1)' }} />
                    <input value={payCvc} onChange={(e) => setPayCvc(e.target.value)} placeholder="CVC" style={{ flex: 1, height: 48, padding: '0 16px', fontSize: 15, fontFamily: 'var(--font-mono)', border: '1.5px solid var(--line-strong)', borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--white)', color: 'var(--ink-1)' }} />
                  </div>
                  <button onClick={payNow} style={{ width: '100%', height: 52, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--green)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: 'var(--shadow-brand)' }}>
                    Pay $19
                  </button>
                  <p style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', margin: '12px 0 0' }}>This is a demo — no real payment is taken.</p>
                </div>
              )}

              {upgradeStage === 'done' && (
                <div style={{ padding: '44px 34px 36px', textAlign: 'center' }}>
                  <div style={{ width: 70, height: 70, borderRadius: 999, background: 'var(--green-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', animation: 'popIn .5s var(--ease-bounce)' }}>
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5"></path>
                    </svg>
                  </div>
                  <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 8px' }}>You're on Warmly Unlimited</h2>
                  <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 24px' }}>This card can now hold as many signatures as you need. Invite the whole team.</p>
                  <button onClick={() => setShowUpgrade(false)} style={{ width: '100%', height: 50, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--ink-1)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}>
                    Back to the card
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {confirmControl && (
          <div data-chrome="" onPointerDown={() => setConfirmControl(false)} style={{ position: 'absolute', inset: 0, zIndex: 360, background: 'rgba(20,24,29,.4)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fadeUp .2s var(--ease-out)' }}>
            <div onPointerDown={stop} style={{ width: '100%', maxWidth: 380, background: 'var(--white)', borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-lg)', padding: '28px 28px 24px', textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--yellow-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--yellow-ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4"></path>
                  <path d="M12 17h.01"></path>
                  <path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>
                </svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 8px' }}>Move someone else's note?</h2>
              <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 22px' }}>You're on Unlimited, so you can rearrange or remove anything on the card — including notes other people wrote. Please be gentle with their messages.</p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setConfirmControl(false)} style={{ flex: 1, height: 46, borderRadius: 'var(--radius-pill)', border: '1.5px solid var(--line-strong)', background: 'var(--white)', color: 'var(--ink-2)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setFullControl(true);
                    setConfirmControl(false);
                    showToast('Full control on — you can now move or remove anything');
                  }}
                  style={{ flex: 1, height: 46, borderRadius: 'var(--radius-pill)', border: 'none', background: 'var(--ink-1)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                >
                  Yes, let me edit
                </button>
              </div>
            </div>
          </div>
        )}

        {FEATURE_PREVIEW_AND_SEND_PAGE && delivering && (
          <div data-chrome="" style={{ position: 'absolute', inset: 0, zIndex: 320, background: 'var(--canvas)', overflow: 'auto', display: 'flex', flexDirection: 'column', animation: 'fadeUp .3s var(--ease-out)' }}>
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '18px 22px', borderBottom: '1px solid var(--line)', background: 'color-mix(in srgb,var(--white) 70%,transparent)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 2 }}>
              <button onClick={() => setDelivering(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px 0 12px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--line)', background: 'var(--white)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--ink-2)' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5"></path>
                  <path d="M11 6l-6 6 6 6"></path>
                </svg>
                Back to the card
              </button>
              <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>Preview &amp; send</span>
              <div style={{ width: 150 }} />
            </div>

            <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 44, justifyContent: 'center', alignItems: 'center', padding: '34px 26px 60px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
                <div style={{ textAlign: 'center', maxWidth: 520 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Here's how it'll look</div>
                  <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.4, margin: 0 }}>Your finished card, out in the world — front and inside, side by side.</p>
                </div>
                <div style={{ position: 'relative', width: '100%', maxWidth: 640, aspectRatio: '6 / 5', borderRadius: 20, overflow: 'hidden', background: 'linear-gradient(140deg, #f5ede1 0%, #efe6da 42%, #d9d2cc 78%, #c7c3c4 100%)', boxShadow: 'inset 0 0 90px rgba(120,105,80,.14)' }}>
                  <div style={{ position: 'absolute', right: '-6%', top: '-14%', width: '86%', height: '128%', opacity: 0.17, filter: 'blur(7px)', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: leafShadowSvg() }} />
                  <div style={{ position: 'absolute', left: '-10%', top: '-30%', width: '70%', height: '120%', background: 'radial-gradient(ellipse at 30% 40%, rgba(255,246,224,.72), rgba(255,246,224,0) 62%)', pointerEvents: 'none', mixBlendMode: 'screen' }} />
                  <div style={{ position: 'absolute', left: '40%', top: '67%', width: mockW, transform: 'translate(-50%,-50%) perspective(1600px) rotateX(32deg) rotateZ(-5deg)', transformStyle: 'preserve-3d', background: '#fff', padding: 12, borderRadius: 6, boxShadow: '0 2px 1px rgba(255,255,255,.6), 0 24px 32px -16px rgba(60,50,40,.40)', zIndex: 2 }}>
                    <div style={{ position: 'relative', width: mockW, height: mockH, overflow: 'hidden', borderRadius: 3 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, width: dims.w, height: dims.h, transform: `scale(${mockK})`, transformOrigin: 'top left', backgroundColor: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px' }} dangerouslySetInnerHTML={insideHtml} />
                    </div>
                    <div style={{ position: 'absolute', inset: 13, borderRadius: 3, background: 'linear-gradient(118deg, rgba(255,251,240,.42) 0%, rgba(255,251,240,0) 34%, rgba(70,60,80,.10) 100%)', pointerEvents: 'none' }} />
                  </div>
                  <div style={{ position: 'absolute', left: '57%', top: '40%', width: mockW, transform: 'translate(-50%,-50%) perspective(1600px) rotateX(32deg) rotateZ(-9deg)', transformStyle: 'preserve-3d', background: '#fff', padding: 12, borderRadius: 6, boxShadow: '0 2px 1px rgba(255,255,255,.6), 0 24px 32px -16px rgba(60,50,40,.42)', zIndex: 3 }}>
                    <div style={{ position: 'relative', width: mockW, height: mockH, overflow: 'hidden', borderRadius: 3 }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, width: dims.w, height: dims.h, transform: `scale(${mockK})`, transformOrigin: 'top left', backgroundColor: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px' }} dangerouslySetInnerHTML={coverHtml} />
                    </div>
                    <div style={{ position: 'absolute', inset: 13, borderRadius: 3, background: 'linear-gradient(118deg, rgba(255,251,240,.42) 0%, rgba(255,251,240,0) 34%, rgba(70,60,80,.10) 100%)', pointerEvents: 'none' }} />
                  </div>
                </div>
              </div>

              <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Send {recipientName} the card</div>
                  <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.4, margin: 0 }}>A two-page card — the cover, then everyone's inside spread.</p>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: -6 }}>Email the card</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={sendEmail}
                    onChange={(e) => setSendEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        submitEmail();
                      }
                    }}
                    placeholder="name@work.com"
                    style={{ flex: 1, height: 48, padding: '0 16px', fontSize: 15, fontFamily: 'var(--font-sans)', border: '1.5px solid var(--line-strong)', borderRadius: 'var(--radius-md)', outline: 'none', background: 'var(--white)', color: 'var(--ink-1)' }}
                  />
                  <button onClick={submitEmail} style={{ height: 48, padding: '0 22px', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--brand)', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: 'var(--font-sans)', flexShrink: 0 }}>
                    Send
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-4)', fontSize: 13 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                  or
                  <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                </div>
                <button onClick={downloadPdf} style={{ width: '100%', height: 50, borderRadius: 'var(--radius-pill)', border: '1.5px solid var(--border-strong)', background: 'var(--white)', color: 'var(--ink-1)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <path d="M7 10l5 5 5-5"></path>
                    <path d="M12 15V3"></path>
                  </svg>
                  Download as PDF
                </button>
                <p style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.45, margin: '2px 0 0' }}>Send or download as many times as you like. To change the cover, go Back and edit the Front.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* Rendered as a sibling of [data-app], not a descendant — the print
        stylesheet sets [data-app]{display:none}, and a display:none
        ancestor can't be overridden by a descendant's own display value,
        which was silently blanking this out under @media print. */}
    <div data-print-doc="">
      <div className="print-page" style={{ backgroundColor: cov.tint }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%,-50%) scale(${printScale})`, width: dims.w, height: dims.h, backgroundColor: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px' }} dangerouslySetInnerHTML={coverHtml} />
      </div>
      <div className="print-page" style={{ backgroundColor: cov.tint }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%,-50%) scale(${printScale})`, width: dims.w, height: dims.h, backgroundColor: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px' }} dangerouslySetInnerHTML={insideHtml} />
      </div>
    </div>
    </>
  );
}
