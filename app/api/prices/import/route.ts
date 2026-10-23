import { routeError } from "@/lib/http";
import { ErrorCode } from "@/lib/codes";
import {
  applyPriceImport,
  parsePriceImportBytes,
  previewPriceImport,
  type PriceImportMode,
} from "@/lib/price-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Cap import uploads so a huge file cannot fill temp disk. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const modeRaw = String(form.get("mode") ?? "preview");
    if (!(file instanceof File)) throw new Error(ErrorCode.priceImportBadFile);
    if (file.size > MAX_IMPORT_BYTES) throw new Error(ErrorCode.priceImportTooLarge);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error(ErrorCode.priceImportTooLarge);
    const entries = parsePriceImportBytes(bytes, file.name || "import.json");

    if (modeRaw === "preview") {
      return Response.json({ preview: previewPriceImport(entries) });
    }
    if (modeRaw !== "keepLocal" && modeRaw !== "replaceConflicts") {
      throw new Error(ErrorCode.requestFailed);
    }
    const result = applyPriceImport(entries, modeRaw as PriceImportMode);
    return Response.json({ result });
  } catch (error) {
    return routeError(error);
  }
}
