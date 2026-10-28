import { Check, Minus } from "lucide-react";
import styles from "./landing.module.css";

type Cell = { kind: "yes" | "no" | "text"; value: string };

/**
 * A capability comparison, not a benchmark table.
 *
 * The reference mock published specific performance figures ("3.8x
 * Realtime", "18.4x RT", "482 words in 0.4s") attributed to named hardware
 * that had never been measured. Unsourced speed numbers are advertising
 * claims we cannot substantiate, so this table compares capabilities and
 * architecture instead. Every claim in the "FatahTech" column is a
 * verifiable property of this codebase; the other columns are deliberately
 * general characterisations of a category of tool, not assertions about
 * any specific product.
 */
const ROWS: { label: string; local: Cell; cloud: Cell; cli: Cell }[] = [
  {
    label: "Where the video is processed",
    local: { kind: "text", value: "In your browser tab" },
    cloud: { kind: "text", value: "Uploaded to a remote server" },
    cli: { kind: "text", value: "On your machine" },
  },
  {
    label: "Account required",
    local: { kind: "text", value: "No" },
    cloud: { kind: "text", value: "Usually yes" },
    cli: { kind: "text", value: "No" },
  },
  {
    label: "Cost",
    local: { kind: "text", value: "Free, MIT licensed" },
    cloud: { kind: "text", value: "Paid subscription" },
    cli: { kind: "text", value: "Free" },
  },
  {
    label: "Install required",
    local: { kind: "text", value: "No" },
    cloud: { kind: "text", value: "No" },
    cli: { kind: "text", value: "Python, FFmpeg, a terminal" },
  },
  {
    label: "Works offline once cached",
    local: { kind: "yes", value: "Yes" },
    cloud: { kind: "no", value: "Needs a connection" },
    cli: { kind: "yes", value: "Yes" },
  },
  {
    label: "Face-aware subtitle placement",
    local: { kind: "yes", value: "Built in" },
    cloud: { kind: "text", value: "Usually manual" },
    cli: { kind: "no", value: "Not available" },
  },
  {
    label: "Styled / word-level editing",
    local: { kind: "yes", value: "Yes" },
    cloud: { kind: "text", value: "Varies" },
    cli: { kind: "no", value: "Text output only" },
  },
  {
    label: "Color grading and footage-aware presets",
    local: { kind: "yes", value: "Built in" },
    cloud: { kind: "text", value: "Extra tools" },
    cli: { kind: "text", value: "Manual filters" },
  },
];

function CellValue({ cell }: { cell: Cell }) {
  if (cell.kind === "text") return <>{cell.value}</>;
  return (
    <>
      {cell.kind === "yes" ? (
        <Check size={15} strokeWidth={2.6} aria-hidden="true" />
      ) : (
        <Minus size={15} strokeWidth={2.4} aria-hidden="true" />
      )}
      <span>{cell.value}</span>
    </>
  );
}

export function LandingCapabilities() {
  return (
    <section id="benchmarks" className={styles.capabilities}>
      <div className={styles.container}>
        <div className={styles.capabilitiesCard}>
          <div className={styles.capabilitiesHead}>
            <div>
              <span className={styles.eyebrow}>Comparison</span>
              <h2>Free AI subtitle generator vs traditional subtitle tools</h2>
            </div>
            <p>
              A capability comparison against the usual alternatives. No speed
              numbers: we have not published benchmarks, so we do not quote any.
            </p>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.compareTable}>
              <caption className="sr-only">
                Capability comparison between local browser-based transcription,
                cloud subtitle services, and a local command line tool.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col" data-local="true">
                    FatahTech Subtitles
                  </th>
                  <th scope="col">Typical cloud service</th>
                  <th scope="col">Local CLI (Whisper)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td data-col="local">
                      <CellValue cell={row.local} />
                    </td>
                    <td
                      data-col="cloud"
                      data-bad={row.cloud.kind === "no" || undefined}
                    >
                      <CellValue cell={row.cloud} />
                    </td>
                    <td data-col="cli">
                      <CellValue cell={row.cli} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
