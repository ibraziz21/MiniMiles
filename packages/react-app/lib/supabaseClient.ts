// lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://zebnpxmyimoaeogkrsyp.supabase.co';
const supabaseAnonKey = 'YOUR_ANON_PUBLIC_KEY'; // get from Supabase → Project → Settings → API

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
