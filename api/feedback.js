// Vercel serverless function — the one write path for the `feedback` table
// (see supabase/migrations/0006_feedback.sql for why this can't be a direct
// client-to-Supabase insert like every other table in this app).
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT_LEN = 2000;

function supabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || '';
  return createHash('sha256').update(salt + ip).digest('hex');
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { cardId, signerId, rating, comment } = req.body || {};

  if (typeof cardId !== 'string' || !UUID_RE.test(cardId)) {
    res.status(400).json({ error: 'invalid_card_id' });
    return;
  }
  if (typeof signerId !== 'string' || !UUID_RE.test(signerId)) {
    res.status(400).json({ error: 'invalid_signer_id' });
    return;
  }
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    res.status(400).json({ error: 'invalid_rating' });
    return;
  }
  const commentText = typeof comment === 'string' ? comment.trim().slice(0, MAX_COMMENT_LEN) : null;

  let admin;
  try {
    admin = supabaseAdmin();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server_misconfigured' });
    return;
  }

  const { data: signer, error: signerErr } = await admin
    .from('signers')
    .select('id')
    .eq('id', signerId)
    .eq('card_id', cardId)
    .maybeSingle();
  if (signerErr) {
    console.error(signerErr);
    res.status(500).json({ error: 'lookup_failed' });
    return;
  }
  if (!signer) {
    res.status(400).json({ error: 'signer_not_on_card' });
    return;
  }

  const country = req.headers['x-vercel-ip-country'] || null;
  const ipHash = hashIp(clientIp(req));

  const { error: insertErr } = await admin.from('feedback').insert({
    card_id: cardId,
    signer_id: signerId,
    rating: ratingNum,
    comment: commentText || null,
    country,
    ip_hash: ipHash,
  });
  if (insertErr) {
    console.error(insertErr);
    res.status(500).json({ error: 'insert_failed' });
    return;
  }

  res.status(200).json({ ok: true });
}
