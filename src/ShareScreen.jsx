import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getCard } from './lib/cardData';

export default function ShareScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [card, setCard] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getCard(id).then((row) => {
      if (alive) setCard(row);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (!card) return null;

  const link = `${window.location.origin}/c/${id}`;
  const recipientName = (card.recipient || '').trim() || 'your friend';
  const poss = /s$/i.test(recipientName) ? recipientName + '’' : recipientName + '’s';
  const recTitle = poss + ' card';

  const copyLink = () => {
    try {
      navigator.clipboard && navigator.clipboard.writeText(link);
    } catch {
      // ignore
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
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
        <div style={{ width: '100%', maxWidth: 480, textAlign: 'center', animation: 'fadeUp .5s var(--ease-out)' }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 999,
              background: 'var(--green-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 22px',
            }}
          >
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--green-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"></path>
            </svg>
          </div>
          <h1 style={{ fontSize: 34, lineHeight: 1.08, letterSpacing: '-0.03em', fontWeight: 700, margin: '0 0 10px' }}>
            {recTitle} is ready.
          </h1>
          <p style={{ fontSize: 17, color: 'var(--ink-3)', margin: '0 0 28px', lineHeight: 1.5 }}>
            Share the link. Anyone who opens it can start writing straight away — Warmly, everyone.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--white)',
              border: '1.5px solid var(--line-strong)',
              borderRadius: 'var(--radius-pill)',
              padding: '7px 8px 7px 20px',
              boxShadow: 'var(--shadow-sm)',
              marginBottom: 16,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 15,
                color: 'var(--ink-2)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                textAlign: 'left',
              }}
            >
              {link}
            </span>
            <button
              onClick={copyLink}
              style={{
                height: 42,
                padding: '0 20px',
                borderRadius: 999,
                border: 'none',
                cursor: 'pointer',
                background: copied ? 'var(--green-soft)' : 'var(--ink-1)',
                color: copied ? 'var(--green-ink)' : '#fff',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: 'nowrap',
                transition: 'background var(--dur-base)',
              }}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
          <p style={{ fontSize: 14, color: 'var(--ink-4)', margin: '0 0 30px' }}>
            No accounts. The card is the only thing they'll see.
          </p>

          <button
            onClick={() => navigate(`/c/${id}`)}
            style={{
              width: 'auto',
              height: 54,
              padding: '0 26px',
              borderRadius: 'var(--radius-pill)',
              border: '1.5px solid var(--line-strong)',
              cursor: 'pointer',
              background: 'var(--white)',
              color: 'var(--ink-1)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            Preview the card →
          </button>
        </div>
      </div>
    </div>
  );
}
