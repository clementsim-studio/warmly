// ===========================================================================
// Warmly - clear the card-photos Storage bucket
// ===========================================================================
// TRUNCATE does not touch Supabase Storage. This walks the `card-photos`
// bucket (files live at "<cardId>/<objectId>.<ext>") and deletes every file,
// removing the underlying blobs - not just the storage.objects metadata rows.
//
// Pairs with wipe_user_data.sql for a full pre-launch reset. Run either
// order - this script walks the bucket itself and needs nothing from the DB.
//
// Needs the SERVICE ROLE key (the bucket has no DELETE policy for anon).
// That key is in the Vercel project env and the Supabase dashboard
// (Project Settings > API > service_role), NOT in the repo .env.
//
// Run:
//   VITE_SUPABASE_URL="https://xxxx.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
//   node clear_storage.mjs
// ===========================================================================
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = 'card-photos';
const PAGE = 1000;

let removed = 0;

async function clearPrefix(prefix = '') {
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    if (!data.length) break;

    const files = [];
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await clearPrefix(path); // a "folder" (cardId/) - recurse
      } else {
        files.push(path);
      }
    }
    if (files.length) {
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove(files);
      if (rmErr) throw rmErr;
      removed += files.length;
      console.log(`removed ${files.length} file(s) under "${prefix || '/'}"`);
    }
    if (data.length < PAGE) break;
  }
}

await clearPrefix();
console.log(`done - ${removed} file(s) removed from ${BUCKET}`);
