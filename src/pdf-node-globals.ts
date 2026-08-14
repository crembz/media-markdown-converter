// Browser globals pdfjs expects, backed by @napi-rs/canvas.
//
// This lives in its own module purely for ordering: ES imports are evaluated
// before any statement in the importing file, so assigning these at the top of
// pdf-node.ts still ran *after* pdfjs had been evaluated. By then pdfjs's
// legacy build has already installed its own Path2D polyfill, and the paths it
// produces are not the ones @napi-rs/canvas accepts — rendering then dies with
// "Value is none of these types `String`, `Path`".
//
// pdf-node.ts imports this module before pdfjs so the real implementations are
// in place first. Keep that import first.
import { DOMMatrix, Path2D } from '@napi-rs/canvas';

const globals = globalThis as unknown as Record<string, unknown>;

if (typeof globals.Path2D === 'undefined') globals.Path2D = Path2D;
if (typeof globals.DOMMatrix === 'undefined') globals.DOMMatrix = DOMMatrix;
