import { readJson, routeError } from "@/lib/http";
import { createPrice, listPrices } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ prices: listPrices(query) });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    createPrice(body.itemName, body.unitCopper);
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
