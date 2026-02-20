import { NextRequest, NextResponse } from "next/server";
import { inputOrchestrator } from "@/lib/orchestrator/input";
import { outputOrchestrator } from "@/lib/orchestrator/output";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { query } = body;

  if (!query || typeof query !== "string") {
    return NextResponse.json(
      { error: "A query string is required." },
      { status: 400 }
    );
  }

  const individualResponses = await inputOrchestrator(query);
  const result = await outputOrchestrator(query, individualResponses);

  return NextResponse.json(result);
}
