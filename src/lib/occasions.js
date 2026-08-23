// Single source of truth for the five occasions — label/emoji for the Create
// screen pills, and the cover greeting + default sticker motif used when
// seeding a card's cover template. Emoji are a deliberate one-off exception
// to this app's otherwise SVG-only iconography, scoped to these five pills.
export const OCCASIONS = {
  birthday: { label: 'Birthday', emoji: '🎂', motif: 'cake', cover: 'Happy Birthday' },
  farewell: { label: 'Farewell', emoji: '👋🏻', motif: 'balloon', cover: 'Farewell' },
  thanks: { label: 'Thank you', emoji: '🥰', motif: 'heart', cover: 'Thank You' },
  graduation: { label: 'Graduation', emoji: '🎓', motif: 'star', cover: 'Congratulations' },
  other: { label: 'Others', emoji: '❓', motif: 'flower', cover: 'For You' },
};

export const OCCASION_KEYS = Object.keys(OCCASIONS);

export function occasionInfo(key) {
  return OCCASIONS[key] || OCCASIONS.birthday;
}
