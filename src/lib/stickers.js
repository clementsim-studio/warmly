export function stickerSvg(kind, size) {
  size = size || 90;
  const m = {
    heart: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M50 86C20 64 8 48 8 32 8 19 18 10 30 10c8 0 15 4 20 12 5-8 12-12 20-12 12 0 22 9 22 22 0 16-12 32-42 54z" fill="#ec5b9c"/></svg>`,
    star: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M50 6l12 26 28 3-21 19 6 28-25-14-25 14 6-28-21-19 28-3z" fill="#f6c445"/></svg>`,
    balloon: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><ellipse cx="50" cy="37" rx="29" ry="33" fill="#8b5cf6"/><path d="M50 70c-3 5-3 9 0 14" stroke="#5b34c4" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M44 68l6 7 6-7z" fill="#8b5cf6"/></svg>`,
    cake: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><rect x="18" y="48" width="64" height="36" rx="8" fill="#0ead74"/><rect x="18" y="60" width="64" height="9" fill="#dcf4ea"/><rect x="47" y="26" width="6" height="18" rx="3" fill="#fb7b43"/><circle cx="50" cy="21" r="5" fill="#f6c445"/></svg>`,
    spark: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M50 8c4 24 14 34 38 42-24 8-34 18-38 42-4-24-14-34-38-42 24-8 34-18 38-42z" fill="#2f6bff"/></svg>`,
    flower: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><g fill="#fb7b43"><circle cx="50" cy="27" r="15"/><circle cx="73" cy="50" r="15"/><circle cx="50" cy="73" r="15"/><circle cx="27" cy="50" r="15"/></g><circle cx="50" cy="50" r="13" fill="#f6c445"/></svg>`,
    polaroid: `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><g transform="rotate(-6 50 50)"><rect x="20" y="16" width="60" height="70" rx="4" fill="#fff" stroke="#e7e1d8" stroke-width="1.5"/><rect x="26" y="22" width="48" height="44" rx="2" fill="#eef3ff"/><circle cx="40" cy="38" r="6" fill="#c7d6ff"/><path d="M26 66l14-13 10 8 8-6 10 11v0H26z" fill="#c7d6ff"/></g></svg>`,
  };
  return m[kind] || m.heart;
}

export const COVERS = {
  blue: { tint: '#eef3ff', ink: '#1a44b8', dot: '#2f6bff' },
  pink: { tint: '#fdeef5', ink: '#b32b6c', dot: '#ec5b9c' },
  green: { tint: '#e7f6ef', ink: '#075c3d', dot: '#0ead74' },
  yellow: { tint: '#fdf5dd', ink: '#946a05', dot: '#f6c445' },
  purple: { tint: '#f2ecfe', ink: '#5b34c4', dot: '#8b5cf6' },
};
