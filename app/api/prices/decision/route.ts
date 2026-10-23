import { readJson, routeError } from "@/lib/http";
import { choosePriceFromSale } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJson(request);
  try {
    choosePriceFromSale(body.itemName, body.choice);
    return Response.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
}
