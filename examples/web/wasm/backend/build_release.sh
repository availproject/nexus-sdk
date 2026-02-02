rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
mkdir -p build
cp ./target/wasm32-unknown-unknown/release/backend.wasm ./build/release.wasm
