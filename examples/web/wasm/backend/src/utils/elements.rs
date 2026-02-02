use macroquad::{
    color::{BLACK, Color, DARKGRAY, GREEN},
    math::{Vec2, vec2},
    prelude::info,
    shapes::{draw_rectangle, draw_rectangle_lines},
    text::{Font, TextDimensions, TextParams, draw_text_ex},
};

use crate::{FrameContext, utils::layout::ElementLayout};

#[derive(Default)]
pub struct CustomText {
    pub text: String,
    pub pos: Vec2,
    pub font: Option<Font>,
    pub font_size: Option<u16>,
    pub left_margin: Option<f32>,
    pub rotation: f32,
}

impl CustomText {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Default::default()
        }
    }

    pub fn pos(mut self, value: Vec2) -> Self {
        self.pos = value;
        self
    }

    pub fn font(mut self, value: Font) -> Self {
        self.font = Some(value);
        self
    }

    pub fn font_size(mut self, value: u16) -> Self {
        self.font_size = Some(value);
        self
    }

    pub fn draw(&self) {
        // Draw at the position
        let pos = self.pos + vec2(self.left_margin.unwrap_or_default(), 0.0);
        let font_size = self.actual_font_size();

        let mut text_params = TextParams::default();
        text_params.font = self.font.as_ref();
        text_params.color = BLACK;
        text_params.font_size = font_size;
        text_params.rotation = self.rotation;
        draw_text_ex(&self.text, pos.x, pos.y, text_params);
    }

    fn actual_font_size(&self) -> u16 {
        self.font_size.unwrap_or(16)
    }

    fn actual_dim(&self) -> TextDimensions {
        macroquad::text::measure_text(&self.text, self.font.as_ref(), self.actual_font_size(), 1.0)
    }
}

impl ElementLayout for CustomText {
    fn layout_dim(&self) -> Vec2 {
        let dim = self.actual_dim();
        vec2(dim.width, dim.height)
    }

    fn layout_pos(&self) -> Vec2 {
        self.pos
    }

    fn layout_set_pos(&mut self, value: Vec2) {
        self.pos = value
    }

    fn text_height(&self) -> Option<f32> {
        let dim = self.actual_dim();
        Some(dim.offset_y)
    }
}

#[derive(Default)]
pub struct ButtonStyle {
    pub bg_color: Option<Color>,
    pub font: Option<Font>,
    pub font_size: Option<u16>,
    pub disabled: bool,
    pub thickness: Option<f32>,
}

#[derive(Default)]
pub struct CustomButton {
    pub pos: Vec2,
    pub dim: Option<Vec2>,
    pub text: String,
    pub style: ButtonStyle,
}
impl CustomButton {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Default::default()
        }
    }

    pub fn bg_color(mut self, value: Color) -> Self {
        self.style.bg_color = Some(value);
        self
    }

    pub fn pos(mut self, value: Vec2) -> Self {
        self.pos = value;
        self
    }

    pub fn font(mut self, value: Font) -> Self {
        self.style.font = Some(value);
        self
    }

    pub fn dim(mut self, value: Vec2) -> Self {
        self.dim = Some(value);
        self
    }

    pub fn font_size(mut self, value: u16) -> Self {
        self.style.font_size = Some(value);
        self
    }

    // True if the button was clicked.
    pub fn draw(&self, ctx: &FrameContext) -> bool {
        // Draw at the position
        let pos = self.pos;
        let dim = self.actual_dim();

        let mouse_intersect = self.intersect_point(ctx.mouse_pos);

        // Draw Button Background
        let mut color = BLACK;
        let mut thickness = self.style.thickness.unwrap_or(2.0);
        if mouse_intersect {
            color = GREEN;
            thickness = 6.0;
        }
        if self.style.disabled {
            draw_rectangle(pos.x, pos.y, dim.x, dim.y, DARKGRAY);
        } else {
            draw_rectangle_lines(pos.x, pos.y, dim.x, dim.y, thickness, color);
        }

        let mut text =
            CustomText::new(self.text.clone()).font_size(self.style.font_size.unwrap_or(16));
        text.font = self.style.font.clone();
        text.vertically_center(pos.y, dim.y);
        text.horizontally_center(pos.x, dim.x);

        text.draw();

        mouse_intersect && ctx.let_mouse_button_released && !self.style.disabled
    }

    fn actual_dim(&self) -> Vec2 {
        self.dim.unwrap_or_else(|| vec2(150.0, 100.0))
    }
}

impl ElementLayout for CustomButton {
    fn layout_dim(&self) -> Vec2 {
        self.actual_dim()
    }

    fn layout_pos(&self) -> Vec2 {
        self.pos
    }

    fn layout_set_pos(&mut self, value: Vec2) {
        self.pos = value
    }
}

pub struct PhantomDiv<'a> {
    pub elements: &'a mut [&'a mut dyn ElementLayout],
}

impl<'a> ElementLayout for PhantomDiv<'a> {
    fn layout_dim(&self) -> Vec2 {
        // Find top left and bottom right
        let mut top_left = vec2(f32::MAX, f32::MAX);
        let mut bottom_right = vec2(f32::MIN, f32::MIN);

        for e in self.elements.iter() {
            let pos = e.layout_pos();
            top_left.x = top_left.x.min(pos.x);
            top_left.y = top_left.y.min(pos.y);

            let dim = pos + e.layout_dim();
            bottom_right.x = bottom_right.x.max(dim.x);
            bottom_right.y = bottom_right.y.max(dim.y);
        }
        assert!(bottom_right.x >= top_left.x);
        assert!(bottom_right.y >= top_left.y);

        bottom_right - top_left
    }

    fn layout_pos(&self) -> Vec2 {
        let mut top_left = vec2(f32::MAX, f32::MAX);
        for e in self.elements.iter() {
            let pos = e.layout_pos();
            top_left.x = top_left.x.min(pos.x);
            top_left.y = top_left.y.min(pos.y);
        }
        top_left
    }

    fn layout_set_pos(&mut self, value: Vec2) {
        let current_pos = self.layout_pos();
        let diff = value - current_pos;
        for e in self.elements.iter_mut() {
            let pos = e.layout_pos() + diff;
            e.layout_set_pos(pos);
        }
    }
}
