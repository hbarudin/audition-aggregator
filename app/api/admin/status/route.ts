import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin';

// The theaters list is statically rendered and cached for an hour, so it can't
// read the session cookie itself without going dynamic for every visitor.
// The client asks here instead, and only the admin's answer differs.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { admin: await isAdmin() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
