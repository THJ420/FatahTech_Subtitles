export const SITE_URL = "https://subtitle.fatahtech.com";
export const SITE_CANONICAL = `${SITE_URL}/`;
export const SITE_NAME = "FatahTech Subtitles";
export const PARENT_ORGANIZATION_ID = "https://fatahtech.com/#organization";
export const FREE_TOOLS_URL = "https://fatahtech.com/tools/freebies";
export const REPOSITORY_URL = "https://github.com/THJ420/FatahTech_Subtitles";

export const FAQ_ITEMS = [
  {
    question: "Is this subtitle generator really 100% free with no watermarks?",
    answer:
      "Yes. Every feature is free, the code is MIT licensed, and there is no subscription or per-minute fee. The optional FatahTech watermark is on by default, but you can switch it off in the Video tab so the exported video is completely watermark-free.",
  },
  {
    question: "Does my video file get uploaded to any server?",
    answer:
      "No. Video decoding, Whisper speech recognition, background removal, and color grading all run inside your browser tab. Your video and audio never leave your device; only the AI model files are downloaded and cached for offline use.",
  },
  {
    question: "Which languages are supported?",
    answer:
      "Whisper supports speech in more than 100 languages, including English, Spanish, French, German, Portuguese, Hindi, Arabic, Japanese, Korean, and Chinese. Choose the spoken language before transcription and the model writes subtitles in that language.",
  },
  {
    question:
      "Can I auto-caption MP4, MOV, MKV, and WebM videos in my browser?",
    answer:
      "Yes. FatahTech Subtitles reads common MP4, MOV, MKV, and WebM files through MediaBunny and transcribes their audio locally. Playback and export depend on the codecs your browser can decode, which covers the H.264/AAC files most creators use.",
  },
  {
    question: "How do I create an SRT or VTT file for free?",
    answer:
      "Import a video, run the AI subtitle generator, edit any words, then download SRT, WebVTT, plain TXT, or JSON. No account, payment, or upload is required.",
  },
  {
    question: "Does the subtitle generator work offline?",
    answer:
      "After the speech model and runtime are cached, the editor can transcribe and export without a connection. The first run needs internet access to download the model files.",
  },
  {
    question: "Are burned-in subtitles watermarked?",
    answer:
      "Only if you leave the optional branding watermark enabled. Turn off Show Watermark in the Video tab and both the preview and the exported MP4 or WebM are free of watermarks.",
  },
  {
    question: "Which subtitle and video formats can I export?",
    answer:
      "Download SRT, WebVTT, TXT, or JSON subtitle files, or export an MP4 or WebM video with burned-in captions. Every export is generated locally in your browser.",
  },
] as const;

export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": PARENT_ORGANIZATION_ID,
      name: "FatahTech",
      url: "https://fatahtech.com",
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon-512`,
      },
      sameAs: [REPOSITORY_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_CANONICAL,
      name: SITE_NAME,
      description:
        "Free AI subtitle generator that runs locally in your browser. Auto-caption videos, edit every word, and export SRT, VTT, TXT, or subtitled MP4 and WebM files without uploading your video.",
      publisher: { "@id": PARENT_ORGANIZATION_ID },
      inLanguage: "en",
    },
    {
      "@type": ["WebApplication", "SoftwareApplication"],
      "@id": `${SITE_URL}/#webapp`,
      name: SITE_NAME,
      alternateName: "FatahTech Free AI Subtitle Generator",
      url: SITE_CANONICAL,
      description:
        "A free AI subtitle generator and video caption editor that runs 100% in your browser. Generate automatic captions in 100+ languages, edit every word, export SRT, VTT, TXT, or JSON, and burn subtitles into MP4 or WebM with no server uploads.",
      applicationCategory: "MultimediaApplication",
      applicationSubCategory: "Subtitle Editor",
      operatingSystem: "Web Browser",
      browserRequirements: "WebGPU or WebAssembly in a modern browser",
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        url: SITE_CANONICAL,
      },
      featureList: [
        "Free AI subtitle generator with word-level timestamps",
        "Automatic captions in your browser with no video uploads",
        "Auto-caption MP4, MOV, MKV, and WebM videos",
        "Export SRT, WebVTT, TXT, and JSON subtitle files",
        "Burn subtitles into MP4 and WebM video exports",
        "Optional watermark can be switched off for watermark-free exports",
        "Whisper speech recognition in 100+ languages",
        "On-device background removal and color grading",
      ],
      publisher: { "@id": PARENT_ORGANIZATION_ID },
      creator: { "@id": PARENT_ORGANIZATION_ID },
      sameAs: [REPOSITORY_URL],
      image: `${SITE_URL}/opengraph-image`,
      inLanguage: "en",
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${SITE_URL}/#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: SITE_CANONICAL,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Free AI Subtitle Generator",
          item: `${SITE_URL}/#top`,
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      isPartOf: { "@id": `${SITE_URL}/#website` },
      mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      })),
    },
  ],
} as const;
