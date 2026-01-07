# WASM Bridge + Transfer Example

A **Rust + WebAssembly** implementation combining Macroquad for UI with Nexus SDK for cross-chain operations.

## 🎯 Purpose

This innovative example demonstrates:
- **Rust UI Framework**: Using Macroquad for rendering canvas-based interface
- **WebAssembly Integration**: Rust-to-TypeScript communication via WASM
- **Cross-chain Operations**: Complete bridge + transfer functionality
- **Performance Optimization**: Native-speed UI with JavaScript SDK integration

## 📋 Prerequisites

### Development Environment

- **Node.js 18+** and npm
- **Rust Toolchain** (stable) with `wasm32-unknown-unknown` target
- **EIP-1193 Wallet** (MetaMask, Rabby, Rainbow) with testnet USDC
- **Browser Extension**: Wallet extension installed and enabled

### Rust Setup

```bash
# Install Rust if not already installed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install additional tools
cargo install wasm-bindgen-cli
```

## 🚀 Quick Start

### 1. Build WebAssembly

From `examples/web/wasm` root directory:

```bash
# Compile Rust to WebAssembly
./build.sh
```

This script:
- Compiles Rust backend to WASM
- Generates JavaScript bindings
- Copies artifacts to `frontend/build/`
- Optimizes WASM for web deployment

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
```

### 3. Run Development Server

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 4. Connect Wallet & Bridge

1. **Launch Interface**: Rust-based UI will render in browser
2. **Connect Wallet**: Click "Connect" and approve wallet access
3. **Execute Bridge + Transfer**: Use UI to initiate cross-chain operation
4. **Monitor Progress**: Watch real-time updates in Rust interface

## 🏗️ Architecture Overview

```
examples/web/wasm/
├── backend/                    # Rust UI implementation
│   ├── src/
│   │   ├── main.rs           # Macroquad application entry
│   │   ├── screens/          # UI screens and state
│   │   ├── utils/            # Helper utilities
│   │   └── glue/            # Rust-WASM integration
│   ├── Cargo.toml            # Rust dependencies
│   └── build_release.sh      # Rust compilation script
├── frontend/                  # TypeScript SDK integration
│   ├── src/
│   │   ├── main.ts          # Frontend entry point
│   │   ├── nexus.ts         # Nexus SDK logic
│   │   ├── glue/           # TypeScript-Rust bindings
│   │   └── gl.js           # WebAssembly loader
│   ├── package.json         # Node.js dependencies
│   └── build/             # Generated WASM artifacts
├── build.sh                 # Combined build script
└── README.md              # This documentation
```

## 🔧 Technical Implementation

### Rust Backend (Macroquad)

#### UI Framework
```rust
// backend/src/main.rs
use macroquad::prelude::*;

#[macroquad::main(window_conf)]
async fn main() {
    let font = load_ttf_font("./media/Roboto-Medium.ttf").await.unwrap();
    let mut ctx = FrameContext::default();
    ctx.text_font = Some(font);
    
    // Initialize screen flow
    InitializeScreen::run(&mut ctx).await;
    WaitingForNexusInitScreen::run(&mut ctx).await;
    
    // Main application loop
    loop {
        MainScreen::run(&mut ctx).await;
        let res = BridgeScreen::run(&mut ctx).await;
        if let Err(error) = res {
            ErrorScreen::run(&mut ctx, error).await;
        }
    }
}
```

#### Screen Management
- **InitializeScreen**: Loading and initialization
- **WaitingForNexusInitScreen**: SDK connection status
- **MainScreen**: Main dashboard with wallet info
- **BridgeScreen**: Bridge + transfer interface
- **ErrorScreen**: Error display and recovery

### TypeScript Glue Layer

#### WebAssembly Bindings
```typescript
// frontend/src/glue/js.ts
import { initSync } from '../../build/program.wasm';

// Export functions to Rust
export function initialize_glue() {
    const wasm = initSync();
    return wasm;
}

// Rust calls these functions
export function rust_log_message(message: string) {
    console.log('[RUST]:', message);
}

export function update_progress(step: number, description: string) {
    // Update Rust UI with progress
    if (window.updateRustUI) {
        window.updateRustUI(step, description);
    }
}
```

#### SDK Integration
```typescript
// frontend/src/nexus.ts
import { NexusSDK } from '@avail-project/nexus-core';

export async function initializeNexus() {
    if (!window.ethereum) {
        throw new Error('No wallet available');
    }
    
    const sdk = new NexusSDK({ network: 'testnet' });
    await sdk.initialize(window.ethereum);
    
    // Store SDK for Rust to use
    window.nexusSDK = sdk;
    
    return 'SDK initialized';
}

export async function initiateBridgeAndTransfer(params: BridgeTransferParams) {
    const sdk = window.nexusSDK;
    
    try {
        const result = await sdk.bridgeAndTransfer({
            token: 'USDC',
            amount: params.amount,
            toChainId: 421614, // Arbitrum Sepolia
            recipient: params.recipient
        }, {
            onEvent: (event) => {
                // Send progress to Rust UI
                window.updateRustUI(event.step, event.description);
            }
        });
        
        return { success: true, result };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
```

### Communication Flow

1. **Rust → TypeScript**: Via WebAssembly function calls
2. **TypeScript → Rust**: Through exported callback functions
3. **Event Streaming**: Real-time progress updates
4. **State Synchronization**: Consistent UI state across languages

## 🎨 UI Features

### Rust Canvas Interface

#### Visual Elements
- **Custom Font**: Roboto-Medium.ttf for consistent typography
- **Canvas Rendering**: Hardware-accelerated graphics
- **Responsive Design**: Adapts to window size
- **Smooth Animations**: 60 FPS rendering

#### Interactive Components
- **Button States**: Hover, click, and disabled styling
- **Input Fields**: Text entry for amounts and addresses
- **Progress Indicators**: Visual feedback for operations
- **Error Display**: Clear error messaging

#### Screen Navigation
```
Initialization → Wallet Connect → Main Dashboard → Bridge/Transfer → Success/Error
     ↑                                                            ↓
                           ←←←← Return to Main ←←←←
```

## 🔧 Customization

### Modify Rust UI

Edit files in `backend/src/`:

#### Screen Components
```rust
// backend/src/screens/main_screen.rs
impl MainScreen {
    pub async fn run(ctx: &mut FrameContext) -> Result<(), String> {
        loop {
            // Custom main screen logic
            if is_button_clicked(ctx.wallet_button) {
                // Handle wallet connection
            }
            
            if is_button_clicked(ctx.bridge_button) {
                // Navigate to bridge screen
                return BridgeScreen::run(ctx).await;
            }
            
            render_frame(ctx).await;
        }
    }
}
```

#### Visual Styling
```rust
// backend/src/utils/colors.rs
pub const THEME_COLORS: ThemeColors = ThemeColors {
    primary: Color::from_rgba(59, 130, 246, 1.0),   // Blue
    secondary: Color::from_rgba(34, 197, 94, 1.0),   // Green
    background: Color::from_rgba(17, 24, 39, 1.0),   // Dark blue
    text: Color::from_rgba(255, 255, 255, 1.0),      // White
    error: Color::from_rgba(239, 68, 68, 1.0),       // Red
};
```

### Modify Bridge Parameters

Edit `frontend/src/nexus.ts`:

```typescript
export const bridgeParams = {
    token: 'USDC',                           // Token to bridge
    defaultAmount: 1000000n,                 // Default 1 USDC
    toChainId: 421614,                       // Arbitrum Sepolia
    recipient: '',                             // User-specified
    sourceChains: [11155111, 84532]         // Optional source chains
};
```

### Add New Operations

```typescript
// Add swap functionality
export async function initiateSwap(params: SwapParams) {
    const sdk = window.nexusSDK;
    
    const result = await sdk.swapWithExactIn({
        from: params.from,
        toChainId: params.toChainId,
        toTokenAddress: params.toTokenAddress
    }, {
        onEvent: (event) => window.updateRustUI(event.step, event.description)
    });
    
    return result;
}

// Export to Rust
window.initiateSwap = initiateSwap;
```

## 🛠️ Build Process

### Development Build

```bash
# Quick development build
./build.sh dev

# Features:
# - Faster compilation
# - Debug symbols included
# - No WASM optimization
# - Source maps enabled
```

### Production Build

```bash
# Optimized production build
./build.sh release

# Features:
# - WASM size optimization
# - Code minification
# - Dead code elimination
# - Performance optimizations
```

### Build Script Details

```bash
#!/bin/bash
# build.sh

cd backend

# Compile Rust to WASM
cargo build --target wasm32-unknown-unknown --release

# Generate JavaScript bindings
wasm-bindgen target/wasm32-unknown-unknown/release/backend.wasm \
    --out-dir ../frontend/build \
    --web \
    --no-typescript

# Copy optimized WASM
cp target/wasm32-unknown-unknown/release/backend.wasm ../frontend/build/program.wasm

# Copy additional assets
cp -r media ../frontend/build/

echo "✅ WASM build completed successfully!"
```

## 🐛 Troubleshooting

### Common Build Issues

| Error | Cause | Solution |
|-------|--------|----------|
| **wasm32-unknown-unknown not found** | Missing Rust target | Run `rustup target add wasm32-unknown-unknown` |
| **wasm-bindgen command not found** | Missing tool | Run `cargo install wasm-bindgen-cli` |
| **Font loading failed** | Missing font file | Ensure Roboto-Medium.ttf exists in media/ |
| **WASM too large** | Debug build in production | Use `--release` flag for production builds |

### Runtime Issues

| Problem | Cause | Solution |
|---------|--------|----------|
| **Wallet not detected** | No wallet extension | Install MetaMask or compatible wallet |
| **SDK initialization fails** | Network mismatch | Switch wallet to testnet network |
| **Bridge operation fails** | Insufficient funds | Fund wallet with testnet tokens |
| **UI not responsive** | Rust panic/error | Check browser console for error details |

### Debug Mode

```bash
# Enable verbose logging
RUST_LOG=debug npm run dev

# Build with debug info
./build.sh dev

# Monitor browser console for Rust logs
console.log('[RUST]:', ...); // Rust logs appear here
```

## 📚 Advanced Features

### Custom Rendering

```rust
// Add custom rendering effects
impl FrameContext {
    pub fn draw_gradient_background(&self) {
        for y in 0..screen_height() {
            let color = lerp(
                THEME_COLORS.background,
                THEME_COLORS.primary,
                y as f32 / screen_height() as f32
            );
            draw_rectangle(0, y, screen_width(), 1, color);
        }
    }
}
```

### State Management

```rust
// Add persistent state
#[derive(Clone, Serialize, Deserialize)]
pub struct AppState {
    pub wallet_connected: bool,
    pub last_operation: Option<OperationResult>,
    pub preferences: UserPreferences,
}

// Save/load state
impl AppState {
    pub fn save_to_local_storage(&self) {
        let json = serde_json::to_string(self).unwrap();
        save_to_browser_storage("app_state", &json);
    }
    
    pub fn load_from_local_storage() -> Self {
        if let Some(json) = load_from_browser_storage("app_state") {
            serde_json::from_str(&json).unwrap_or_default()
        } else {
            Self::default()
        }
    }
}
```

### Multi-Language Support

```rust
// Add internationalization
pub struct LocalizedText {
    pub connect_wallet: String,
    pub bridge_transfer: String,
    pub amount: String,
    pub recipient: String,
}

impl LocalizedText {
    pub fn new(locale: &str) -> Self {
        match locale {
            "en" => Self::english(),
            "es" => Self::spanish(),
            "fr" => Self::french(),
            _ => Self::english(),
        }
    }
}
```

## 📖 Related Examples

- **[Bridge + Transfer](../bridge-and-transfer/)** - Pure TypeScript implementation
- **[Swap Examples](../swap-with-exact-in/)** - JavaScript-based swapping
- **[Node.js Examples](../../node/)** - Backend implementations
- **[Simple Bridge](../bridge/)** - Basic web interface

## 🚀 Deployment

### Static Hosting

```bash
# Build for production
./build.sh release

# Deploy to any static host
rsync -av frontend/dist/ user@server:/var/www/wasm-example/

# Configure server to serve WASM with correct MIME type
# application/wasm for .wasm files
```

### CDN Optimization

```html
<!-- Add to frontend/index.html -->
<script>
    // Preload WASM for faster loading
    const wasmModule = new WebAssembly.Module(fetch('./build/program.wasm'));
    
    // Stream compilation for better performance
    WebAssembly.instantiateStreaming(wasmModule)
        .then(instance => {
            // Initialize application
            initialize_glue();
        });
</script>
```

---

**💡 Pro Tip**: This WASM example demonstrates the power of combining Rust's performance with JavaScript's web ecosystem. The Macroquad framework provides smooth 60 FPS graphics while the Nexus SDK handles complex cross-chain logic, creating a unique high-performance DeFi application.