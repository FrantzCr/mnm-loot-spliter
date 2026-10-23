import { exportPriceBook } from "@/lib/price-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const body = exportPriceBook();
  const stamp = body.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mnm-loot-spliter-prices-${stamp}.json"`,
    },
  });
}
