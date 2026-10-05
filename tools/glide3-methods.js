'use strict';

// Glide 3 SDK stdcall arities. DLL-scoped names preserve Glide 2's existing
// undecorated entries; changed decorated signatures are independently named.
const methods = [
  ['grVertexLayout', 3], ['grCoordinateSpace', 1],
  ['grDrawVertexArray', 3], ['grDrawVertexArrayContiguous', 4],
  ['grGet', 3], ['grGetString', 1], ['grSelectContext', 1],
  ['grFinish', 0], ['grFlush', 0], ['grLoadGammaTable', 4],
  ['guGammaCorrectionRGB', 3], ['grViewport', 4], ['grDepthRange', 2],
  ['grQueryResolutions', 2], ['grTexDownloadTablePartial', 4],
  ['grGetProcAddress', 1], ['grEnable', 1], ['grDisable', 1],
  ['grLfbConstantDepth', 1], ['grGlideGetState', 1], ['grGlideSetState', 1],
  ['grGlideGetVertexLayout', 1], ['grGlideSetVertexLayout', 1],
  ['guFogGenerateExp2', 2], ['guFogGenerateLinear', 3], ['guFogTableIndexToW', 1],
];
const scoped = [
  ['grGlideInit', 0], ['grSstWinClose', 1],
  ['grTexDownloadTable', 2], ['grLfbWriteRegion', 9],
];
const entries = methods.flatMap(([name, nargs]) => [
  {name, nargs}, {name: `_${name}@${nargs * 4}`, nargs, handler: name},
]);
for (const [name, nargs] of scoped) {
  const handler = `glide3_${name}`;
  entries.push({name: handler, nargs, handler});
  if (name !== 'grGlideInit') entries.push({name: `_${name}@${nargs * 4}`, nargs, handler});
}
module.exports = {entries, methods, scoped};
