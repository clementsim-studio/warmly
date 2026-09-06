import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCard, isDailyLimitRejection } from './lib/cardData';
import { OCCASIONS, OCCASION_KEYS } from './lib/occasions';
import { track } from './lib/analytics.js';

// Start-screen byline. Change these to re-credit or re-point the links.
const CREDIT_PREFIX = 'Made with ♡ by';
const CREDIT_NAME = 'Clement Sim';
const CREDIT_LINKEDIN_URL = 'https://www.linkedin.com/in/clement-sim-kk/';
const CREDIT_GITHUB_URL = 'https://github.com/clementsim-studio';

const creditPopRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 12px',
  borderRadius: 'var(--radius-md)',
  color: 'var(--ink-2)',
  textDecoration: 'none',
  fontSize: 13.5,
  fontWeight: 600,
};

// "Made with ♡ by <name>" under the wordmark. The name is a <button> (it
// opens a menu, it doesn't navigate); the popover closes on outside click
// or Escape. Marks are monochrome, inheriting currentColor.
function CreditByline() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} data-credit="" style={{ margin: '7px 0 0 1px', display: 'flex', alignItems: 'center' }}>
      <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--ink-4)' }}>{CREDIT_PREFIX}</span>
      {/* own positioning context so the menu centres under the name, not
          the whole "Made with ♡ by …" row (D-056) */}
      <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, font: 'inherit', fontSize: 12.5, lineHeight: 1.4, fontWeight: 600, color: 'var(--ink-3)', cursor: 'pointer', borderBottom: '1px solid transparent' }}
      >
        {CREDIT_NAME}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 151, minWidth: 186, background: 'var(--white)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: 6, animation: 'fadeUpCx .18s var(--ease-out)' }}>
          <a href={CREDIT_LINKEDIN_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} data-hov="grey" style={creditPopRow}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, opacity: 0.75 }}>
              <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zm1.78 13.02H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
            </svg>
            <span>LinkedIn</span>
          </a>
          <a href={CREDIT_GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} data-hov="grey" style={creditPopRow}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, opacity: 0.75 }}>
              <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .83-.27 2.75 1.02a9.4 9.4 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>
      )}
      </span>
    </div>
  );
}

const occStyle = (sel) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '7px',
  whiteSpace: 'nowrap',
  height: '42px',
  padding: '0 16px',
  borderRadius: '999px',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: '14px',
  backgroundColor: sel ? 'var(--sunken)' : 'var(--white)',
  border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line-strong)',
  color: 'var(--ink-2)',
  boxShadow: sel ? 'var(--shadow-sm)' : 'var(--shadow-xs)',
  transition: 'all var(--dur-base) var(--ease-standard)',
});

const fmtCardStyle = (sel) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '6px',
  padding: '16px 18px',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  textAlign: 'left',
  backgroundColor: sel ? 'var(--sunken)' : 'var(--white)',
  border: sel ? '1.5px solid var(--ink-1)' : '1.5px solid var(--line-strong)',
  color: 'var(--ink-1)',
  boxShadow: sel ? 'var(--shadow-sm)' : 'var(--shadow-xs)',
  transition: 'all var(--dur-base) var(--ease-standard)',
});

const primaryBtnStyle = {
  width: '100%',
  height: '54px',
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  cursor: 'pointer',
  background: 'var(--brand)',
  color: '#fff',
  fontFamily: 'var(--font-sans)',
  fontWeight: 700,
  fontSize: '16px',
  boxShadow: 'var(--shadow-brand)',
};

export default function CreateScreen() {
  const navigate = useNavigate();
  const [occasion, setOccasion] = useState('birthday');
  const [recipient, setRecipient] = useState('');
  const [format, setFormat] = useState('landscape');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const createTheCard = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const card = await createCard({ recipient, occasion, format, coverColor: 'blue' });
      track('card_created', { occasion, format });
      navigate(`/share/${card.id}`);
    } catch (e) {
      setBusy(false);
      if (isDailyLimitRejection(e)) {
        setError("Warmly's at capacity for today — try again tomorrow.");
      } else {
        console.error(e);
        setError('Could not create the card. Please try again.');
      }
    }
  };

  return (
    <div
      data-app=""
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--canvas)',
        fontFamily: 'var(--font-sans)',
        color: 'var(--ink-1)',
      }}
    >
      <div
        data-startwrap=""
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '32px 20px',
        }}
      >
        <div style={{ width: '100%', maxWidth: '500px', margin: 'auto', animation: 'fadeUp .5s var(--ease-out)' }}>
          <div data-masthead="" style={{ marginBottom: '34px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="29" height="34" viewBox="13 3 56 66" fill="none" style={{ display: 'block', flexShrink: 0 }} aria-label="Warmly">
                <rect x="48.5332" y="5.04541" width="7.46" height="52.1592" rx="3.73" transform="rotate(41.5282 48.5332 5.04541)" fill="var(--orange)" />
                <rect x="44.0662" y="29.4248" width="8.46" height="19.7078" rx="4.23" transform="rotate(41.5282 44.0662 29.4248)" fill="var(--orange)" />
                <rect width="7.46" height="39.8291" rx="3.73" transform="matrix(-0.748629 -0.662989 -0.662989 0.748629 66.3255 37.2725)" fill="var(--orange)" />
                <rect x="42.0993" y="38.0718" width="9.45987" height="26.384" rx="4.72993" transform="rotate(86.5282 42.0993 38.0718)" fill="var(--orange)" />
                <rect width="9.45987" height="26.384" rx="4.72993" transform="matrix(0.998165 -0.0605567 -0.0605567 -0.998165 34.5342 65.6387)" fill="var(--orange)" />
                <path d="M17.9235 49.1211L25.8523 56.1429L33.7811 63.1647L20.8268 63.9506C19.7243 64.0175 18.7763 63.1779 18.7094 62.0754L17.9235 49.1211Z" fill="#FA6828" />
              </svg>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.025em' }}>Warmly</span>
            </div>
            <CreditByline />
          </div>

          <h1 data-starttitle="" style={{ fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 700, margin: '0 0 12px' }}>
            Start a card everyone can sign.
          </h1>
          <p data-startsub="" style={{ fontSize: 17, lineHeight: 1.5, color: 'var(--ink-3)', margin: '0 0 20px', maxWidth: 420 }}>
            One card, one link. Add a note, a doodle, a photo, from anywhere. No sign-ups. Completely free.
          </p>

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 10,
            }}
          >
            Who is it for?
          </div>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Their name"
            style={{
              width: '100%',
              height: 54,
              padding: '0 20px',
              fontSize: 18,
              fontFamily: 'var(--font-sans)',
              border: '1.5px solid var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--white)',
              color: 'var(--ink-1)',
              outline: 'none',
              marginBottom: 24,
              boxShadow: 'var(--shadow-xs)',
            }}
          />

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 10,
            }}
          >
            The occasion
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {OCCASION_KEYS.map((key) => (
              <button key={key} data-hov="grey" onClick={() => setOccasion(key)} style={occStyle(occasion === key)}>
                <span style={{ fontSize: 17, lineHeight: 1 }}>{OCCASIONS[key].emoji}</span>
                <span>{OCCASIONS[key].label}</span>
              </button>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '0 0 24px' }}>
            Just sets the greeting on the cover — you can change it any time inside the card.
          </p>

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              marginBottom: 10,
            }}
          >
            Card size
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <button data-hov="grey" onClick={() => setFormat('landscape')} style={fmtCardStyle(format === 'landscape')}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 30 }}>
                <span style={{ width: 30, height: 20, borderRadius: 3, background: 'currentColor', opacity: 0.85, display: 'block' }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Landscape</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Wider than it is tall</span>
            </button>
            <button data-hov="grey" onClick={() => setFormat('portrait')} style={fmtCardStyle(format === 'portrait')}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 30 }}>
                <span style={{ width: 20, height: 28, borderRadius: 3, background: 'currentColor', opacity: 0.85, display: 'block' }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Portrait</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Taller than it is wide</span>
            </button>
          </div>
          <p style={{ display: 'none', fontSize: 12.5, color: 'var(--ink-4)', margin: '0 0 24px' }}>
            Pick the size now — it stays fixed so everyone's messages keep their place.
          </p>

          <p style={{ fontSize: 13.5, color: 'var(--ink-4)', margin: '0 0 12px', textAlign: 'center' }}>
            Fits up to 20 signers — perfect for most groups
          </p>
          <button data-hov="dark" onClick={createTheCard} disabled={busy} style={primaryBtnStyle}>
            {busy ? 'Creating…' : 'Create the card'}
          </button>
          {error && (
            <p style={{ fontSize: 13.5, color: 'var(--danger-ink)', margin: '14px 0 0', textAlign: 'center' }}>{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
