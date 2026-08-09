const COLORS = ['#2f6bff', '#ec5b9c', '#8b5cf6', '#0ead74', '#fb7b43', '#f6c445'];

function key(cardId) {
  return `warmly:participant:${cardId}`;
}

// Local identity for this browser on this card — no accounts. Persisted in
// localStorage so refreshing keeps "mine vs. theirs" and your chosen name.
export function getParticipant(cardId) {
  const raw = localStorage.getItem(key(cardId));
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through and re-create
    }
  }
  const participant = {
    id: crypto.randomUUID(),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
  localStorage.setItem(key(cardId), JSON.stringify(participant));
  return participant;
}

export function rememberParticipantName(cardId, name) {
  const participant = getParticipant(cardId);
  participant.name = name;
  localStorage.setItem(key(cardId), JSON.stringify(participant));
}
