use macroquad::{
    color::WHITE,
    math::vec2,
    window::{clear_background, next_frame},
};

use crate::{
    FrameContext,
    glue::{
        self,
        rust::{MessageFromJs, read_new_js_messages},
    },
    utils::{
        elements::{CustomButton, CustomText},
        layout::{ElementLayout, vertically_center_elements},
    },
};

pub struct InitializeScreen;
impl InitializeScreen {
    pub async fn run(ctx: &mut FrameContext) {
        loop {
            clear_background(WHITE);
            ctx.update();

            // Draw button and Text :)
            let text = "Initialize Nexus Button. Click Me :)";
            let mut btn = CustomButton::new(text).dim(vec2(600.0, 100.0));
            btn.style.font_size = Some(32);
            btn.style.font = ctx.text_font.clone();
            btn.horizontally_center(0.0, ctx.screen_dim.x);
            btn.vertically_center(0.0, ctx.screen_dim.y);

            let clicked = btn.draw(ctx);
            if clicked {
                return;
            }
            next_frame().await
        }
    }
}

pub struct WaitingForNexusInitScreen;
impl WaitingForNexusInitScreen {
    pub async fn run(ctx: &mut FrameContext) -> Result<(), String> {
        // Call Initialize Nexus on JS side
        unsafe {
            glue::js::initialize_nexus();
        }

        let mut rotation = 0f32;
        let mut tick = 0;
        loop {
            clear_background(WHITE);
            ctx.update();

            // Read JS messages
            let js_messages = read_messages(&mut tick);
            for message in js_messages {
                match message {
                    MessageFromJs::NexusInitializationFailed(reason) => return Err(reason),
                    MessageFromJs::NexusInitializationSucceeded => return Ok(()),
                    _ => (),
                }
            }

            // Draw button and Text :)
            let mut p = CustomText::new("Waiting for Nexus. :spinner:").font_size(32);
            p.font = ctx.text_font.clone();
            p.rotation = rotation;
            p.horizontally_center(0.0, ctx.screen_dim.x);
            p.vertically_center(0.0, ctx.screen_dim.y);

            p.draw();
            rotation += 0.001;

            next_frame().await
        }
    }
}

pub struct MainScreen;
impl MainScreen {
    pub async fn run(ctx: &mut FrameContext) {
        loop {
            clear_background(WHITE);
            ctx.update();

            // Draw button and Text :)
            let text = "Current Account Address: 0x198866cD002F9e5E2b49DE96d68EaE9d32aD0000";
            let mut p1 = CustomText::new(text).font_size(32);
            p1.font = ctx.text_font.clone();

            let text = "Current Account Unified Balance: 100 USDC";
            let mut p2 = CustomText::new(text).font_size(32);
            p2.font = ctx.text_font.clone();

            let text = "Bridge and Transfer 0.01 USDC to that address";
            let mut btn = CustomButton::new(text).dim(vec2(500.0, 100.0));
            btn.style.font_size = Some(22);
            btn.style.font = ctx.text_font.clone();
            btn.style.thickness = Some(4.0);

            p1.horizontally_center(0.0, ctx.screen_dim.x);
            p2.horizontally_center(0.0, ctx.screen_dim.x);
            btn.horizontally_center(0.0, ctx.screen_dim.x);

            vertically_center_elements(
                0.0,
                ctx.screen_dim.y,
                25.0,
                &mut [&mut p1, &mut p2, &mut btn],
            );

            p1.draw();
            p2.draw();
            let clicked = btn.draw(&ctx);
            if clicked {
                return;
            }

            next_frame().await
        }
    }
}

pub struct BridgeScreen;
impl BridgeScreen {
    pub async fn run(ctx: &mut FrameContext) -> Result<(), String> {
        // Call Initiate Bridge And Transfer on JS side
        unsafe {
            glue::js::initiate_bridge_and_transfer();
        }

        let mut tick = 0;
        let mut text = String::from("Waiting...");
        loop {
            clear_background(WHITE);
            ctx.update();

            // Read JS messages
            let js_messages = read_messages(&mut tick);
            for message in js_messages {
                match message {
                    MessageFromJs::BridgingStep(reason) => {
                        text = reason;
                    }
                    MessageFromJs::BridgingFailed(reason) => return Err(reason),
                    MessageFromJs::BridgingSucceed => return Ok(()),
                    _ => (),
                }
            }

            // Draw button and Text :)
            let mut p = CustomText::new(text.as_str()).font_size(32);
            p.font = ctx.text_font.clone();
            p.horizontally_center(0.0, ctx.screen_dim.x);
            p.vertically_center(0.0, ctx.screen_dim.y);

            p.draw();

            next_frame().await
        }
    }
}

pub struct ErrorScreen;
impl ErrorScreen {
    pub async fn run(ctx: &mut FrameContext, error: String) {
        loop {
            clear_background(WHITE);
            ctx.update();

            // Draw button and Text :)
            let mut font_size = 32;
            if error.len() > 50 {
                font_size = 20;
            }
            let mut p = CustomText::new(error.as_str()).font_size(font_size);
            p.font = ctx.text_font.clone();
            p.horizontally_center(0.0, ctx.screen_dim.x);
            p.vertically_center(0.0, ctx.screen_dim.y);

            p.draw();
            next_frame().await
        }
    }
}

// Read js messages every 200 ticks for performances purposes
pub fn read_messages(tick: &mut u32) -> Vec<MessageFromJs> {
    if *tick < 200 {
        *tick += 1;
        return Vec::new();
    }
    *tick = 0;
    return read_new_js_messages();
}
