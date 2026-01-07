import { initializeNexus, bridge } from '../nexus';

class JS {
  static initializeNexus(js_object: any) {
    initializeNexus();
  }
  static initiateBridgeAndTransfer(js_object: any) {
    bridge();
  }

  static initialize_macroquad_plugin() {
    // Register plugins
    const register_plugin = function (importObject: any) {
      var importObject: any;
      importObject.env.initialize_nexus = JS.initializeNexus;
      importObject.env.initiate_bridge_and_transfer = JS.initiateBridgeAndTransfer;
    };
    function on_init() {}
    (window as any).miniquad_add_plugin({ register_plugin, on_init });
  }
}

export function initializeGlue() {
  JS.initialize_macroquad_plugin();
}
