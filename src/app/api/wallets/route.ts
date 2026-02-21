import { NextResponse } from "next/server";
import { getAllWalletInfo } from "@/lib/kite/wallets";

export async function GET() {
  try {
    const wallets = await getAllWalletInfo();
    return NextResponse.json(wallets);
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
