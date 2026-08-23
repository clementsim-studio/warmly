import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as db from './lib/cardData';
import { getParticipant, rememberParticipantName } from './lib/participant';
import { stickerSvg, COVERS } from './lib/stickers';
import { cardDims, objectsToHTML, seedCoverObjects, leafShadowSvg } from './lib/canvasHtml';
import { occasionInfo } from './lib/occasions';
import { FEATURE_MONETIZATION } from './lib/featureFlags';
import ObjectView from './ObjectView.jsx';

const LIMIT = 20;

function fitZoomFor(format) {
  const d = cardDims(format);
  const w = window.innerWidth || 1200,
    h = window.innerHeight || 800;
  let z = Math.min((w - 150) / d.w, (h - 250) / d.h);
  z = Math.max(0.3, Math.min(1, z));
  return Math.round(z * 100) / 100;
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
  const [signingId, setSigningId] = useState(null);
  const [signName, setSignName] = useState('');
  const [showStickers, setShowStickers] = useState(false);
  const [showSigners, setShowSigners] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
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

  const surfaceRef = useRef(null);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const gestureRef = useRef(null);
  const drawPtsRef = useRef(null);
  const pendingPointRef = useRef(null);
  const fillPhotoIdRef = useRef(null);
  const toastTimerRef = useRef(null);
  const openTimerRef = useRef(null);
  const copyTimerRef = useRef(null);

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
    setZoom((oz) => {
      if (!sc || nz === oz) return nz;
      const r = sc.getBoundingClientRect();
      const px = (sc.scrollLeft + (cx - r.left)) / oz;
      const py = (sc.scrollTop + (cy - r.top)) / oz;
      requestAnimationFrame(() => {
        sc.scrollLeft = px * nz - (cx - r.left);
        sc.scrollTop = py * nz - (cy - r.top);
      });
      return nz;
    });
  }, [scroller]);

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
    function onDocMove(e) {
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
    function onDocUp() {
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
    window.addEventListener('pointermove', onDocMove);
    window.addEventListener('pointerup', onDocUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyZoom);
    return () => {
      window.removeEventListener('pointermove', onDocMove);
      window.removeEventListener('pointerup', onDocUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyZoom);
    };
  }, [zoom, scroller, surfacePoint, finishDraw, setZoomAt, card]);

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
    if (signingId) {
      const el = document.getElementById('sign-' + signingId);
      if (el) el.focus();
    }
  }, [signingId]);
  useEffect(() => {
    if (captionId) {
      const el = document.getElementById('cap-' + captionId);
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [captionId]);

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
      editing: true,
      pending: true,
    };
    setObjects((prev) => [...prev, obj]);
    setEditingId(id);
    setSelectedId(id);
  };

  const onTextChange = (id, e) => {
    const el = e.target;
    const val = el.value;
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, text: val } : o)));
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const finishText = async (id) => {
    const o = objects.find((x) => x.id === id);
    if (!o) return;
    if (!(o.text || '').trim() && !o.cover_kind) {
      setObjects((prev) => prev.filter((x) => x.id !== id));
      setEditingId(null);
      return;
    }
    if (o.pending) {
      const { pending, editing, ...rest } = o;
      const myTexts = objects.filter((x) => x.owner_id === meId && x.type === 'text' && !x.cover_kind);
      const shouldPrompt = !meName && myTexts.length === 1 && myTexts[0].id === id;
      try {
        await db.insertObject(rest);
        setObjects((prev) => prev.map((x) => (x.id === id ? { ...x, editing: false, pending: false, promptSign: shouldPrompt } : x)));
        setEditingId(null);
      } catch (err) {
        setObjects((prev) => prev.filter((x) => x.id !== id));
        setEditingId(null);
        if (db.isCapRejection(err)) {
          showToast('This card’s full of signatures — time to send it');
        } else {
          console.error(err);
          showToast('Could not save your note — try again');
        }
      }
      return;
    }
    setObjects((prev) => prev.map((x) => (x.id === id ? { ...x, editing: false } : x)));
    setEditingId(null);
    db.updateObject(id, { text: o.text }).catch(console.error);
  };

  const startMove = (o, e) => {
    e.stopPropagation();
    if (o.editing) return;
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
    gestureRef.current = { type: 'move', id: o.id, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y };
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

  const onSurfaceDown = (e) => {
    if (!e.target || e.target.getAttribute('data-surface') !== '1') return;
    // The canvas itself isn't focusable, so without this the browser's
    // default mouseup-driven focus resolution blurs whatever we focus
    // programmatically in response to this same click (e.g. the textarea
    // just created below) — deleting a just-created empty note instantly.
    e.preventDefault();
    if (showSigners) setShowSigners(false);
    if (showCoverPicker) setShowCoverPicker(false);
    if (editingId) finishText(editingId);
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
    } else if (tool === 'write') createText(p.x, p.y);
    else if (tool === 'draw') {
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

  const tapSign = (id) => {
    setSigningId(id);
    setSignName(meName || '');
  };
  const submitSign = async () => {
    const n = (signName || '').trim();
    if (!n) {
      setSigningId(null);
      return;
    }
    setSigningId(null);
    setSignName('');
    setMeName(n);
    rememberParticipantName(cardId, n);
    setSigners((prev) => (prev.some((s) => s.id === meId) ? prev.map((s) => (s.id === meId ? { ...s, name: n } : s)) : [...prev, { id: meId, card_id: cardId, name: n, color: participantRef.current.color }]));
    setObjects((prev) => prev.map((o) => (o.owner_id === meId ? { ...o, promptSign: false } : o)));
    showToast('Signed. Warmly, ' + n + '.');
    try {
      await db.setSignerName(meId, n);
    } catch (err) {
      console.error(err);
    }
  };

  // ---- cover template -------------------------------------------------------
  const reseedCover = async (patch) => {
    const nextCard = { ...card, ...patch };
    setCard(nextCard);
    setSelectedId(null);
    setEditingId(null);
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

  const setCanvasFace = (f) => {
    setFace(f);
    setTool((t) => (f === 'front' && t === 'write' ? 'select' : t));
    setShowStickers(false);
    setShowCoverPicker(false);
    setShowTemplates(false);
    setSelectedId(null);
    setEditingId(null);
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

  const downloadPdf = () => {
    const t = card ? COVERS[card.cover_color].tint : '#fff';
    try {
      document.documentElement.style.setProperty('--pg', t);
    } catch {
      // ignore
    }
    setShowSend(false);
    setShowSigners(false);
    setSelectedId(null);
    setTimeout(() => {
      try {
        window.print();
      } catch {
        // ignore
      }
    }, 80);
  };

  const photoUrlFor = (o) => o._localPreview || (o.photo_path ? db.photoUrl(o.photo_path) : null);

  // ---- derived / computed values ---------------------------------------------
  const cov = card ? COVERS[card.cover_color] : COVERS.blue;
  const dims = card ? cardDims(card.format) : { w: 1600, h: 1150 };

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
    const scale = o.scale || 1;
    const rot = o.rotation || 0;
    const base = { position: 'absolute', left: o.x + 'px', top: o.y + 'px', transformOrigin: 'center center', zIndex: selected ? 50 : o.type === 'draw' ? 6 : 12, touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' };
    const d = { id: o.id, isText: o.type === 'text', isPhoto: o.type === 'photo', isSvg: o.type === 'sticker' || o.type === 'draw', stop };
    d.onDown = (e) => startMove(o, e);
    d.onEdit = () => {
      if (canEdit && o.type === 'text') {
        setObjects((prev) => prev.map((x) => (x.id === o.id ? { ...x, editing: true } : x)));
        setEditingId(o.id);
        setSelectedId(o.id);
      }
    };
    d.onResize = (e) => startResize(o, e);
    d.onRotate = (e) => startRotate(o, e);
    d.onDeleteDown = (e) => e.stopPropagation();
    d.onDelete = (e) => {
      e.stopPropagation();
      deleteObject(o.id);
    };
    d.showFrame = grabbable && selected && !o.editing;

    if (o.type === 'text' && o.cover_kind) {
      const cfam = o.font || 'var(--font-sans)';
      d.style = { ...base, width: o.width * scale + 'px', transform: `rotate(${rot}deg)`, cursor: o.editing ? 'text' : 'grab' };
      d.text = o.text;
      d.isEditing = !!o.editing;
      d.notEditing = !o.editing;
      const ctstyle = { fontFamily: cfam, fontSize: o.fsize * scale + 'px', lineHeight: 1.02, color: o.color, fontWeight: o.weight || 700, letterSpacing: '-0.02em', textAlign: o.align || 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
      d.textStyle = ctstyle;
      d.taStyle = { ...ctstyle, width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', padding: 0, margin: 0, minHeight: o.fsize * scale + 'px', overflow: 'hidden', display: 'block' };
      d.showSig = false;
      d.showPlaceholder = false;
      d.showSignInput = false;
      d.taId = 'ta-' + o.id;
      d.onTextChange = (e) => onTextChange(o.id, e);
      d.onTextBlur = () => finishText(o.id);
    } else if (o.type === 'text') {
      const fs = o.font === 'Caveat' ? 30 : 18;
      d.style = { ...base, width: 240 * scale + 'px', transform: `rotate(${rot}deg)`, cursor: o.editing ? 'text' : mine ? 'grab' : 'default' };
      d.text = o.text;
      d.isEditing = !!o.editing;
      d.notEditing = !o.editing;
      const tstyle = { fontFamily: o.font === 'Caveat' ? "'Caveat',cursive" : 'var(--font-sans)', fontSize: fs * scale + 'px', lineHeight: o.font === 'Caveat' ? 1.15 : 1.45, color: o.color, fontWeight: o.font === 'Caveat' ? 600 : 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
      d.textStyle = tstyle;
      d.taStyle = { ...tstyle, width: '100%', border: 'none', outline: 'none', background: 'transparent', resize: 'none', padding: 0, margin: 0, minHeight: fs * scale + 'px', overflow: 'hidden', display: 'block' };
      const signName = mine ? meName : nameMap[o.owner_id];
      d.showSig = !!signName && !(mine && signingId === o.id);
      d.sigName = signName ? '— ' + signName : '';
      const canEditSig = mine && !!meName;
      const sigFam = o.font === 'Caveat' ? "'Caveat',cursive" : 'var(--font-sans)';
      const sigFs = o.font === 'Caveat' ? 25 * scale : 16 * scale;
      d.sigStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', fontWeight: o.font === 'Caveat' ? 600 : 500, color: o.color, marginTop: 4, opacity: 0.9, cursor: canEditSig ? 'text' : 'default', display: 'inline-block' };
      d.sigTitle = canEditSig ? 'Tap to change your name' : '';
      d.sigDown = canEditSig ? (e) => e.stopPropagation() : () => {};
      d.onEditSig = canEditSig
        ? (e) => {
            e.stopPropagation();
            tapSign(o.id);
          }
        : () => {};
      d.showPlaceholder = mine && !meName && o.promptSign && signingId !== o.id;
      d.onTapSign = (e) => {
        e.stopPropagation();
        tapSign(o.id);
      };
      d.placeholderStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', color: '#b9bbc1', marginTop: 4, cursor: 'text' };
      d.showSignInput = mine && signingId === o.id;
      d.signId = 'sign-' + o.id;
      d.signValue = signName;
      d.onSignChange = (e) => setSignName(e.target.value);
      d.onSignKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitSign();
        }
      };
      d.onSignBlur = () => submitSign();
      d.signInputStyle = { fontFamily: sigFam, fontSize: sigFs + 'px', fontWeight: o.font === 'Caveat' ? 600 : 500, color: o.color, marginTop: 4, border: 'none', borderBottom: '1.5px dashed ' + o.color, outline: 'none', background: 'transparent', padding: '0 0 2px', width: 160 };
      d.taId = 'ta-' + o.id;
      d.onTextChange = (e) => onTextChange(o.id, e);
      d.onTextBlur = () => finishText(o.id);
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
  const stickerChoices = ['heart', 'star', 'balloon', 'cake', 'spark', 'flower', 'polaroid'].map((k) => ({ key: k, svgHtml: { __html: stickerSvg(k, 34) }, style: stickerBtn(stickerKind === k && tool === 'sticker'), onClick: () => chooseSticker(k) }));
  const fontBtn = (sel, fam) => ({ width: 40, height: 32, borderRadius: 10, border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line)', background: sel ? 'var(--ink-1)' : 'transparent', color: sel ? '#fff' : 'var(--ink-2)', cursor: 'pointer', fontFamily: fam, fontSize: fam.indexOf('Caveat') >= 0 ? 20 : 15, fontWeight: 600, lineHeight: 1 });
  const tplStyle = (sel) => ({ flex: 1, height: 40, borderRadius: 11, cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12.5, background: sel ? 'var(--ink-1)' : 'var(--white)', color: sel ? '#fff' : 'var(--ink-2)', border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line-strong)' });
  const faceTabStyle = (sel) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 13, background: sel ? 'var(--ink-1)' : 'transparent', color: sel ? '#fff' : 'var(--ink-3)', transition: 'background var(--dur-base),color var(--dur-base)' });

  const coverSwatches = ['blue', 'pink', 'green', 'yellow', 'purple'].map((k) => {
    const c = COVERS[k];
    const sel = card.cover_color === k;
    return { key: k, name: k, onClick: () => setCover(k), style: { width: 30, height: 30, borderRadius: 999, cursor: 'pointer', background: c.dot, border: sel ? '3px solid var(--ink-1)' : '3px solid var(--white)', boxShadow: sel ? '0 0 0 1.5px var(--ink-1)' : 'var(--shadow-xs)', outline: 'none', transform: sel ? 'scale(1.08)' : 'none', transition: 'transform var(--dur-fast) var(--ease-bounce)' } };
  });

  const surfaceStyle = { position: 'relative', width: dims.w + 'px', height: dims.h + 'px', zoom, margin: 'auto', flexShrink: 0, borderRadius: 24, backgroundColor: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px', boxShadow: '0 34px 70px -26px rgba(20,24,29,.34), 0 8px 22px -10px rgba(20,24,29,.20)', cursor: tool === 'draw' ? 'crosshair' : tool === 'write' ? 'text' : tool === 'sticker' ? 'copy' : tool === 'select' ? (panning ? 'grabbing' : 'grab') : 'default' };
  const wrapStyle = { position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#ece8e0', backgroundImage: 'radial-gradient(circle at 50% 32%, rgba(255,255,255,.5), transparent 60%)', '--pg': cov.tint };
  const coverFrontStyle = { position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: cov.tint, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(20,24,29,.05) 1px, transparent 0)', backgroundSize: '26px 26px', animation: 'coverLift .76s var(--ease-out) forwards' };

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
  const printScale = Math.min(1123 / dims.w, 794 / dims.h);
  const mockW = card.format === 'portrait' ? 270 : 330;
  const mockK = mockW / dims.w;
  const mockH = Math.round(dims.h * mockK);

  return (
    <>
    <div data-app="" style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--canvas)', fontFamily: 'var(--font-sans)', color: 'var(--ink-1)' }}>
      <div data-cardwrap="" style={wrapStyle}>
        <div data-scroll="" ref={scrollRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', display: 'flex', padding: 56, boxSizing: 'border-box' }}>
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

        {/* header */}
        <div data-chrome="" style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, pointerEvents: 'none', zIndex: 100 }}>
          <a
            href="/"
            title="Back to Warmly"
            style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 9, background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: '9px 18px', boxShadow: 'var(--shadow-sm)', pointerEvents: 'auto', cursor: 'pointer', fontFamily: 'var(--font-sans)', textDecoration: 'none' }}
          >
            <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--green)' }} />
              <span style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--blue)' }} />
            </div>
            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--ink-1)' }}>Warmly</span>
          </a>

          <div style={{ justifySelf: 'center', display: 'flex', alignItems: 'center', gap: 3, background: 'color-mix(in srgb,var(--white) 82%,transparent)', backdropFilter: 'blur(10px)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 4, boxShadow: 'var(--shadow-sm)', pointerEvents: 'auto' }}>
            <button onClick={() => setCanvasFace('front')} style={faceTabStyle(face === 'front')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="3" width="14" height="18" rx="2"></rect>
                <path d="M9 7h6"></path>
              </svg>
              Cover
            </button>
            <button onClick={() => setCanvasFace('inside')} style={faceTabStyle(face === 'inside')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 6l10 3 10-3"></path>
                <path d="M2 6v12l10 3 10-3V6"></path>
                <path d="M12 9v12"></path>
              </svg>
              Content
            </button>
          </div>
          <div style={{ justifySelf: 'end', position: 'relative', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
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
              onClick={() => {
                const m = card.cover_motif || occasionInfo(card.occasion).motif;
                setDelivering(true);
                setShowSend(false);
                setShowSigners(false);
                setShowCoverPicker(false);
                setSelectedId(null);
                setDeliverFace('front');
                setDeliverStage('preview');
                if (!card.cover_motif) setCard((c) => ({ ...c, cover_motif: m }));
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 18px', borderRadius: 999, border: 'none', background: 'var(--brand)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: 'var(--shadow-brand)', flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span>Preview</span>
            </button>

            {showSigners && (
              <div style={{ position: 'absolute', top: 52, right: 0, width: 250, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', padding: '16px 18px', animation: 'fadeUp .2s var(--ease-out)', zIndex: 140 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Signatures</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: full ? 'var(--green-ink)' : 'var(--ink-3)' }}>
                    {count} / {unlimited ? '∞' : LIMIT}
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: 'var(--sunken)', overflow: 'hidden', marginBottom: 7 }}>
                  <div style={{ height: '100%', width: pct + '%', borderRadius: 999, background: full || unlimited ? 'var(--green)' : 'var(--brand)', transition: 'width var(--dur-slow) var(--ease-out)' }} />
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
            )}
          </div>
        </div>

        {/* toolbar */}
        <div data-chrome="" style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 'max-content', maxWidth: 'calc(100vw - 24px)' }}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 8, boxShadow: 'var(--shadow-lg)' }}>
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
                  setEditingId(null);
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

        <div data-chrome="" style={{ position: 'absolute', bottom: 28, left: 20, zIndex: 100, display: 'flex', alignItems: 'center', gap: 2, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', padding: 6, boxShadow: 'var(--shadow-lg)' }}>
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
              <p style={{ fontSize: 13, color: 'var(--ink-4)', lineHeight: 1.45, margin: '2px 0 0' }}>Anyone who opens it can start writing straight away — no accounts. Up to 20 people can sign, free.</p>
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

        {delivering && (
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
