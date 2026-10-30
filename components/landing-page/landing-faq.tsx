import { FAQ_ITEMS } from "@/lib/seo";
import styles from "./landing.module.css";

export function LandingFAQ() {
  return (
    <section id="faq" className={styles.faq}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>FAQ</span>
          <h2>Free AI subtitle generator FAQ: cost, privacy, and formats</h2>
          <p>
            Direct answers about free subtitle generation, local privacy, auto
            captions in your browser, and watermark-free exports.
          </p>
        </div>
        <div className={styles.faqGrid}>
          {FAQ_ITEMS.map(({ question, answer }) => (
            <article key={question} className={styles.faqItem}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
