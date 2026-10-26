import { LandingDropzone } from "./landing-dropzone";
import styles from "./landing.module.css";

interface LandingDropzoneSectionProps {
  onVideoSelect?: (file: File) => void;
}

/**
 * Full-width upload band that sits directly under the tech stack bar, as in
 * the reference layout. The dropzone itself is unchanged, so the file
 * selection -> `onVideoSelect` wiring into the studio is untouched.
 */
export function LandingDropzoneSection({
  onVideoSelect,
}: LandingDropzoneSectionProps) {
  return (
    <section id="dropzone" className={styles.dropzoneSection}>
      <div className={`${styles.container} ${styles.dropzoneSectionInner}`}>
        <LandingDropzone onVideoSelect={onVideoSelect} />
      </div>
    </section>
  );
}