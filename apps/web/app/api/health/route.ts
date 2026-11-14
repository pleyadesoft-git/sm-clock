import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: '@sm-clock/web',
    timestamp: new Date().toISOString(),
  });
}
