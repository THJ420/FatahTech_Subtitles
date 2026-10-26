export function formatSubtitleText(
  text: string,
  style: { uppercase?: boolean },
): string {
  return style.uppercase ? text.toUpperCase() : text;
}

export function getWordEmphasisBackground(style: {
  wordEmphasisBackgroundColor?: string;
}): string {
  return style.wordEmphasisBackgroundColor ?? "#000000";
}
