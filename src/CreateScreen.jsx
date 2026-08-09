import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCard } from './lib/cardData';

const occStyle = (sel) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  flex: 1,
  height: '104px',
  borderRadius: 'var(--radius-lg)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  backgroundColor: sel ? 'var(--green-soft)' : 'var(--white)',
  border: sel ? '1.5px solid var(--green)' : '1.5px solid var(--line-strong)',
  color: sel ? 'var(--green-ink)' : 'var(--ink-1)',
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
  backgroundColor: sel ? 'var(--green-soft)' : 'var(--white)',
  border: sel ? '1.5px solid var(--green)' : '1.5px solid var(--line-strong)',
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
  background: 'var(--green)',
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
      navigate(`/share/${card.id}`);
    } catch (e) {
      console.error(e);
      setBusy(false);
      setError('Could not create the card. Please try again.');
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
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 20px',
        }}
      >
        <div style={{ width: '100%', maxWidth: '500px', animation: 'fadeUp .5s var(--ease-out)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginBottom: '34px' }}>
            <div style={{ display: 'flex', gap: '3px' }}>
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--green)', display: 'block' }} />
              <span style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--blue)', display: 'block' }} />
            </div>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>Warmly</span>
          </div>

          <h1 style={{ fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.03em', fontWeight: 700, margin: '0 0 12px' }}>
            Start a card everyone can sign.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, color: 'var(--ink-3)', margin: '0 0 20px', maxWidth: 420 }}>
            One card, one link. Your people add a note, a doodle, a photo — from anywhere. No sign-ups, no chasing.
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
            The occasion
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <button onClick={() => setOccasion('birthday')} style={occStyle(occasion === 'birthday')}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16"></path>
                <path d="M5 20v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"></path>
                <path d="M4 14.5c1.4 1.4 3 1.4 4.2 0s2.6-1.4 4 0 2.6 1.4 4 0 2.6-1.4 3.8 0"></path>
                <path d="M12 8V5"></path>
                <circle cx="12" cy="3.6" r="1"></circle>
              </svg>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Birthday</span>
            </button>
            <button onClick={() => setOccasion('farewell')} style={occStyle(occasion === 'farewell')}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="7" width="18" height="13" rx="2"></rect>
                <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <path d="M12 11.5v4"></path>
              </svg>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Farewell</span>
            </button>
          </div>

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
            Card size
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
            <button onClick={() => setFormat('landscape')} style={fmtCardStyle(format === 'landscape')}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 30 }}>
                <span style={{ width: 30, height: 20, borderRadius: 3, background: 'currentColor', opacity: 0.85, display: 'block' }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Landscape</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Wider than it is tall</span>
            </button>
            <button onClick={() => setFormat('portrait')} style={fmtCardStyle(format === 'portrait')}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 30 }}>
                <span style={{ width: 20, height: 28, borderRadius: 3, background: 'currentColor', opacity: 0.85, display: 'block' }} />
              </div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Portrait</span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Taller than it is wide</span>
            </button>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '0 0 24px' }}>
            Pick the size now — it stays fixed so everyone's messages keep their place.
          </p>

          <button onClick={createTheCard} disabled={busy} style={primaryBtnStyle}>
            {busy ? 'Creating…' : 'Create the card'}
          </button>
          {error && (
            <p style={{ fontSize: 13.5, color: 'var(--danger-ink)', margin: '14px 0 0', textAlign: 'center' }}>{error}</p>
          )}
          <p style={{ fontSize: 13.5, color: 'var(--ink-4)', margin: '14px 0 0', textAlign: 'center' }}>
            You'll design the front and write inside once you're in.
          </p>
        </div>
      </div>
    </div>
  );
}
