// Everything 3D Studio's page loads on demand, in one chunk (with three.js).
export * as mesh from './mesh';
export * as uv from './uv';
export * as rig from './rig';
export * as anim from './anim';
export * as tex from './texture';
export * as paint from './paint';
export * as sculpt from './sculpt';
export * as docs from './doc';
export * as project from './project';
export { PRIMITIVES, buildPrimitive } from './primitives';
export { MODIFIERS, MODIFIER_ORDER, newModifier } from './modifiers';
export { Evaluator, transformMesh } from './evaluate';
export { TextureEngine } from './textures';
export { BAKERS } from './bake';
export { EXPORTERS } from './export';
export { mountView } from './view';
export { importModel } from './import';
export { CONTROL_SHAPES } from './scene-build';
