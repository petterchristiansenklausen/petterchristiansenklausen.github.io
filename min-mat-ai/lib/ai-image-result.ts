import sharp from "sharp";
export const maximumImageBase64 = 4_000_000; // Envelope stays below Vercel's 4.5 MB limit.
export async function prepareImageResult(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.length || value.length > 8_000_000 ||
      value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("invalid_image");
  const input = Buffer.from(value, "base64");
  if (input.toString("base64") !== value) throw new Error("invalid_image");
  // Re-encoding forces full pixel decoding (a JPEG/PNG magic prefix is insufficient).
  const image = await sharp(input, { failOn: "warning", limitInputPixels: 16_777_216 })
    .rotate().resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();
  const encoded = image.toString("base64");
  if (encoded.length > maximumImageBase64) throw new Error("image_too_large");
  return encoded;
}
