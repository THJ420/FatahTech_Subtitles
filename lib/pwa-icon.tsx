import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

interface PwaIconResponseOptions {
  size: number;
}

/**
 * Serves the brand favicon asset (`public/logo_light_fav.webp`) resized to
 * the requested square size as PNG. This keeps the `/icon-192`,
 * `/icon-512` and `/apple-touch-icon` URLs (referenced by the layout
 * metadata and the web manifest) stable while swapping the previous
 * generated "FT" monogram for the real logo.
 */
export async function createPwaIconResponse({
  size,
}: PwaIconResponseOptions): Promise<Response> {
  const source = await readFile(
    path.join(process.cwd(), "public", "logo_light_fav.webp"),
  );
  const png = await sharp(source)
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
