import { test } from "node:test";
import assert from "node:assert/strict";
import type { SubtitleStyle } from "../components/subtitle-styling";
import { formatSubtitleText } from "../lib/subtitle-appearance";
import {
  renderSubtitle,
  renderDynamicWordWithOptions,
} from "../lib/export-renderer";
import {
  renderSubtitleToCanvas,
  renderDynamicBehindText,
} from "../lib/render-subtitle";
import {
  processTranscriptChunks,
  transcriptToSrt,
} from "../lib/transcript-utils";

const baseStyle: SubtitleStyle = {
  fontFamily: "Arial, sans-serif",
  fontSize: 22,
  fontWeight: "700",
  color: "#FFFFFF",
  backgroundColor: "transparent",
  backgroundStyle: "solid",
  borderWidth: 0,
  borderColor: "#000000",
  dropShadowIntensity: 0,
  uppercase: false,
  wordEmphasisEnabled: false,
  wordEmphasisColorEnabled: false,
  wordEmphasisColor: "#000000",
  wordEmphasisBackgroundColor: "#FFE600",
  windEnabled: false,
  position: "bottom",
  maxWordsPerLine: 6,
  backgroundRemovalEnabled: false,
  backgroundType: "solid",
  solidBackgroundColor: "#000000",
  dynamicEnabled: false,
  dynamicFontSize: 80,
  dynamicYPosition: 35,
  dynamicFrontFontSize: 40,
  dynamicFrontYPosition: 75,
  dynamicFollowWord: false,
  textFadeIn: false,
  showWatermark: true,
  splitSubtitleMode: "none",
  verticalOffset: 0,
};
const words = [
  {
    text: "Hello",
    timestamp: [0, 1] as [number, number],
    dynamicPosition: "behind" as const,
  },
  {
    text: "world",
    timestamp: [1, 2] as [number, number],
    dynamicPosition: "behind" as const,
  },
];
const transcript = { text: "Hello world", chunks: words };
const chunk = {
  text: "Hello world",
  timestamp: [0, 2] as [number, number],
  words,
};

function recordingCanvas() {
  const text: Array<{
    text: string;
    color: unknown;
    x: number;
    y: number;
    font: unknown;
    composite: unknown;
  }> = [];
  const fills: unknown[] = [];
  const measurements: string[] = [];
  const properties: Record<string, unknown> = {
    fillStyle: "#000000",
    globalAlpha: 1,
    font: "22px Arial",
  };
  const stack: Array<Record<string, unknown>> = [];
  const context = new Proxy(properties, {
    get(target, key: string) {
      if (key === "save") return () => stack.push({ ...target });
      if (key === "restore") return () => Object.assign(target, stack.pop());
      if (key === "fillText")
        return (value: string, x: number, y: number) =>
          text.push({
            text: value,
            color: target.fillStyle,
            x,
            y,
            font: target.font,
            composite: target.globalCompositeOperation,
          });
      if (key === "fill") return () => fills.push(target.fillStyle);
      if (key === "measureText")
        return (value: string) => {
          measurements.push(value);
          return {
            width: value.length * 12,
            actualBoundingBoxAscent: 16,
            actualBoundingBoxDescent: 5,
          };
        };
      return key in target ? target[key] : () => {};
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, text, fills, measurements };
}

test("case conversion is optional and does not change transcript exports", () => {
  assert.equal(
    formatSubtitleText("Hello world! Straße", {}),
    "Hello world! Straße",
  );
  assert.equal(
    formatSubtitleText("Hello world! Straße", { uppercase: true }),
    "HELLO WORLD! STRASSE",
  );
  assert.match(transcriptToSrt(transcript, "phrase"), /Hello world/);
});

for (const uppercase of [false, true]) {
  for (const splitSubtitleMode of [
    "none",
    "above-below",
    "left-right",
  ] as const) {
    test(`preview and export retain case with uppercase=${uppercase}, split=${splitSubtitleMode}`, () => {
      const style = { ...baseStyle, uppercase, splitSubtitleMode };
      const preview = recordingCanvas();
      const exported = recordingCanvas();
      renderSubtitleToCanvas(
        preview.context,
        transcript,
        0.5,
        style,
        "phrase",
        1080,
        1920,
      );
      renderSubtitle(
        exported.context,
        chunk,
        style,
        { width: 1080, height: 1920 } as HTMLCanvasElement,
        "phrase",
        0.5,
      );
      const expected = uppercase ? "HELLO WORLD" : "Hello world";
      for (const recorded of [preview, exported]) {
        assert.equal(
          recorded.text.map((item) => item.text).join(" "),
          expected,
        );
        assert.ok(
          recorded.measurements.every(
            (value) => uppercase || !value.includes("HELLO"),
          ),
        );
      }
    });
  }
}

test("active background color works without a full caption background in preview and export", () => {
  for (const background of ["#FFE600", "#19B5FE"]) {
    const style = {
      ...baseStyle,
      wordEmphasisEnabled: true,
      wordEmphasisColorEnabled: true,
      wordEmphasisBackgroundColor: background,
    };
    const preview = recordingCanvas();
    const exported = recordingCanvas();
    renderSubtitleToCanvas(
      preview.context,
      transcript,
      0.5,
      style,
      "phrase",
      1080,
      1920,
    );
    renderSubtitle(
      exported.context,
      chunk,
      style,
      { width: 1080, height: 1920 } as HTMLCanvasElement,
      "phrase",
      0.5,
    );
    for (const recorded of [preview, exported]) {
      assert.deepEqual(recorded.fills, [background]);
      assert.deepEqual(
        recorded.text.map(({ text, color }) => ({ text, color })),
        [
          { text: "Hello", color: "#000000" },
          { text: "world", color: "#FFFFFF" },
        ],
      );
    }
  }
});

test("disabling resize removes only the active background", () => {
  const recorded = recordingCanvas();
  renderSubtitleToCanvas(
    recorded.context,
    transcript,
    0.5,
    { ...baseStyle, wordEmphasisColorEnabled: true },
    "phrase",
    1080,
    1920,
  );
  assert.deepEqual(recorded.fills, []);
  assert.equal(recorded.text[0].color, "#000000");
});

test("behind-person preview and export honor the case setting", () => {
  for (const uppercase of [false, true]) {
    const style = { ...baseStyle, dynamicEnabled: true, uppercase };
    const preview = recordingCanvas();
    const exported = recordingCanvas();
    renderDynamicBehindText(
      preview.context,
      transcript,
      0.5,
      style,
      1080,
      1920,
    );
    renderDynamicWordWithOptions(
      exported.context,
      chunk.text,
      style,
      { width: 1080, height: 1920 } as HTMLCanvasElement,
      { fontSize: 80, yPosition: 35 },
      words,
      0.5,
      2,
    );
    const expected = uppercase ? "HELLO WORLD" : "Hello world";
    assert.equal(preview.text.map((item) => item.text).join(" "), expected);
    assert.equal(exported.text.map((item) => item.text).join(" "), expected);
  }
});

for (const [width, height] of [
  [1920, 1080],
  [1080, 1920],
]) {
  test(`manual caption placement and size match both canvas renderers at ${width}x${height}`, () => {
    const style = {
      ...baseStyle,
      fontSize: 48,
      customPosition: { x: 0.3, y: 0.4 },
    };
    const preview = recordingCanvas();
    const exported = recordingCanvas();
    renderSubtitleToCanvas(
      preview.context,
      transcript,
      0.5,
      style,
      "phrase",
      width,
      height,
    );
    renderSubtitle(
      exported.context,
      chunk,
      style,
      { width, height } as HTMLCanvasElement,
      "phrase",
      0.5,
    );
    for (const recording of [preview, exported]) {
      assert.ok(recording.text.length > 0);
      assert.equal(recording.text[0].x, width * 0.3);
      assert.equal(recording.text[0].y, height * 0.4);
      assert.match(
        String(recording.text[0].font),
        new RegExp(`${Math.round((48 * height) / 500)}px`),
      );
    }
  });
}

for (const mode of ["word", "phrase"] as const) {
  test(`local ${mode} placement reaches preview and export without changing the next caption`, () => {
    const key = mode === "phrase" ? "phrasePlacement" : "wordPlacement";
    const localTranscript = {
      text: "Hello world next",
      chunks: [
        {
          text: "Hello",
          timestamp: [0, 1] as [number, number],
          styleOverride: {
            [key]: { customPosition: { x: 0.25, y: 0.3 }, fontSize: 50 },
          },
        },
        { text: "next", timestamp: [4, 5] as [number, number] },
      ],
    };
    const processed = processTranscriptChunks(localTranscript, mode);
    for (const index of [0, 1]) {
      const preview = recordingCanvas();
      const exported = recordingCanvas();
      const time = index === 0 ? 0.5 : 4.5;
      renderSubtitleToCanvas(
        preview.context,
        localTranscript,
        time,
        baseStyle,
        mode,
        1000,
        500,
      );
      renderSubtitle(
        exported.context,
        processed[index],
        baseStyle,
        { width: 1000, height: 500 } as HTMLCanvasElement,
        mode,
        time,
      );
      for (const recorded of [preview, exported]) {
        assert.equal(recorded.text[0].x, index === 0 ? 250 : 500);
        if (index === 0) assert.equal(recorded.text[0].y, 150);
        assert.match(
          String(recorded.text[0].font),
          index === 0 ? /50px/ : /22px/,
        );
      }
    }
  });
}

for (const mode of ["word", "phrase"] as const) {
  test(`${mode} mode exports local font, color, emoji replacement and overlay without emphasis`, () => {
    const styled = {
      text: "Hello",
      timestamp: [0, 2] as [number, number],
      styleOverride: {
        color: "#ff0000",
        fontSize: 2,
        fontFamily: "Arial",
        emoji: "🔥",
        emojiOverlay: "⭐",
        emojiScale: 1.5,
      },
    };
    const transcript = { text: styled.text, chunks: [styled] };
    const chunk = processTranscriptChunks(transcript, mode)[0];
    for (const renderer of ["preview", "export"]) {
      const recorded = recordingCanvas();
      if (renderer === "preview")
        renderSubtitleToCanvas(
          recorded.context,
          transcript,
          1,
          baseStyle,
          mode,
          500,
          500,
        );
      else
        renderSubtitle(
          recorded.context,
          chunk,
          baseStyle,
          { width: 500, height: 500 } as HTMLCanvasElement,
          mode,
          1,
        );
      assert.deepEqual(
        recorded.text.map((t) => t.text),
        ["🔥", "⭐"],
      );
      assert.equal(recorded.text[0].color, "#ff0000");
      assert.match(
        String(recorded.text[0].font),
        /79\.19999999999999px|79\.2px/,
      );
      assert.match(
        String(recorded.text[1].font),
        /92\.39999999999999px|92\.4px/,
      );
    }
  });
  test(`${mode} mode honors local knockout without enabling phrase emphasis`, () => {
    const styled = {
      text: "Hello",
      timestamp: [0, 2] as [number, number],
      styleOverride: { effect: "knockout" as const },
    };
    const transcript = { text: styled.text, chunks: [styled] };
    const chunk = processTranscriptChunks(transcript, mode)[0];
    const recorded = recordingCanvas();
    renderSubtitle(
      recorded.context,
      chunk,
      baseStyle,
      { width: 500, height: 500 } as HTMLCanvasElement,
      mode,
      1,
    );
    assert.equal(recorded.text[0].color, "#FFFFFF");
    assert.equal(recorded.text[0].composite, "difference");
  });
}

test("word styling remains active when a phrase split setting is retained", () => {
  const word = {
    text: "Hello",
    timestamp: [0, 2] as [number, number],
    styleOverride: { color: "#ef1234", fontSize: 1.5, fontFamily: "Arial" },
  };
  for (const splitSubtitleMode of [
    "none",
    "left-right",
    "above-below",
  ] as const) {
    const style = { ...baseStyle, splitSubtitleMode };
    const exported = recordingCanvas();
    const preview = recordingCanvas();
    renderSubtitle(
      exported.context,
      word,
      style,
      { width: 500, height: 500 } as HTMLCanvasElement,
      "word",
      1,
    );
    renderSubtitleToCanvas(
      preview.context,
      { text: word.text, chunks: [word] },
      1,
      style,
      "word",
      500,
      500,
    );
    for (const result of [exported, preview]) {
      assert.equal(result.text[0].text, "Hello");
      assert.equal(result.text[0].color, "#ef1234");
      assert.match(String(result.text[0].font), /33px/);
    }
  }
});
