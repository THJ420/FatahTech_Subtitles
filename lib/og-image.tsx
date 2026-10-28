import { ImageResponse } from "next/og";

/**
 * Social share card for subtitle.fatahtech.com.
 *
 * Wired up through the `opengraph-image` and `twitter-image` file
 * conventions in `app/`, so the URL is generated and served by this
 * deployment. The previous metadata pointed at
 * `deifos.github.io/images/basedsubs-og-banner.webp`, which is not owned by
 * this project and returned no image.
 *
 * Colours mirror the landing page tokens in `app/globals.css`
 * (dark slate terminal surface, electric royal blue, cyan sky).
 */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export function createSocialImage(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background:
          "linear-gradient(135deg, #020617 0%, #0f172a 55%, #1e293b 100%)",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 82,
            height: 82,
            borderRadius: 22,
            background: "#2563eb",
            color: "#ffffff",
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: -2,
          }}
        >
          FT
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: "#ffffff",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: -1,
            }}
          >
            FatahTech Subtitles
          </div>
          <div
            style={{
              display: "flex",
              color: "#7dd3fc",
              fontSize: 20,
              letterSpacing: 1,
            }}
          >
            subtitle.fatahtech.com
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            display: "flex",
            maxWidth: 940,
            color: "#ffffff",
            fontSize: 62,
            fontWeight: 800,
            lineHeight: 1.12,
            letterSpacing: -2.5,
          }}
        >
          AI subtitles that run locally in your browser
        </div>
        <div
          style={{
            display: "flex",
            maxWidth: 880,
            color: "#c3c6d7",
            fontSize: 26,
            lineHeight: 1.45,
          }}
        >
          Generate word-level subtitles on your own device. No uploads, no
          account, no watermark.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {["100% local", "Free & open source", "WebGPU accelerated"].map(
          (label) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                borderRadius: 999,
                padding: "10px 22px",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.16)",
                color: "#e2e8f0",
                fontSize: 21,
              }}
            >
              {label}
            </div>
          ),
        )}
      </div>
    </div>,
    OG_SIZE,
  );
}
