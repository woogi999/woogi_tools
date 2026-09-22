// The shader pass: where the effects CSS cannot express get rendered.
//
// Ferrite implements its effects twice. The real one is WGSL, in
// `ferrite-gpu/src/shaders.rs`; the CSS fragment each effect also emits was
// only ever the fallback for its browser-document output, and for anything CSS
// has no word for — a twirl, a chroma key, a kaleidoscope — that fallback is
// an identity value like `blur(0px)`. We translated the catalogue faithfully
// and so inherited sixty-odd effects that politely do nothing.
//
// This is the other half: a WebGL2 context that takes a layer's surface, runs
// the real shader over it, and hands the surface back. The compositor stays in
// charge — this never sees the scene, only one layer's pixels at a time.
//
// Two rules it must keep:
//
//   * If WebGL2 is not available, say so and leave the CSS fallback in place.
//     A graphic that quietly renders differently is Ferrite's whole complaint
//     about the browser output it replaced.
//   * Textures are premultiplied, as the rest of the pipeline is. Shaders that
//     need straight alpha unpremultiply explicitly, the way the WGSL does.

import { SHADERS, COMMON } from './shaders.js';

const VERTEX = `#version 300 es
// One triangle covering the viewport: cheaper than a quad and has no seam
// down the diagonal where two triangles meet.
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColour;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec4 uParams[6];
uniform vec4 uColours[4];
uniform float uTime;
`;

let gl = null;
let surface = null;
let unavailable = false;
const programs = new Map();
// Two textures to ping-pong between, so a stack of shader effects chains
// without allocating a target per pass.
let targets = [];

function context() {
  if (gl || unavailable) return gl;
  try {
    surface = document.createElement('canvas');
    gl = surface.getContext('webgl2', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) unavailable = true;
  } catch {
    unavailable = true;
    gl = null;
  }
  return gl;
}

export const hasGpu = () => Boolean(context());

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || 'shader would not compile');
  }
  return shader;
}

// A program per effect, built once. A failure is remembered as `null` so a
// broken shader is not recompiled sixty times a second.
function programFor(name) {
  if (programs.has(name)) return programs.get(name);
  let program = null;
  try {
    const body = SHADERS[name];
    if (!body) throw new Error(`no shader called "${name}"`);
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, HEAD + COMMON + body);
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(log || 'program would not link');
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    program = {
      program,
      uTex: gl.getUniformLocation(program, 'uTex'),
      uSize: gl.getUniformLocation(program, 'uSize'),
      uParams: gl.getUniformLocation(program, 'uParams'),
      uColours: gl.getUniformLocation(program, 'uColours'),
      uTime: gl.getUniformLocation(program, 'uTime'),
    };
  } catch (error) {
    programs.set(name, null);
    throw error;
  }
  programs.set(name, program);
  return program;
}

function makeTarget(width, height) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  // Clamped and linear: a warp that reaches past the edge is given
  // transparency by the shader, never a smeared edge pixel.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Minified through a mip chain, because the blurs read from one. A tap that
  // has to cover a four-pixel gap reads a level whose texels are four pixels
  // wide, and gets an average of the gap rather than a ghost of one pixel in
  // it. See `lodFor` in the shader common.
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  const buffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  return { texture, buffer, width, height };
}

function targetsFor(width, height) {
  if (
    targets.length &&
    targets[0].width === width &&
    targets[0].height === height
  )
    return targets;
  for (const t of targets) {
    gl.deleteTexture(t.texture);
    gl.deleteFramebuffer(t.buffer);
  }
  targets = [makeTarget(width, height), makeTarget(width, height)];
  return targets;
}

/**
 * Runs a stack of shader passes over a layer's surface.
 *
 * `source` is the canvas the layer was painted into; the result is drawn back
 * onto it, so the caller's surface is the same object afterwards and nothing
 * downstream has to know a shader ran.
 *
 * Returns true if the passes ran, false if they could not — in which case the
 * surface is untouched and the caller should keep whatever the CSS fallback
 * gave it.
 */
export function runPasses(source, passes, onError) {
  if (!passes.length) return false;
  const context2d = context();
  if (!context2d) {
    onError?.('This browser has no WebGL2, so shader effects are skipped.');
    return false;
  }
  const width = Math.max(1, source.width);
  const height = Math.max(1, source.height);

  try {
    if (surface.width !== width || surface.height !== height) {
      surface.width = width;
      surface.height = height;
    }
    const pair = targetsFor(width, height);

    // The layer's pixels, as they came off the 2D canvas. Premultiplied, which
    // is what the rest of the pipeline holds, so the unpack is told to leave
    // them that way rather than dividing the alpha back out.
    const input = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);

    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);

    let read = input;
    let wrote = null;
    let ran = 0;

    for (const pass of passes) {
      let program;
      try {
        program = programFor(pass.shader);
      } catch (error) {
        onError?.(`${pass.shader}: ${error.message}`);
        continue;
      }
      const target = pair[ran % 2];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read);
      gl.uniform1i(program.uTex, 0);
      gl.uniform2f(program.uSize, width, height);
      gl.uniform4fv(program.uParams, pass.params);
      gl.uniform4fv(program.uColours, pass.colours);
      gl.uniform1f(program.uTime, pass.timeMs ?? 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // The pass just written becomes the next pass's input, so its mip chain
      // has to be rebuilt or a blur later in the stack reads stale levels.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.generateMipmap(gl.TEXTURE_2D);

      read = target.texture;
      wrote = target;
      ran += 1;
    }

    if (!ran) {
      gl.deleteTexture(input);
      return false;
    }

    // The last target back onto the drawing buffer, so the canvas can be
    // drawn into the 2D surface it came from.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, wrote.buffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Flipped on the way out, and only here.
    //
    // A 2D canvas counts rows from the top; GL counts them from the bottom.
    // Everything inside this pipeline agrees with the texture it was uploaded
    // from — `vUv` is image space, so a shader that reaches "down" reaches the
    // way the picture looks — and a stack of passes stays consistent. The
    // mismatch is only at the handover, so it is resolved once, by reading the
    // source rectangle bottom to top.
    gl.blitFramebuffer(
      0,
      height,
      width,
      0,
      0,
      0,
      width,
      height,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteTexture(input);

    const ctx = source.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.drawImage(surface, 0, 0);
    ctx.restore();
    return true;
  } catch (error) {
    onError?.(error.message ?? 'the shader pass failed');
    return false;
  }
}

// Torn down with the editor: a WebGL context is a real resource and browsers
// only allow a handful at once.
export function releaseGpu() {
  if (!gl) return;
  for (const t of targets) {
    gl.deleteTexture(t.texture);
    gl.deleteFramebuffer(t.buffer);
  }
  for (const p of programs.values()) if (p) gl.deleteProgram(p.program);
  targets = [];
  programs.clear();
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  gl = null;
  surface = null;
  unavailable = false;
}
