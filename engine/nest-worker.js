// Web Worker that runs the WASM bin-packing engine off the main thread, so the
// UI stays responsive (the loading spinner keeps spinning) during a solve.
import init, { run_lbf_bpp } from './nestasm.js';

let ready = false;
async function ensure(){ if(!ready){ await init(); ready = true; } }

// Signal readiness once the wasm is initialised.
ensure()
  .then(() => self.postMessage({ type: 'ready' }))
  .catch((e) => self.postMessage({ type: 'error', msg: 'init: ' + ((e && e.message) || e) }));

self.onmessage = async (e) => {
  const d = e.data;
  if (!d || d.type !== 'solve') return;
  try {
    await ensure();
    // run_lbf_bpp(instanceJSON, seed, min_separation) -> ExtBPSolution JSON string
    const json = run_lbf_bpp(d.inst, BigInt(1), d.kerf);
    self.postMessage({ type: 'result', json });
  } catch (err) {
    self.postMessage({ type: 'error', msg: String((err && err.message) || err) });
  }
};
