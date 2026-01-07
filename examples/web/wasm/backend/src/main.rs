mod glue;
mod screens;
mod utils;

use crate::{
    screens::{BridgeScreen, ErrorScreen, InitializeScreen, MainScreen, WaitingForNexusInitScreen},
    utils::FrameContext,
};
use macroquad::{text::load_ttf_font, window::Conf};

fn window_conf() -> Conf {
    Conf::default()
}

#[macroquad::main(window_conf)]
async fn main() {
    let font = load_ttf_font("./media/Roboto-Medium.ttf").await.unwrap();

    let mut ctx = FrameContext::default();
    ctx.text_font = Some(font);
    InitializeScreen::run(&mut ctx).await;
    let res = WaitingForNexusInitScreen::run(&mut ctx).await;
    if let Err(error) = res {
        ErrorScreen::run(&mut ctx, error).await;
    }

    loop {
        MainScreen::run(&mut ctx).await;
        let res = BridgeScreen::run(&mut ctx).await;
        if let Err(error) = res {
            ErrorScreen::run(&mut ctx, error).await;
        }
    }
}
