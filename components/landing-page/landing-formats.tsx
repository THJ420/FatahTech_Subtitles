import styles from "./landing.module.css";

const FORMAT_ROWS = [
  {
    kind: "Input video",
    formats: "MP4, MOV, MKV, WebM",
    detail:
      "Decoded locally with MediaBunny. Playback depends on the codecs your browser supports.",
  },
  {
    kind: "Subtitle download",
    formats: "SRT, WebVTT, TXT, JSON",
    detail:
      "Free, uncapped downloads with no account. Timings follow your edits.",
  },
  {
    kind: "Finished video",
    formats: "MP4, WebM",
    detail:
      "Captions burned into the picture. The optional branding watermark can be switched off.",
  },
] as const;

const FORMAT_NOTES = [
  {
    title: "Input video formats",
    body: "Drop an MP4, MOV, MKV, or WebM file straight into the browser. The file is demuxed on your device and never uploaded, so a free video subtitle generator can work without a server queue.",
  },
  {
    title: "Subtitle download formats",
    body: "Download SRT for YouTube and most editors, WebVTT for the web, plain TXT for scripts and transcripts, or JSON when you need word-level timings.",
  },
  {
    title: "Burned-in video exports",
    body: "Export MP4 or WebM with subtitles baked into every frame. Preview and export share the same renderer, so styled captions and colour grading match exactly.",
  },
] as const;

export function LandingFormats() {
  return (
    <section id="formats" className={styles.capabilities}>
      <div className={styles.container}>
        <div className={styles.capabilitiesCard}>
          <div className={styles.capabilitiesHead}>
            <div>
              <span className={styles.eyebrow}>Formats</span>
              <h2>
                Supported Formats: Auto-caption MP4, MOV, MKV to SRT, VTT, and
                TXT
              </h2>
            </div>
            <p>
              FatahTech Subtitles auto-captions MP4, MOV, MKV, and WebM video in
              your browser. Download subtitles as SRT, WebVTT, TXT, or JSON, or
              export an MP4 or WebM with captions burned in.
            </p>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.compareTable}>
              <caption className="sr-only">
                Supported input video, subtitle download, and finished video
                export formats for FatahTech Subtitles.
              </caption>
              <thead>
                <tr>
                  <th scope="col">File type</th>
                  <th scope="col" data-local="true">
                    Formats
                  </th>
                  <th scope="col">What you get</th>
                </tr>
              </thead>
              <tbody>
                {FORMAT_ROWS.map((row) => (
                  <tr key={row.kind}>
                    <th scope="row">{row.kind}</th>
                    <td data-col="local">{row.formats}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.formatNotes}>
            {FORMAT_NOTES.map(({ title, body }) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
