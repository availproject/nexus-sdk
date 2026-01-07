declare var wasm_exports: any;

declare var js_object: any;

export class Rust {
  static nexusInitializationFailed(reason: string) {
    wasm_exports.nexus_initialization_failed(js_object(reason));
  }
  static nexusInitializationSucceed() {
    wasm_exports.nexus_initialization_succeeded();
  }
  static bridgingFailed(reason: string) {
    wasm_exports.bridging_failed(js_object(reason));
  }
  static bridgingStep(step: string) {
    wasm_exports.bridging_step(js_object(step));
  }
  static bridgingSucceed() {
    wasm_exports.bridging_succeed();
  }
}
