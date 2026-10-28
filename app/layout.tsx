import type { Metadata, Viewport } from "next";
import Script from "next/script";
import {
  Geist,
  Geist_Mono,
  Montserrat,
  Bebas_Neue,
  Poppins,
  Oswald,
  Anton,
  Bangers,
  Fredoka,
  Righteous,
  Nunito,
  Roboto,
  Open_Sans,
  Inter,
  Permanent_Marker,
  Pacifico,
  Lobster,
  Alfa_Slab_One,
  Staatliches,
  Fugaz_One,
  Chewy,
  Playfair_Display,
  Lora,
  Plus_Jakarta_Sans,
  Outfit,
  Lilita_One,
  Jost,
  Rubik,
  Roboto_Mono,
  Figtree,
} from "next/font/google";
import { Toaster } from "sonner";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import "./globals.css";
import { cn } from "@/lib/utils";

const robotoMono = Roboto_Mono({
  preload: false,
  subsets: [
    "cyrillic",
    "cyrillic-ext",
    "greek",
    "latin",
    "latin-ext",
    "vietnamese",
  ],
  weight: ["100", "200", "300", "400", "500", "600", "700"],
  variable: "--font-roboto-mono",
});

const rubik = Rubik({
  preload: false,
  subsets: [
    "arabic",
    "cyrillic",
    "cyrillic-ext",
    "hebrew",
    "latin",
    "latin-ext",
  ],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-rubik",
});

const jost = Jost({
  preload: false,
  subsets: ["cyrillic", "latin", "latin-ext"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-jost",
});

const figtree = Figtree({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  preload: false,
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  preload: false,
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  preload: false,
  display: "swap",
});

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  preload: false,
  display: "swap",
});

const anton = Anton({
  variable: "--font-anton",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const bangers = Bangers({
  variable: "--font-bangers",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const righteous = Righteous({
  variable: "--font-righteous",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  preload: false,
  display: "swap",
});

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  preload: false,
  display: "swap",
});

const permanentMarker = Permanent_Marker({
  variable: "--font-permanent-marker",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const pacifico = Pacifico({
  variable: "--font-pacifico",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const lobster = Lobster({
  variable: "--font-lobster",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const alfaSlabOne = Alfa_Slab_One({
  variable: "--font-alfa-slab-one",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const staatliches = Staatliches({
  variable: "--font-staatliches",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const fugazOne = Fugaz_One({
  variable: "--font-fugaz-one",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const chewy = Chewy({
  variable: "--font-chewy",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  preload: true,
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const lilitaOne = Lilita_One({
  variable: "--font-lilita-one",
  subsets: ["latin"],
  weight: "400",
  preload: false,
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://subtitle.fatahtech.com"),
  applicationName: "FatahTech Subtitles",
  title: {
    default: "Free AI Subtitle Generator & SRT Maker | FatahTech Subtitles",
    template: "%s | FatahTech Subtitles",
  },
  description:
    "Generate SRT files and burned-in subtitles free with our AI subtitle generator. Automatic subtitles for videos in 100+ languages — local, no sign-up.",
  keywords: [
    "free srt generator",
    "srt generator",
    "free srt maker",
    "ai subtitle generator",
    "free ai subtitle generator",
    "auto subtitle generator",
    "auto subtitle generator for videos",
    "free online video subtitle maker",
    "video subtitle maker",
    "subtitle generator",
    "generate srt online",
    "add subtitles to video",
    "video captions",
    "subtitle editor",
    "transcribe video",
    "background removal",
    "color grading",
    "local ai",
    "privacy-first",
    "whisper",
    "transformers.js",
  ],
  alternates: {
    canonical: "/",
  },
  authors: [{ name: "FatahTech", url: "https://fatahtech.com" }],
  creator: "FatahTech",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "FatahTech Subtitles",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192", sizes: "192x192", type: "image/png" },
      { url: "/icon-512", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      {
        url: "/apple-touch-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://subtitle.fatahtech.com",
    siteName: "FatahTech Subtitles",
    title: "Free AI Subtitle Generator & SRT Maker",
    description:
      "Create SRT files and subtitled videos free. AI subtitle generator for 100+ languages, local background removal, and color grading — no sign-up.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free AI Subtitle Generator & SRT Maker",
    description:
      "Create SRT files and subtitled videos free. AI subtitle generator for 100+ languages, local background removal, and color grading — no sign-up.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "",
  },
};

const SOFTWARE_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "FatahTech Subtitles",
  url: "https://subtitle.fatahtech.com",
  description:
    "Free AI subtitle generator and SRT maker. Auto-generate subtitles for videos in 100+ languages, edit every word, remove backgrounds, and color grade — all privately in your browser.",
  applicationCategory: "MultimediaApplication",
  applicationSubCategory: "Subtitle Editor",
  operatingSystem: "Any (modern web browser)",
  browserRequirements: "Requires WebGPU or WebAssembly",
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  featureList: [
    "Free AI subtitle generator with word-level timestamps",
    "SRT file generation and burned-in MP4/WebM subtitle export",
    "Auto subtitle generator for videos in 100+ languages",
    "On-device Whisper transcription with no video uploads",
    "AI background removal for people and products",
    "Color & Light grading with footage-aware presets",
    "Custom font, color, and per-word subtitle styling",
    "Face-aware subtitle placement and split subtitle mode",
  ],
  creator: {
    "@type": "Organization",
    name: "FatahTech",
    url: "https://fatahtech.com",
  },
  sameAs: ["https://github.com/THJ420/FatahTech_Subtitles"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        figtree.variable,
        jost.variable,
        rubik.variable,
        robotoMono.variable,
        "font-sans",
      )}
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} ${bebasNeue.variable} ${poppins.variable} ${oswald.variable} ${anton.variable} ${bangers.variable} ${fredoka.variable} ${righteous.variable} ${nunito.variable} ${roboto.variable} ${openSans.variable} ${inter.variable} ${permanentMarker.variable} ${pacifico.variable} ${lobster.variable} ${alfaSlabOne.variable} ${staatliches.variable} ${fugazOne.variable} ${chewy.variable} ${playfairDisplay.variable} ${lora.variable} ${plusJakartaSans.variable} ${outfit.variable} ${lilitaOne.variable} antialiased`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(SOFTWARE_APPLICATION_JSON_LD),
          }}
        />
        <Toaster position="top-center" richColors />
        {children}
        <PwaInstallBanner />
        <Script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="0a0b9573-0bbf-4229-a918-3a5224cb2d1b"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
