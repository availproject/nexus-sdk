import { initializeGlue } from './glue/js';

function main() {
  initializeGlue();
  (window as any).glue_js_loaded = true;
}

main();
