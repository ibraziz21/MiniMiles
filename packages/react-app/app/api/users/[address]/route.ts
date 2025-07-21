// app/api/users/[address]/route.ts
import {  NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

export async function GET(  _req: Request, context: any) {
  const address = context.params.address?.toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "Bad address" }, { status: 400 });
  }

  // 1) ensure the stub row exists (ignore duplicate conflicts)
const { error: upErr } = await supabase
.from('users')
.upsert({ user_address: address }, { onConflict: 'user_address', ignoreDuplicates: true });

if (upErr) {
console.error(upErr);
return NextResponse.json({ error: 'DB error' }, { status: 500 });
}

// 2) fetch the flag
const { data, error } = await supabase
.from('users')
.select('is_member')
.eq('user_address', address)
.single();

if (error) {
console.error(error);
return NextResponse.json({ error: 'DB error' }, { status: 500 });
}

return NextResponse.json({ isMember: data.is_member === true });
}
