let registration: Promise<void> | undefined;

/** Load the software encoder only when the selected AAC settings need it. */
export async function ensureAacEncoder(options: {
  bitrate: number;
  numberOfChannels: number;
  sampleRate: number;
}): Promise<void> {
  const { canEncodeAudio, Quality } = await import("mediabunny");
  if (
    await canEncodeAudio("aac", {
      numberOfChannels: options.numberOfChannels,
      sampleRate: options.sampleRate,
      quality: new Quality({ bitrate: options.bitrate }),
    })
  ) {
    return;
  }

  registration ??= import("@mediabunny/aac-encoder")
    .then(({ registerAacEncoder }) => registerAacEncoder())
    .catch((error: unknown) => {
      // Permit another attempt if the encoder download failed.
      registration = undefined;
      throw error;
    });
  await registration;
}
