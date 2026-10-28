import styles from "./landing.module.css";

const FAQS = [
  {
    question: "How do I create an SRT file for free?",
    answer:
      "Import a video, run the AI subtitle generator in your browser, edit any words, then export SRT or a burned-in MP4/WebM. No account, payment, or upload is required.",
  },
  {
    question: "Is this auto subtitle generator really free?",
    answer:
      "Yes. FatahTech Subtitles is MIT-licensed, has no subscription, and runs Whisper locally in your browser. There is no per-minute fee and no video upload.",
  },
  {
    question: "Does the AI subtitle generator support other languages?",
    answer:
      "Whisper supports speech in more than 100 languages. Choose the spoken language before transcription and the model writes subtitles in that language.",
  },
  {
    question: "Is my video uploaded to a server?",
    answer:
      "No. Video decoding, speech recognition, background removal, and color grading all run on your device. Model files download once and are cached for offline use.",
  },
  {
    question: "Can I remove the background and color grade the video too?",
    answer:
      "Yes. The editor includes AI background removal with solid, blur, transparent, and image backdrops, plus Color & Light grading with footage-aware presets and manual sliders.",
  },
  {
    question: "Which export formats are available?",
    answer:
      "Export subtitled MP4 or WebM with burned-in captions, or download a standalone SRT file for YouTube, social platforms, and other editors.",
  },
] as const;

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map(({ question, answer }) => ({
    "@type": "Question",
    name: question,
    acceptedAnswer: {
      "@type": "Answer",
      text: answer,
    },
  })),
};

export function LandingFAQ() {
  return (
    <section id="faq" className={styles.faq}>
      <div className={styles.container}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>FAQ</span>
          <h2>Free AI subtitle generator questions, answered</h2>
          <p>
            Everything about generating SRT files, auto subtitles, and graded
            video exports in your browser.
          </p>
        </div>
        <div className={styles.faqGrid}>
          {FAQS.map(({ question, answer }) => (
            <article key={question} className={styles.faqItem}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
    </section>
  );
}
