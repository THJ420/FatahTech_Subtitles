/**
 * GPU color-grade pass used by both the live preview and the export renderer.
 *
 * A WebGL2 fragment shader applies the canonical grade from `lib/color-grade`
 * in linear light. When WebGL2 is unavailable (or the context is lost) the
 * instance permanently falls back to a Canvas 2D `ctx.filter` approximation.
 * Preview and export both call `detectColorGradeEngine()`, so a given browser
 * picks the same engine for both paths.
 *
 * The module has no top-level DOM access; it is safe to import from Node
 * (e.g. `lib/bg-composite.ts` imports only its type).
 */

import {
  colorGradeFilter,
  sanitizeColorGrade,
  type ColorGrade,
} from "@/lib/color-grade";

export type ColorGradeEngine = "webgl" | "filter";

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColorGradeRenderer {
  readonly engine: ColorGradeEngine;
  /**
   * Render `sourceRect` of `source` at `destWidth` × `destHeight` with the
   * grade applied. Returns the renderer's own opaque canvas, valid until the
   * next call.
   */
  render(
    source: CanvasImageSource,
    sourceRect: SourceRect,
    destWidth: number,
    destHeight: number,
    grade: ColorGrade,
  ): HTMLCanvasElement;
  dispose(): void;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Keep this in sync with `gradeRgb` in lib/color-grade.ts.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexture;
uniform vec4 uUvRect;
uniform float uGrade[9];

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float srgbToLinearChannel(float c) {
  c = clamp(c, 0.0, 1.0);
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

float linearToSrgbChannel(float c) {
  c = max(c, 0.0);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

float lumaOf(vec3 c) {
  return dot(c, LUMA);
}

void main() {
  // uUvRect is top-left based; GL texture rows start at the top.
  vec2 uv = vec2(
    uUvRect.x + vUv.x * uUvRect.z,
    1.0 - uUvRect.y - vUv.y * uUvRect.w
  );
  vec3 srgb = texture(uTexture, uv).rgb;
  vec3 c = vec3(
    srgbToLinearChannel(srgb.r),
    srgbToLinearChannel(srgb.g),
    srgbToLinearChannel(srgb.b)
  );

  float temperature = uGrade[5];
  float tint = uGrade[6];
  float rGain = (1.0 + 0.2 * temperature) * (1.0 + 0.1 * tint);
  float gGain = 1.0 - 0.2 * tint;
  float bGain = (1.0 - 0.2 * temperature) * (1.0 + 0.1 * tint);
  float gainLuma = max(1e-6, dot(vec3(rGain, gGain, bGain), LUMA));
  c *= vec3(rGain, gGain, bGain) / gainLuma;

  c *= pow(2.0, 1.5 * uGrade[0]);

  float luma = lumaOf(c);
  float shadowGain =
    1.0 + 0.6 * uGrade[8] * (1.0 - smoothstep(0.0, 0.2, luma));
  float highlightGain =
    1.0 + 0.6 * uGrade[7] * smoothstep(0.2, 0.9, luma);
  c *= shadowGain * highlightGain;

  c = pow(max(c, vec3(0.0)), vec3(pow(2.0, -uGrade[2])));

  c = vec3(0.18) + (c - vec3(0.18)) * (1.0 + 0.75 * uGrade[1]);

  luma = lumaOf(c);
  c = vec3(luma) + (c - vec3(luma)) * (1.0 + uGrade[3]);

  luma = lumaOf(c);
  float maxChannel = max(max(c.r, c.g), c.b);
  float minChannel = min(min(c.r, c.g), c.b);
  float chroma =
    maxChannel > 1e-6 ? (maxChannel - minChannel) / maxChannel : 0.0;
  float vibranceGain =
    1.0 + 0.8 * uGrade[4] * (1.0 - smoothstep(0.0, 0.6, chroma));
  c = vec3(luma) + (c - vec3(luma)) * vibranceGain;

  c = clamp(c, 0.0, 1.0);
  vec3 encoded = vec3(
    linearToSrgbChannel(c.r),
    linearToSrgbChannel(c.g),
    linearToSrgbChannel(c.b)
  );
  outColor = vec4(encoded, 1.0);
}
`;

const GRADE_ORDER = [
  "exposure",
  "contrast",
  "gamma",
  "saturation",
  "vibrance",
  "temperature",
  "tint",
  "highlights",
  "shadows",
] as const;

let cachedEngine: ColorGradeEngine | null = null;

/**
 * Whether this browser can run the full grade. Cached; the probe context is
 * released immediately so it does not count against the editor's budget.
 */
export function detectColorGradeEngine(): ColorGradeEngine {
  if (cachedEngine) return cachedEngine;
  if (typeof document === "undefined") return "filter";
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) {
      cachedEngine = "filter";
      return cachedEngine;
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cachedEngine = "webgl";
  } catch {
    cachedEngine = "filter";
  }
  return cachedEngine;
}

function sourceSize(source: CanvasImageSource): {
  width: number;
  height: number;
} {
  if (
    typeof HTMLVideoElement !== "undefined" &&
    source instanceof HTMLVideoElement
  ) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if (
    typeof HTMLImageElement !== "undefined" &&
    source instanceof HTMLImageElement
  ) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (
    typeof HTMLCanvasElement !== "undefined" &&
    source instanceof HTMLCanvasElement
  ) {
    return { width: source.width, height: source.height };
  }
  if (
    typeof OffscreenCanvas !== "undefined" &&
    source instanceof OffscreenCanvas
  ) {
    return { width: source.width, height: source.height };
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { width: source.width, height: source.height };
  }
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return { width: source.displayWidth, height: source.displayHeight };
  }
  return { width: 0, height: 0 };
}

class WebGLColorGradeRenderer implements ColorGradeRenderer {
  private canvas: HTMLCanvasElement;
  private mode: ColorGradeEngine;
  private gl: WebGL2RenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uvRectLocation: WebGLUniformLocation | null = null;
  private gradeLocation: WebGLUniformLocation | null = null;
  private textureLocation: WebGLUniformLocation | null = null;
  private positionLocation = -1;
  private maxTextureSize = 0;
  private readonly gradeValues = new Float32Array(GRADE_ORDER.length);
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.switchToFilter();
  };

  constructor(engine: ColorGradeEngine) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.mode = engine;
    if (engine === "webgl") {
      try {
        this.initWebGL();
      } catch (error) {
        console.warn("Color grading fell back to the Canvas 2D filter:", error);
        this.switchToFilter();
      }
    } else {
      this.ctx2d = this.canvas.getContext("2d");
    }
  }

  get engine(): ColorGradeEngine {
    return this.mode;
  }

  private initWebGL(): void {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const program = this.createProgram(gl);
    this.program = program;
    this.positionLocation = gl.getAttribLocation(program, "aPosition");
    this.uvRectLocation = gl.getUniformLocation(program, "uUvRect");
    this.gradeLocation = gl.getUniformLocation(program, "uGrade");
    this.textureLocation = gl.getUniformLocation(program, "uTexture");

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Could not allocate the grade quad");
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate the grade texture");
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
  }

  private createProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not create a grade shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "unknown error";
        gl.deleteShader(shader);
        throw new Error(`Grade shader failed to compile: ${log}`);
      }
      return shader;
    };

    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create the grade program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "unknown error";
      gl.deleteProgram(program);
      throw new Error(`Grade program failed to link: ${log}`);
    }
    gl.useProgram(program);
    return program;
  }

  private switchToFilter(): void {
    this.disposeWebGL();
    // A canvas is locked to its first context type, so use a fresh surface.
    const replacement = document.createElement("canvas");
    replacement.width = Math.max(1, this.canvas.width);
    replacement.height = Math.max(1, this.canvas.height);
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.canvas = replacement;
    this.mode = "filter";
    this.ctx2d = replacement.getContext("2d");
  }

  private disposeWebGL(): void {
    const gl = this.gl;
    if (gl) {
      this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.texture = null;
    this.uvRectLocation = null;
    this.gradeLocation = null;
    this.textureLocation = null;
    this.positionLocation = -1;
  }

  render(
    source: CanvasImageSource,
    sourceRect: SourceRect,
    destWidth: number,
    destHeight: number,
    grade: ColorGrade,
  ): HTMLCanvasElement {
    const width = Math.max(1, Math.round(destWidth));
    const height = Math.max(1, Math.round(destHeight));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    const safe = sanitizeColorGrade(grade);
    if (this.mode === "webgl" && this.gl) {
      try {
        return this.renderWebGL(source, sourceRect, width, height, safe);
      } catch (error) {
        console.warn("Color grading fell back to the Canvas 2D filter:", error);
        this.switchToFilter();
      }
    }
    return this.renderFilter(source, sourceRect, width, height, safe);
  }

  private renderWebGL(
    source: CanvasImageSource,
    sourceRect: SourceRect,
    width: number,
    height: number,
    grade: ColorGrade,
  ): HTMLCanvasElement {
    const gl = this.gl;
    if (
      !gl ||
      !this.program ||
      !this.texture ||
      !this.buffer ||
      this.positionLocation < 0 ||
      !this.uvRectLocation ||
      !this.gradeLocation ||
      !this.textureLocation
    ) {
      throw new Error("Grade renderer is not initialized");
    }

    const intrinsic = sourceSize(source);
    if (!intrinsic.width || !intrinsic.height) {
      throw new Error("Grade source has no intrinsic size");
    }
    if (
      intrinsic.width > this.maxTextureSize ||
      intrinsic.height > this.maxTextureSize
    ) {
      throw new Error("Source exceeds the maximum WebGL texture size");
    }

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource,
    );
    gl.uniform1i(this.textureLocation, 0);

    gl.uniform4f(
      this.uvRectLocation,
      sourceRect.x / intrinsic.width,
      sourceRect.y / intrinsic.height,
      sourceRect.width / intrinsic.width,
      sourceRect.height / intrinsic.height,
    );

    for (let index = 0; index < GRADE_ORDER.length; index += 1) {
      this.gradeValues[index] = grade[GRADE_ORDER[index]] / 100;
    }
    gl.uniform1fv(this.gradeLocation, this.gradeValues);

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return this.canvas;
  }

  private renderFilter(
    source: CanvasImageSource,
    sourceRect: SourceRect,
    width: number,
    height: number,
    grade: ColorGrade,
  ): HTMLCanvasElement {
    if (!this.ctx2d) this.ctx2d = this.canvas.getContext("2d");
    const ctx = this.ctx2d;
    if (!ctx) throw new Error("Could not create the fallback grade context");
    ctx.save();
    ctx.filter = colorGradeFilter(grade);
    ctx.drawImage(
      source,
      sourceRect.x,
      sourceRect.y,
      Math.max(1, sourceRect.width),
      Math.max(1, sourceRect.height),
      0,
      0,
      width,
      height,
    );
    ctx.restore();
    return this.canvas;
  }

  dispose(): void {
    this.disposeWebGL();
    this.ctx2d = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

export function createColorGradeRenderer(): ColorGradeRenderer {
  return new WebGLColorGradeRenderer(detectColorGradeEngine());
}
