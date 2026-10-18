// Runs the nec2c engine off the main page so the screen never freezes.
// Receives { id, deck } (NEC input text), replies { id, text } (NEC output text) or { id, error }.
importScripts('nec2c.js');

const wasmModule = WebAssembly.compileStreaming(fetch('nec2c.wasm'));

onmessage = async (e) => {
  const { id, deck } = e.data;
  try {
    const compiled = await wasmModule;
    // a fresh engine per run, so no state carries over between calculations
    const nec = await createNec2c({
      instantiateWasm: (imports, done) => {
        WebAssembly.instantiate(compiled, imports).then((instance) => done(instance));
        return {};
      },
      print: () => {},
      printErr: () => {},
    });
    nec.FS.writeFile('/in.nec', deck);
    try {
      nec.callMain(['-i', '/in.nec', '-o', '/out.txt']);
    } catch (exit) {
      // nec2c ends by calling exit(); the output file is already written
    }
    const text = nec.FS.readFile('/out.txt', { encoding: 'utf8' });
    postMessage({ id, text });
  } catch (err) {
    postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
