rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown
mkdir -p build
cp ./target/wasm32-unknown-unknown/debug/backend.wasm ./build/debug.wasm
