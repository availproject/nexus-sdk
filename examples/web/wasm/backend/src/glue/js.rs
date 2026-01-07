/*
    Wasm/Rust -> JS Glue
*/

unsafe extern "C" {
    pub fn initialize_nexus();
    pub fn initiate_bridge_and_transfer();
}
