use macroquad::math::Vec2;

pub trait ElementLayout {
    fn layout_dim(&self) -> Vec2;
    fn layout_pos(&self) -> Vec2;
    fn layout_set_pos(&mut self, value: Vec2);
    fn text_height(&self) -> Option<f32> {
        None
    }
    fn vertically_center(&mut self, starting_pos_y: f32, container_height: f32)
    where
        Self: Sized,
    {
        vertically_center_element(starting_pos_y, container_height, self);
    }
    fn horizontally_center(&mut self, starting_pos_x: f32, container_width: f32)
    where
        Self: Sized,
    {
        horizontally_center_element(starting_pos_x, container_width, self);
    }

    fn intersect_point(&self, p: Vec2) -> bool {
        let top_left = self.layout_pos();
        let bottom_right = top_left + self.layout_dim();

        if top_left.y > p.y || bottom_right.y < p.y {
            return false;
        }

        if top_left.x > p.x || bottom_right.x < p.x {
            return false;
        }

        true
    }
}

pub enum SpaceBetweenElements {
    Value(f32),
    Equal,
}

impl SpaceBetweenElements {
    pub fn single_value(&self) -> f32 {
        match self {
            SpaceBetweenElements::Value(v) => *v,
            SpaceBetweenElements::Equal => 0.0,
        }
    }

    pub fn is_value(&self) -> bool {
        match self {
            SpaceBetweenElements::Value(_) => true,
            SpaceBetweenElements::Equal => false,
        }
    }

    pub fn is_equal(&self) -> bool {
        match self {
            SpaceBetweenElements::Value(_) => false,
            SpaceBetweenElements::Equal => true,
        }
    }
}

impl From<f32> for SpaceBetweenElements {
    fn from(value: f32) -> Self {
        Self::Value(value)
    }
}

pub fn horizontally_center_elements(
    starting_pos_x: f32,
    container_width: f32,
    space_between_elements: impl Into<SpaceBetweenElements>,
    elements: &mut [&mut dyn ElementLayout],
) {
    let space_between_elements = space_between_elements.into();
    let mut width_needed = elements
        .iter()
        .fold(0.0, |acc, next| next.layout_dim().x + acc);
    width_needed += elements.len().saturating_sub(1) as f32 * space_between_elements.single_value();

    let mut margin = calculate_margin(width_needed, container_width);
    let space = if space_between_elements.is_value() {
        margin = margin / 2.0;
        space_between_elements.single_value()
    } else {
        margin = margin / (elements.len() + 1) as f32;
        margin
    };

    let mut pos_x = starting_pos_x + margin;
    for e in elements {
        e.layout_set_pos(e.layout_pos().with_x(pos_x));

        pos_x += e.layout_dim().x;
        pos_x += space;
    }
}

pub fn vertically_center_elements(
    starting_pos_y: f32,
    container_height: f32,
    space_between_elements: impl Into<SpaceBetweenElements>,
    elements: &mut [&mut dyn ElementLayout],
) {
    let space_between_elements = space_between_elements.into();
    let mut height_needed = elements
        .iter()
        .fold(0.0, |acc, next| next.layout_dim().y + acc);
    height_needed +=
        elements.len().saturating_sub(1) as f32 * space_between_elements.single_value();

    let mut margin = calculate_margin(height_needed, container_height);
    let space = if space_between_elements.is_value() {
        margin = margin / 2.0;
        space_between_elements.single_value()
    } else {
        margin = margin / (elements.len() + 1) as f32;
        margin
    };

    let mut pos_y = starting_pos_y + margin;
    for e in elements {
        let text_height = e.text_height().unwrap_or(0.0);
        e.layout_set_pos(e.layout_pos().with_y(pos_y + text_height));

        pos_y += e.layout_dim().y;
        pos_y += space;
    }
}

pub fn horizontally_center_element(
    starting_pos_x: f32,
    container_width: f32,
    e: &mut dyn ElementLayout,
) {
    let width_needed = e.layout_dim().x;
    let margin = calculate_margin(width_needed, container_width) / 2.0;

    let pos_x = starting_pos_x + margin;
    e.layout_set_pos(e.layout_pos().with_x(pos_x));
}

pub fn vertically_center_element(
    starting_pos_y: f32,
    container_height: f32,
    e: &mut dyn ElementLayout,
) {
    let height_needed = e.layout_dim().y;
    let margin = calculate_margin(height_needed, container_height) / 2.0;

    let text_height = e.text_height().unwrap_or(0.0);
    let pos_y = starting_pos_y + margin + text_height;
    e.layout_set_pos(e.layout_pos().with_y(pos_y));
}

pub fn calculate_margin(needed_length: f32, max_length: f32) -> f32 {
    if max_length > needed_length {
        let rest = max_length - needed_length;
        rest
    } else {
        0.0
    }
}
