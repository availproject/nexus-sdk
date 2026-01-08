cd backend
./build_release.sh
cd ..

cd frontend
mkdir -p build
cp ../backend/build/release.wasm ./build/program.wasm
