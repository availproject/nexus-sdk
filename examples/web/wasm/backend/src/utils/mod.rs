pub mod elements;
pub mod layout;

use macroquad::{
    input::mouse_position,
    math::Vec2,
    text::Font,
    window::{self},
};

#[derive(Default)]
pub struct FrameContext {
    pub mouse_pos: Vec2,
    pub screen_dim: Vec2,
    pub let_mouse_button_released: bool,
    pub text_font: Option<Font>,
}

impl FrameContext {
    pub fn update(&mut self) {
        self.mouse_pos = mouse_position().into();
        self.screen_dim = (window::screen_width(), window::screen_height()).into();
        self.let_mouse_button_released =
            macroquad::input::is_mouse_button_released(window::miniquad::MouseButton::Left);
    }
}
