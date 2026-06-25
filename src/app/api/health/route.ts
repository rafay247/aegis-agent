import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    name: "Aegis",
    status: "ok",
    phase: "phase-3",
    timestamp: new Date().toISOString()
  });
}
