import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "Aegis",
    status: "ok",
    phase: "phase-2",
    timestamp: new Date().toISOString()
  });
}
