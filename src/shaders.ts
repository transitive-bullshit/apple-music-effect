// GLSL for the engine. The surface is closed-form: the rig's dome of oil (a superellipse
// footprint, a round crown and shoulder, a steep rim, an optional wave train on its edge) and the
// rod's ripples on it. The optics trace each pixel's view ray through it to the logo on the floor,
// once per wavelength.

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`

export const OPTICS = /* glsl */ `${HEADER}
in vec2 vUv;
uniform vec2 uViewCenter;
uniform float uViewHalfHeight;
uniform float uAspect;
uniform sampler2D uLogo;
uniform vec4 uLogoRect;    // world min.xy, size.xy
uniform vec2 uLogoTexels;  // texture size in px
uniform vec3 uLogoColor;
uniform vec3 uFloorColor;
uniform float uDepth;
uniform float uIorOil;
uniform float uDispersion;
uniform float uDispersionKnee;
uniform float uMaxSlope;
uniform int uWavelengths;
uniform float uDefocus;
uniform float uBlur;
uniform float uReflect;
uniform float uSoftbox;
uniform float uHorizon;
uniform float uRingLight;
uniform float uRingWidth;  // its angular spread (in tan of the angle off the axis): wider is softer
uniform vec4 uBall;        // xy centre, z height of centre, w radius (0 for none)
uniform vec2 uLensCenter;
uniform vec3 uLens;        // radius (half-height), height, superellipse exponent
uniform float uLensAspect; // the footprint's width over its height
uniform vec3 uLensProfile; // crown, flat, shoulder
uniform float uLensEdge;
uniform vec4 uLensRing;    // the wave on its edge: amplitude, width, wavelength (0: a single crest), and how far outside the rim it runs
uniform float uLensRingPhase; // how far its crests have travelled, in wavelengths × 2π
uniform vec4 uRipple;      // amplitude, wavelength, phase, reach (fraction of the dome's radius)
uniform float uReveal;     // 1: the logo shows only within the dome's footprint
uniform float uRevealSoft;
uniform float uSeed;
uniform int uDebug;        // 1: surface height, 2: slope, 4: ray offset on the floor, 5: its direction
uniform float uDebugScale;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// The dome: H exp(-crown r² - shoulder r⁴) (1 - rho^flat)^edge, with r the distance and rho the
// footprint's, both in units of its half-size (exponent 2 is an ellipse; ~3-5 a rounded rectangle). The crown magnifies
// radially, the shoulder steepens it toward the rim, and the falloff is a steep rim that follows the
// footprint; the round part stays positive into the footprint's corners, so they stay smooth. A
// wave on its edge (the bubble's leading ripple, the wordmark's echoes) rides outside it.
float lensZ(vec2 p) {
  if (uLens.x <= 0.0) return 0.0;
  vec2 o = p - uLensCenter;
  vec2 d = abs(o) / (uLens.x * vec2(uLensAspect, 1.0));
  float rho = pow(pow(d.x, uLens.z) + pow(d.y, uLens.z), 1.0 / uLens.z);
  // distance from the rim along the way out from the centre
  float dist = length(o) * (1.0 - 1.0 / max(rho, 1e-4));
  float e = (dist - uLensRing.w) / max(uLensRing.y, 1e-4);
  float train = uLensRing.z > 0.0 ? cos(6.2831853 * (dist - uLensRing.w) / uLensRing.z - uLensRingPhase) : 1.0;
  float ring = uLensRing.x * exp(-e * e) * train;
  if (rho >= 1.0 || uLens.y <= 0.0) return ring;
  float r2 = dot(d, d);
  float crown = exp(-uLensProfile.x * r2 - uLensProfile.z * r2 * r2);
  return ring + uLens.y * crown * pow(1.0 - pow(rho, uLensProfile.y), uLensEdge);
}

// the rod's ripples on the dome: rings running outward from the centre, fading toward its rim
float ripples(vec2 p) {
  if (uRipple.x <= 0.0 || uLens.x <= 0.0) return 0.0;
  float r = length(p - uLensCenter);
  float fade = 1.0 - smoothstep(0.0, uRipple.w * uLens.x, r);
  return uRipple.x * fade * sin(6.2831853 * r / uRipple.y - uRipple.z);
}

float surface(vec2 p) {
  return lensZ(p) + ripples(p);
}

// the dispersion at this pixel: uDispersion, or with a knee, gathered onto steep slopes (half at the
// knee's slope): in Apple's film only the rims' smears carry colour while the magnified interior
// stays clean, which no single Cauchy coefficient gives (fringes grow with the ray's offset alone)
float dispersionHere = 0.0;

// Cauchy dispersion: n(lambda) = A + B / lambda², with B scaled by the dispersion around n at 589 nm
float ior(float n589, float lambda) {
  float B = 0.0044 * dispersionHere;
  return n589 + B * (1.0 / (lambda * lambda) - 1.0 / (0.5893 * 0.5893));
}

float lobe(float x, float mu, float s1, float s2) {
  float t = (x - mu) / (x < mu ? s1 : s2);
  return exp(-0.5 * t * t);
}

// the linear sRGB response to light of one wavelength (µm): the CIE 1931 2° colour-matching
// functions (Wyman, Sloan and Shirley's multi-lobe fit) through the XYZ to sRGB matrix. Partial
// spectra give the real spectral colours (red, orange, yellow, cyan, blue, violet); the negative
// lobes are out of gamut and are pulled back to grey after accumulation
vec3 spectrum(float lambda) {
  float l = lambda * 1000.0;
  float x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  float y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  float z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return mat3(3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570) * vec3(x, y, z);
}

// a dark studio: a key softbox left of the camera and a dim fill right; straight up is the camera.
// A ring light around the lens, 39° off its axis, catches slopes of about 0.35 whichever way they
// face: steep ripples show as rings all the way round, a low dome as a faint circle at its steepest
vec3 env(vec3 r) {
  if (r.z <= 0.0) return vec3(0.0);
  vec2 s = r.xy / max(r.z, 0.05);
  float key = 1.0 - smoothstep(0.0, 0.3, length(max(abs(s - vec2(-1.5, 0.1)) - vec2(0.25, 0.55), 0.0)));
  float fill = 1.0 - smoothstep(0.0, 0.4, length(max(abs(s - vec2(1.8, -0.2)) - vec2(0.2, 0.7), 0.0)));
  // the studio's walls, seen only at grazing angles: steep rims catch them as bright lines
  float horizon = uHorizon * smoothstep(1.2, 4.0, length(s));
  // none near the axis, so flat oil stays black however soft the ring
  float ring = exp(-pow((length(s) - 0.8) / uRingWidth, 2.0)) * smoothstep(0.15, 0.4, length(s));
  return vec3(0.95, 0.97, 1.0) * (uSoftbox * (key + 0.25 * fill) + uRingLight * ring + horizon);
}

// the floor is lit only where the dome has reached (its footprint at the current size)
float revealAt(vec2 q) {
  if (uReveal < 0.5 || uLens.x <= 0.0) return 1.0;
  vec2 d = abs(q - uLensCenter) / (uLens.x * vec2(uLensAspect, 1.0));
  float rho = pow(pow(d.x, uLens.z) + pow(d.y, uLens.z), 1.0 / uLens.z);
  return 1.0 - smoothstep(1.0 - uRevealSoft, 1.0, rho);
}

vec4 logoAt(vec2 q, float lod) {
  vec2 uv = (q - uLogoRect.xy) / uLogoRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return textureLod(uLogo, vec2(uv.x, 1.0 - uv.y), lod);
}

void main() {
  vec2 p = uViewCenter + (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uViewHalfHeight;
  vec3 V = vec3(0.0, 0.0, -1.0);

  // the rig's chrome tip, where it stands above the oil
  if (uBall.w > 0.0) {
    vec2 d = p - uBall.xy;
    float r2 = uBall.w * uBall.w - dot(d, d);
    if (r2 > 0.0) {
      float zHit = uBall.z + sqrt(r2);
      if (zHit > surface(p)) {
        vec3 N = normalize(vec3(d, zHit - uBall.z));
        vec3 R = reflect(V, N);
        // polished steel in a dark studio, as the film's: mostly dark, the softboxes as highlights,
        // a dim rim from the walls, the camera dark
        vec2 s = R.xy / max(R.z, 0.05);
        float walls = 0.12 * smoothstep(0.4, 3.0, length(s));
        vec3 col = 0.5 * (env(R) - vec3(uHorizon * smoothstep(1.2, 4.0, length(s)))) + walls + 0.015;
        col *= mix(1.0, 0.35, smoothstep(0.9, 0.995, R.z));
        outColor = vec4(col, 1.0);
        return;
      }
    }
  }

  // the slope by central differences, a fixed step in world units so every resolution agrees
  const float h = 0.0015;
  float z = surface(p);
  float zx1 = surface(p + vec2(h, 0.0)), zx0 = surface(p - vec2(h, 0.0));
  float zy1 = surface(p + vec2(0.0, h)), zy0 = surface(p - vec2(0.0, h));
  vec2 grad = vec2(zx1 - zx0, zy1 - zy0) / (2.0 * h);
  // oil meets glass at its contact angle: no steeper than that, however sharp the modelled rim
  if (uMaxSlope > 0.0) grad *= min(1.0, uMaxSlope / max(length(grad), 1e-6));
  float curv = (zx1 + zx0 + zy1 + zy0 - 4.0 * z) / (h * h);
  vec3 N = normalize(vec3(-grad, 1.0));

  if (uDebug == 1 || uDebug == 2) {
    float v = uDebug == 1 ? z / uDebugScale : length(grad) / uDebugScale;
    // height in red with contour lines every 1/10 of the scale; slope in grey
    vec3 c = uDebug == 1 ? vec3(1.0, 0.3, 0.1) * min(abs(v), 1.0) : vec3(min(v, 1.0));
    if (uDebug == 1) c += 0.25 * smoothstep(0.9, 1.0, abs(fract(v * 10.0) * 2.0 - 1.0));
    outColor = vec4(c + 0.15 * logoAt(p, 0.0).a, 1.0);
    return;
  }

  float g2 = dot(grad, grad);
  float k2 = uDispersionKnee * uDispersionKnee;
  dispersionHere = uDispersion * (k2 > 0.0 ? g2 / (g2 + k2) : 1.0);

  float texelsPerUnit = uLogoTexels.x / uLogoRect.z;
  float spread = uDefocus * uDepth * abs(curv) * 0.02 * texelsPerUnit;
  float lod = uBlur + log2(1.0 + spread);

  float jitter = hash(gl_FragCoord.xy + uSeed * 17.0);
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  int count = max(uWavelengths, 1);
  for (int i = 0; i < 64; i++) {
    if (i >= count) break;
    float lambda = mix(0.38, 0.72, (float(i) + jitter) / float(count));
    vec3 w = spectrum(lambda);
    vec3 T = refract(V, N, 1.0 / ior(uIorOil, lambda));
    vec2 q = p + T.xy * (z + uDepth) / max(-T.z, 1e-3);
    if (uDebug >= 4 && i == count / 2) {
      vec2 o = (q - p) / uDebugScale;
      outColor = uDebug == 4 ? vec4(vec3(length(o)), 1.0) : vec4(0.5 + 0.5 * o, 0.0, 1.0);
      outColor += 0.2 * logoAt(p, 0.0).a;
      return;
    }
    vec4 L = logoAt(q, lod);
    acc += w * mix(uFloorColor, uLogoColor, L.a * revealAt(q));
    wsum += w;
  }
  vec3 col = acc / wsum;
  // spectral colours fall outside sRGB: pull negatives toward grey at the same luminance
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float lowest = min(col.r, min(col.g, col.b));
  if (lowest < 0.0) col = lum > 0.0 ? mix(vec3(lum), col, lum / (lum - lowest)) : vec3(0.0);

  // Fresnel reflection of the studio off the surface
  float cosI = clamp(N.z, 0.0, 1.0);
  float r0 = pow((uIorOil - 1.0) / (uIorOil + 1.0), 2.0);
  float F = r0 + (1.0 - r0) * pow(1.0 - cosI, 5.0);
  col = col * (1.0 - F) + uReflect * F * env(reflect(V, N));
  outColor = vec4(col, 1.0);
}
`

/** adds a subframe into the accumulation target (additively blended by the caller) */
export const COPY = /* glsl */ `${HEADER}
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uScale;
out vec4 outColor;
void main() { outColor = texture(uSrc, vUv) * uScale; }
`

export const DOWNSAMPLE = /* glsl */ `${HEADER}
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec4 c = texture(uSrc, vUv) * 4.0;
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0));
  c += texture(uSrc, vUv + uTexel * vec2(1.0, -1.0));
  c += texture(uSrc, vUv + uTexel * vec2(-1.0, 1.0));
  c += texture(uSrc, vUv + uTexel * vec2(1.0, 1.0));
  outColor = c / 8.0;
}
`

export const UPSAMPLE = /* glsl */ `${HEADER}
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 outColor;
void main() {
  vec2 o = uTexel * uRadius;
  vec4 c = texture(uSrc, vUv + vec2(-o.x * 2.0, 0.0)) + texture(uSrc, vUv + vec2(o.x * 2.0, 0.0));
  c += texture(uSrc, vUv + vec2(0.0, -o.y * 2.0)) + texture(uSrc, vUv + vec2(0.0, o.y * 2.0));
  c += (texture(uSrc, vUv + vec2(-o.x, -o.y)) + texture(uSrc, vUv + vec2(o.x, -o.y)) + texture(uSrc, vUv + vec2(-o.x, o.y)) + texture(uSrc, vUv + vec2(o.x, o.y))) * 2.0;
  outColor = texture(uBase, vUv) + c / 12.0;
}
`

export const FINISH = /* glsl */ `${HEADER}
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform float uBloomAmount;
uniform float uExposure;
uniform float uFade;
uniform float uVignette;
uniform float uGrain;
uniform float uSeed;
uniform float uAspect;
uniform float uSaturation; // the grade: 1 leaves colour as rendered
uniform vec3 uGlowTint;    // the colour of the glow around bright things (the bloom)
uniform vec3 uBalance;     // white balance: per-channel gain
uniform float uBlack;      // display level crushed to black
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture(uSrc, vUv).rgb;
  c += uBloomAmount * uGlowTint * texture(uBloom, vUv).rgb;
  c *= uBalance;
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVignette * dot(v, v);
  c *= uExposure * uFade;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(vec3(lum) + (c - vec3(lum)) * uSaturation, 0.0);
  // a soft shoulder above 0.8 so blooming highlights roll off instead of clipping hard
  vec3 over = max(c - 0.8, 0.0);
  c = min(c, 0.8) + over / (1.0 + over / 0.2);
  vec3 s = toSrgb(clamp(c, 0.0, 1.0));
  s = max(s - uBlack, 0.0) / (1.0 - uBlack);
  s += uGrain * (hash(gl_FragCoord.xy + uSeed * 31.0) - 0.5);
  outColor = vec4(s, 1.0);
}
`
