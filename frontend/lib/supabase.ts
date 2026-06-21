import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kwjjwmpcnukfxmwhjwed.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_J5ZbLQ1s7ExHzot7JzDXSg_cSLBuFzm';

export const supabase = createClient(url, key);
