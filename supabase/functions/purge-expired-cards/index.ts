// Warmly — scheduled hard-purge of expired cards.
//
// A card is readable and editable for 14 days; enforce_card_not_resting()
// (migration 0004) freezes it at exactly that point. This job then DELETES
// it one day later, at 15 days. The extra day is deliberate slack — clock
// skew, a missed run, a support request landing right on the boundary — and
// it costs nothing, because the card has been read-only since day 14.
//
// Per expired card:
//   1. Delete every file under card-photos/<cardId>/ in Storage. TRUNCATE
//      and ON DELETE CASCADE never touch Storage — this is the only path.
//   2. Delete the cards row. ON DELETE CASCADE removes its signers and
//      card_objects. feedback is kept, with card_id / signer_id set to null
//      (migration 0008).
//
// Invoked once a day by pg_cron -> pg_net (migration 0009). It is on no
// user-facing path. Any request without the service-role bearer token is
// rejected, so the public function URL cannot be used to trigger a purge.
//
// This is a HARD, irreversible delete. There is no archive and no export;
// the card's link 404s afterwards ("This card doesn't exist.").

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const LIFESPAN_DAYS = 15;
const BUCKET = "card-photos";
const LIST_PAGE = 1000; // Storage list() max page size
const CARD_BATCH = 200; // cards deleted per invocation (see `more` in the response)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const cutoff = new Date(Date.now() - LIFESPAN_DAYS * 86_400_000).toISOString();

  const { data: expired, error: selErr } = await supabase
    .from("cards")
    .select("id")
    .lt("created_at", cutoff)
    .limit(CARD_BATCH);

  if (selErr) {
    console.error(`select expired cards: ${selErr.message}`);
    return json({ error: "select_failed", detail: selErr.message }, 500);
  }
  if (!expired || expired.length === 0) {
    return json({ purged: 0, photosDeleted: 0, cutoff });
  }

  let photosDeleted = 0;
  for (const { id } of expired) {
    photosDeleted += await deleteCardPhotos(supabase, id);
  }

  const ids = expired.map((c) => c.id);
  const { error: delErr } = await supabase.from("cards").delete().in("id", ids);
  if (delErr) {
    // Storage for these cards is already gone; the rows are not. The next
    // run will re-list (finding nothing) and retry the row delete.
    console.error(`delete cards: ${delErr.message}`);
    return json({ error: "delete_failed", detail: delErr.message, photosDeleted }, 500);
  }

  const result = {
    purged: ids.length,
    photosDeleted,
    cutoff,
    more: expired.length === CARD_BATCH,
  };
  console.log(JSON.stringify(result));
  return json(result);
});

// Files are stored flat as "<cardId>/<objectId>.<ext>" (src/lib/cardData.js
// uploadPhoto), so a single non-recursive listing per card is enough. Paged
// defensively in case one card ever holds more than LIST_PAGE photos.
async function deleteCardPhotos(
  supabase: SupabaseClient,
  cardId: string,
): Promise<number> {
  let removed = 0;
  for (let offset = 0;; offset += LIST_PAGE) {
    const { data, error } = await supabase
      .storage
      .from(BUCKET)
      .list(cardId, { limit: LIST_PAGE, offset });

    if (error) {
      console.error(`list ${cardId}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    const paths = data
      .filter((e) => e.id !== null) // skip any nested folder placeholder
      .map((e) => `${cardId}/${e.name}`);

    if (paths.length > 0) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
      if (rmErr) {
        console.error(`remove ${cardId}: ${rmErr.message}`);
      } else {
        removed += paths.length;
      }
    }
    if (data.length < LIST_PAGE) break;
  }
  return removed;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
