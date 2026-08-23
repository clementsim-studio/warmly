import { supabase } from './supabase';

export async function createCard({ recipient, occasion, format, coverColor }) {
  const { data, error } = await supabase
    .from('cards')
    .insert({ recipient, occasion, format, cover_color: coverColor })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCard(id) {
  const { data, error } = await supabase.from('cards').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateCard(id, patch) {
  const { error } = await supabase.from('cards').update(patch).eq('id', id);
  if (error) throw error;
}

export async function listCardObjects(cardId) {
  const { data, error } = await supabase
    .from('card_objects')
    .select('*')
    .eq('card_id', cardId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listSigners(cardId) {
  const { data, error } = await supabase.from('signers').select('*').eq('card_id', cardId).order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function ensureSigner(cardId, participantId, color) {
  const { error } = await supabase
    .from('signers')
    .upsert({ id: participantId, card_id: cardId, color }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function setSignerName(signerId, name) {
  const { error } = await supabase.from('signers').update({ name }).eq('id', signerId);
  if (error) throw error;
}

// Signature-cap rejections surface as a Postgres exception from the
// enforce_signature_cap trigger (see supabase/migrations/0001_init.sql).
export function isCapRejection(error) {
  return !!error && /signature_cap_reached/.test(error.message || '');
}

// A write hit a card that's past its 14-day lifespan — raised by
// enforce_card_not_resting (see supabase/migrations/0004_card_lifespan.sql).
// The client normally catches this earlier (CardScreen shows a placeholder
// instead of the canvas once a card is resting), so this mainly covers a
// tab left open across the 14-day boundary.
export function isRestingRejection(error) {
  return !!error && /card_resting/.test(error.message || '');
}

// A concurrent first-load raced the cover-template seed and won (see the
// card_objects_card_cover_kind_uidx constraint in the migration).
export function isCoverSeedRace(error) {
  return !!error && error.code === '23505';
}

export async function insertObject(row) {
  const { data, error } = await supabase.from('card_objects').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function insertObjects(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from('card_objects').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function updateObject(id, patch) {
  const { error } = await supabase.from('card_objects').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteObject(id) {
  const { error } = await supabase.from('card_objects').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteCoverObjects(cardId) {
  const { error } = await supabase
    .from('card_objects')
    .delete()
    .eq('card_id', cardId)
    .eq('face', 'front')
    .not('cover_kind', 'is', null);
  if (error) throw error;
}

export async function uploadPhoto(cardId, objectId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${cardId}/${objectId}.${ext}`;
  const { error } = await supabase.storage
    .from('card-photos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  return path;
}

export function photoUrl(path) {
  if (!path) return null;
  return supabase.storage.from('card-photos').getPublicUrl(path).data.publicUrl;
}

export function subscribeToCard(cardId, { onObject, onSigner, onCard }) {
  const channel = supabase
    .channel(`card:${cardId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'card_objects', filter: `card_id=eq.${cardId}` },
      (payload) => onObject(payload.eventType, payload.new, payload.old)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'signers', filter: `card_id=eq.${cardId}` },
      (payload) => onSigner(payload.eventType, payload.new, payload.old)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cards', filter: `id=eq.${cardId}` },
      (payload) => onCard(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
