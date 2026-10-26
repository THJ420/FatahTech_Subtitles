import { OG_CONTENT_TYPE, OG_SIZE, createSocialImage } from "@/lib/og-image";

export const alt =
  "FatahTech Subtitles - AI subtitles that run locally in your browser";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return createSocialImage();
}
