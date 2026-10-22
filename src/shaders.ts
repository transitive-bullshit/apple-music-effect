// GLSL for the engine. The oil is a staggered-grid shallow-water simulation (elevation in r, the
// x and y fluxes on the cells' +x and +y faces in g and b); the optics trace each pixel's view ray
// through the oil surface (or the glass cover where it breaks the surface) to the logo on the floor,
// once per wavelength.

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`

/** the glass cover: footprint from a distance field, a bevelled edge and a domed crown */
const COVER = /* glsl */ `
uniform sampler2D uSdf;
uniform vec4 uSdfRect;     // world min.xy, size.xy
uniform int uHasCover;
uniform vec2 uCoverCenter;
uniform vec2 uCoverHalf;
uniform float uRigZ;       // the rig's height relative to the oil's rest level
uniform float uCrown;
uniform float uBevel;
uniform float uBevelWidth;
uniform vec2 uCoverTilt;   // the rig rocks: slope of the cover's top in x and y

float coverSdf(vec2 p) {
  vec2 uv = (p - uSdfRect.xy) / uSdfRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1e3;
  return texture(uSdf, uv).r;
}

// the cover's top surface; -1e3 outside its footprint
float coverTop(vec2 p) {
  if (uHasCover == 0) return -1e3;
  float s = -coverSdf(p);
  if (s <= 0.0) return -1e3;
  float x = clamp(s / uBevelWidth, 0.0, 1.0);
  float bevel = uBevel * sqrt(1.0 - (1.0 - x) * (1.0 - x));
  vec2 r = (p - uCoverCenter) / uCoverHalf;
  float crown = uCrown * max(0.0, 1.0 - dot(r, r));
  return uRigZ + bevel + crown + dot(uCoverTilt, p - uCoverCenter);
}

// The rig's dome: a lens of oil standing on the surface, with a superellipse footprint (exponent 2
// is a circle; ~5 the icon's rounded square). Its profile is a radial crown times an edge falloff:
// H (1 - crown r² - shoulder r⁴) (1 - rho^flat)^edge, with r the round distance and rho the
// footprint's. A round crown magnifies radially, so content slides toward the corners, and its
// shoulder steepens toward the rim; the falloff is steep only at the rim, where it follows the
// footprint.
uniform vec2 uLensCenter;
uniform float uLensEdge;
uniform vec3 uLensProfile; // crown, flat, shoulder
uniform vec3 uLensRing;    // amplitude, width and wavelength (0: a single crest) of the wave on the dome's edge
uniform vec2 uLensShift;   // the dome's centre, offset from the rig
uniform vec4 uLensWarp;    // tilt x, tilt y, astigmatism (x² - y²), skew (xy), relative to the crown
float lensZ(vec2 p, vec3 L) {
  // L: radius (half-size), height, superellipse exponent
  if (L.x <= 0.0) return 0.0;
  vec2 d0 = (p - uLensCenter - uLensShift) / L.x;
  vec2 d = abs(d0);
  float rho = pow(pow(d.x, L.z) + pow(d.y, L.z), 1.0 / L.z);
  // after the dome falls, its oil leaves as a ring crest on the same edge
  float dist = (rho - 1.0) * L.x;
  float e = dist / max(uLensRing.y, 1e-4);
  float train = uLensRing.z > 0.0 ? cos(6.2831853 * dist / uLensRing.z) : 1.0;
  float ring = uLensRing.x * exp(-e * e) * train;
  if (rho >= 1.0 || L.y <= 0.0) return ring;
  float r2 = dot(d, d);
  float crown = max(0.0, 1.0 - uLensProfile.x * r2 - uLensProfile.z * r2 * r2);
  float warp = max(0.0, 1.0 + uLensWarp.x * d0.x + uLensWarp.y * d0.y + uLensWarp.z * (d0.x * d0.x - d0.y * d0.y) + uLensWarp.w * d0.x * d0.y);
  return ring + L.y * crown * warp * pow(1.0 - pow(rho, uLensProfile.y), uLensEdge);
}

// 1 inside the footprint, 0 outside, smooth over a couple of grid cells
float coverMask(vec2 p, float w) {
  if (uHasCover == 0) return 0.0;
  return smoothstep(w, -w, coverSdf(p));
}
`

/** the floor under the oil: the tank's floor, raised to the cover's top over its footprint */
const FLOOR = /* glsl */ `
uniform float uH0;         // the oil's depth over the tank floor at rest
float floorAt(vec2 p) { return max(-uH0, coverTop(p)); }
`

const SIM_COMMON = /* glsl */ `
uniform sampler2D uState;
uniform ivec2 uGrid;
uniform vec4 uDomain;      // world min.xy, size.xy
uniform float uDx;
uniform float uDt;
uniform float uSponge;
vec4 S(ivec2 ij) { return texelFetch(uState, clamp(ij, ivec2(0), uGrid - 1), 0); }
vec2 worldAt(ivec2 ij) { return uDomain.xy + (vec2(ij) + 0.5) * uDx; }
float sponge(ivec2 ij) {
  vec2 e = min(vec2(ij), vec2(uGrid - 1 - ij)) / vec2(uGrid);
  return 1.0 - smoothstep(0.0, 0.06, min(e.x, e.y));
}
`

/** the oil at rest: level 0 wherever the floor is below it, dry where the cover stands above */
export const SIM_INIT = /* glsl */ `${HEADER}
${COVER}
${FLOOR}
${SIM_COMMON}
out vec4 outState;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  float b = floorAt(worldAt(ij));
  float h = max(-b, 0.0);
  outState = vec4(h, 0.0, 0.0, b + h);
}
`

// Nonlinear shallow water over a moving floor, on a staggered grid: depth h at cells (r), fluxes
// on the +x and +y faces (g, b), and the surface b + h kept in a for the optics. Fluxes take the
// depth upwind (from the higher surface), so a film drains off a rising cover without the depth
// going negative; thin films feel viscous drag (3 nu / h²), applied implicitly so it stays stable.
export const SIM_FLUX = /* glsl */ `${HEADER}
${COVER}
${FLOOR}
${SIM_COMMON}
uniform float uG;
uniform float uTension;
uniform float uViscosity;
uniform float uFilmViscosity;
uniform float uDamping;
uniform float uHMin;
out vec4 outState;

// the surface (floor + depth), kept in a by the depth pass
float surf(ivec2 ij) { return S(ij).a; }
float lap(ivec2 ij) {
  return (surf(ij + ivec2(1, 0)) + surf(ij - ivec2(1, 0)) + surf(ij + ivec2(0, 1)) + surf(ij - ivec2(0, 1)) - 4.0 * surf(ij)) / (uDx * uDx);
}
float pressure(ivec2 ij) { return uG * surf(ij) - uTension * lap(ij); }

float faceFlux(float q, ivec2 a, ivec2 b, float lapq) {
  float ha = S(a).r, hb = S(b).r;
  float ea = surf(a), eb = surf(b);
  float hf = ea >= eb ? ha : hb;
  float force = -hf * (pressure(b) - pressure(a)) / uDx + uViscosity * lapq;
  float k = uDamping + 3.0 * uFilmViscosity / max(hf * hf, uHMin * uHMin);
  return (q + uDt * force) / (1.0 + uDt * k);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 s = S(ij);
  float lqx = (S(ij + ivec2(1, 0)).g + S(ij - ivec2(1, 0)).g + S(ij + ivec2(0, 1)).g + S(ij - ivec2(0, 1)).g - 4.0 * s.g) / (uDx * uDx);
  float lqy = (S(ij + ivec2(1, 0)).b + S(ij - ivec2(1, 0)).b + S(ij + ivec2(0, 1)).b + S(ij - ivec2(0, 1)).b - 4.0 * s.b) / (uDx * uDx);
  float qx = faceFlux(s.g, ij, ij + ivec2(1, 0), lqx);
  float qy = faceFlux(s.b, ij, ij + ivec2(0, 1), lqy);
  float damp = exp(-uDt * uSponge * sponge(ij));
  qx *= damp;
  qy *= damp;
  // closed tank: no flow through the outer walls
  if (ij.x >= uGrid.x - 1) qx = 0.0;
  if (ij.y >= uGrid.y - 1) qy = 0.0;
  outState = vec4(s.r, qx, qy, s.a);
}
`

export const SIM_DEPTH = /* glsl */ `${HEADER}
${COVER}
${FLOOR}
${SIM_COMMON}
uniform float uRigVel;     // d(rig height)/dt
uniform vec3 uLens0;       // the dome at the start and end of the step
uniform vec3 uLens1;
uniform float uLensRelease;
uniform float uDisplace;   // 1: a rising floor pushes wet oil aside instead of lifting it
uniform vec2 uSourceCenter;
uniform float uSourceCenterAmp;
uniform float uSourceRadius;
out vec4 outState;

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 s = S(ij);
  float qxw = ij.x > 0 ? S(ij - ivec2(1, 0)).g : 0.0;
  float qys = ij.y > 0 ? S(ij - ivec2(0, 1)).b : 0.0;
  float div = (s.g - qxw + s.b - qys) / uDx;
  vec2 p = worldAt(ij);
  // an optional extra push of oil at the rig's rod
  vec2 dc = (p - uSourceCenter) / uSourceRadius;
  float source = uSourceCenterAmp * uRigVel * exp(-dot(dc, dc));
  // as the dome falls, its oil joins the simulated surface where it stood
  source += uLensRelease * max(0.0, lensZ(p, uLens0) - lensZ(p, uLens1)) / uDt;
  float h = max(s.r - uDt * div + uDt * source, 0.0);
  float b = floorAt(p);
  // the floor moved under this cell: keep a wet surface where it was (the oil above the cover is
  // pushed aside rather than carried up), so a rising cover breaks through dry
  // (a sinking floor is left to the flow: oil floods in from the sides)
  float db = b - (s.a - s.r);
  if (db > 0.0) h = max(h - uDisplace * db, 0.0);
  // the sponge relaxes the edges back to rest, so waves leave the frame instead of returning
  float rest = max(-b, 0.0);
  h = mix(rest, h, exp(-uDt * uSponge * sponge(ij)));
  outState = vec4(h, s.g, s.b, b + h);
}
`

export const OPTICS = /* glsl */ `${HEADER}
${COVER}
in vec2 vUv;
uniform sampler2D uState;
uniform ivec2 uGrid;
uniform vec4 uDomain;
uniform float uDx;
uniform vec2 uViewCenter;
uniform float uViewHalfHeight;
uniform float uAspect;
uniform vec2 uPixel;       // world size of one output pixel
uniform sampler2D uLogo;
uniform vec4 uLogoRect;    // world min.xy, size.xy
uniform vec2 uLogoTexels;  // texture size in px
uniform vec3 uLogoColor;
uniform vec3 uFloorColor;
uniform float uDepth;
uniform float uIorOil;
uniform float uIorGlass;
uniform float uDispersion;
uniform float uDispersionKnee;
uniform float uMaxSlope;
uniform int uWavelengths;
uniform float uDefocus;
uniform float uBlur;
uniform float uReflect;
uniform float uSoftbox;
uniform float uHorizon;
uniform float uMeniscus;
uniform float uFilm;      // oil thinner than this over the cover reads as dry glass
uniform float uCoverOn;
uniform vec4 uBall;        // xy centre, z height of centre, w radius (0 for none)
uniform vec3 uLens;
uniform vec4 uRipple;      // amplitude, wavelength, phase, reach (fraction of the dome's radius)
uniform float uReveal;     // 1: the logo shows only within the dome's footprint
uniform float uRevealSoft;
uniform float uSeed;
uniform int uDebug;        // 1: surface height, 2: slope, 3: glass, 4: ray offset on the floor
uniform float uDebugScale;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Catmull-Rom weights
vec4 cubic(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

// the oil's surface (x) and depth (y), bicubic in the grid; at rest outside the simulated domain
vec2 oil(vec2 p) {
  vec2 g = (p - uDomain.xy) / uDx - 0.5;
  if (g.x < -1.0 || g.y < -1.0 || g.x > float(uGrid.x) || g.y > float(uGrid.y)) return vec2(0.0, uDepth);
  vec2 i = floor(g);
  vec2 f = g - i;
  vec4 wx = cubic(f.x), wy = cubic(f.y);
  ivec2 b = ivec2(i) - 1;
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 4; y++) {
    vec2 row = vec2(0.0);
    for (int x = 0; x < 4; x++) {
      vec4 v = texelFetch(uState, clamp(b + ivec2(x, y), ivec2(0), uGrid - 1), 0);
      row += v.ar * wx[x];
    }
    acc += row * wy[y];
  }
  return acc;
}

// the rod's ripples on the dome: rings running outward from the centre, fading toward its rim
float ripples(vec2 p) {
  if (uRipple.x <= 0.0 || uLens.x <= 0.0) return 0.0;
  float r = length(p - uLensCenter);
  float fade = 1.0 - smoothstep(0.0, uRipple.w * uLens.x, r);
  return uRipple.x * fade * sin(6.2831853 * r / uRipple.y - uRipple.z);
}

// The refracting surface: the oil, and the cover's top where it stands dry (the analytic top
// keeps its edge crisp at pixel scale; the smooth max is the meniscus). glass is 1 where the
// view enters glass rather than oil.
float surface(vec2 p, out float glass) {
  vec2 s = oil(p);
  float o = s.x;
  float c = uCoverOn > 0.5 ? coverTop(p) : -1e3;
  float k = uMeniscus;
  float h = clamp(0.5 + 0.5 * (c - o) / k, 0.0, 1.0);
  glass = c > -1e2 ? max(h, 1.0 - smoothstep(0.0, uFilm, s.y)) : 0.0;
  return mix(o, c, h) + k * h * (1.0 - h) + lensZ(p, uLens) + ripples(p);
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

// a dark studio: a key softbox left of the camera and a dim fill right; straight up is the camera
vec3 env(vec3 r) {
  if (r.z <= 0.0) return vec3(0.0);
  vec2 s = r.xy / max(r.z, 0.05);
  float key = 1.0 - smoothstep(0.0, 0.3, length(max(abs(s - vec2(-1.5, 0.1)) - vec2(0.25, 0.55), 0.0)));
  float fill = 1.0 - smoothstep(0.0, 0.4, length(max(abs(s - vec2(1.8, -0.2)) - vec2(0.2, 0.7), 0.0)));
  // the studio's walls, seen only at grazing angles: steep rims catch them as bright lines
  float horizon = uHorizon * smoothstep(1.2, 4.0, length(s));
  return vec3(0.95, 0.97, 1.0) * (uSoftbox * (key + 0.25 * fill) + horizon);
}

// the floor is lit only where the dome has reached (its footprint at the current size)
float revealAt(vec2 q) {
  if (uReveal < 0.5 || uLens.x <= 0.0) return 1.0;
  vec2 d = abs(q - uLensCenter) / uLens.x;
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
      float g0;
      if (zHit > surface(p, g0)) {
        vec3 N = normalize(vec3(d, zHit - uBall.z));
        vec3 R = reflect(V, N);
        // chrome: the studio, with the camera's dark silhouette straight up
        // polished steel: the softboxes as highlights, the studio's walls muted, the camera dark
        vec2 s = R.xy / max(R.z, 0.05);
        float walls = 0.35 * smoothstep(0.2, 3.0, length(s));
        vec3 col = 0.8 * (env(R) - vec3(uHorizon * smoothstep(1.2, 4.0, length(s)))) + walls + 0.08;
        col *= mix(1.0, 0.35, smoothstep(0.9, 0.995, R.z));
        outColor = vec4(col, 1.0);
        return;
      }
    }
  }

  float h = 0.35 * uDx;
  float glass;
  float z = surface(p, glass);
  float gtmp;
  float zx1 = surface(p + vec2(h, 0.0), gtmp), zx0 = surface(p - vec2(h, 0.0), gtmp);
  float zy1 = surface(p + vec2(0.0, h), gtmp), zy0 = surface(p - vec2(0.0, h), gtmp);
  vec2 grad = vec2(zx1 - zx0, zy1 - zy0) / (2.0 * h);
  // oil meets glass at its contact angle: no steeper than that, however sharp the modelled rim
  if (uMaxSlope > 0.0) grad *= min(1.0, uMaxSlope / max(length(grad), 1e-6));
  float curv = (zx1 + zx0 + zy1 + zy0 - 4.0 * z) / (h * h);
  vec3 N = normalize(vec3(-grad, 1.0));

  if (uDebug > 0 && uDebug < 4) {
    float v = uDebug == 1 ? z / uDebugScale : uDebug == 2 ? length(grad) / uDebugScale : glass;
    // height: blue below rest, red above, with contour lines every 1/10 of the scale
    vec3 c = uDebug == 1 ? (v > 0.0 ? vec3(1.0, 0.3, 0.1) : vec3(0.1, 0.4, 1.0)) * min(abs(v), 1.0) : vec3(min(v, 1.0));
    if (uDebug == 1) c += 0.25 * smoothstep(0.9, 1.0, abs(fract(v * 10.0) * 2.0 - 1.0));
    vec4 L = logoAt(p, 0.0);
    outColor = vec4(c + 0.15 * L.a, 1.0);
    return;
  }

  // the cover under the oil: its top is a second, weak interface (glass is a near match for oil)
  float top = uCoverOn > 0.5 ? coverTop(p) : -1e3;
  bool submerged = top > -1e2 && glass < 0.5;
  vec3 N2 = vec3(0.0, 0.0, 1.0);
  if (submerged) {
    float c1 = coverTop(p + vec2(h, 0.0)), c0 = coverTop(p - vec2(h, 0.0));
    float d1 = coverTop(p + vec2(0.0, h)), d0 = coverTop(p - vec2(0.0, h));
    if (c1 > -1e2 && c0 > -1e2 && d1 > -1e2 && d0 > -1e2)
      N2 = normalize(vec3(-(c1 - c0) / (2.0 * h), -(d1 - d0) / (2.0 * h), 1.0));
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
    float nOil = ior(uIorOil, lambda);
    float nTop = mix(nOil, ior(uIorGlass, lambda), glass);
    vec3 T = refract(V, N, 1.0 / nTop);
    vec2 q;
    if (submerged) {
      float down = max(z - top, 0.0);
      vec2 q1 = p + T.xy * down / max(-T.z, 1e-3);
      vec3 T2 = refract(T, N2, nOil / ior(uIorGlass, lambda));
      q = q1 + T2.xy * (top + uDepth) / max(-T2.z, 1e-3);
    } else {
      q = p + T.xy * (z + uDepth) / max(-T.z, 1e-3);
    }
    if (uDebug >= 4 && i == count / 2) {
      vec2 o = (q - p) / uDebugScale;
      outColor = uDebug == 4 ? vec4(vec3(length(o)), 1.0) : vec4(0.5 + 0.5 * o, submerged ? 1.0 : 0.0, 1.0);
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
  float nTop = mix(uIorOil, uIorGlass, glass);
  float r0 = pow((nTop - 1.0) / (nTop + 1.0), 2.0);
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
  c += uBloomAmount * texture(uBloom, vUv).rgb;
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVignette * dot(v, v);
  c *= uExposure * uFade;
  // a soft shoulder above 0.8 so blooming highlights roll off instead of clipping hard
  vec3 over = max(c - 0.8, 0.0);
  c = min(c, 0.8) + over / (1.0 + over / 0.2);
  vec3 s = toSrgb(clamp(c, 0.0, 1.0));
  s += uGrain * (hash(gl_FragCoord.xy + uSeed * 31.0) - 0.5);
  outColor = vec4(s, 1.0);
}
`
