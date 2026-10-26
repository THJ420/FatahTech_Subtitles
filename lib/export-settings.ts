/** Keep stacked output geometry independent of the source aspect ratio. */
export function getExportDimensions(
  sourceWidth: number,
  sourceHeight: number,
  ratio: "16:9" | "9:16",
  stackedPortrait: boolean,
  mobile: boolean,
) {
  let width = sourceWidth;
  let height = sourceHeight;
  if (ratio === "9:16" && (stackedPortrait || sourceWidth > sourceHeight)) {
    width = (height * 9) / 16;
  }
  const longest = Math.max(width, height);
  const scale = mobile
    ? Math.min(1, 1280 / longest)
    : Math.max(1, 1080 / longest);
  width = Math.max(2, Math.round((width * scale) / 2) * 2);
  height = Math.max(2, Math.round((height * scale) / 2) * 2);
  return { width, height };
}
