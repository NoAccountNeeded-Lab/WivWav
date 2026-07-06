import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME } from '@/lib/session'

/** POST /api/logout — clears the session cookie. */
export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ data: { authenticated: false } })
}
