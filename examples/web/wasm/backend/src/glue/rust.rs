/*
    Js -> Wasm/Rust Glue
*/

use std::sync::Mutex;

use macroquad::prelude::info;
use sapp_jsutils::JsObject;

static MESSAGES_FROM_JS: Mutex<Vec<MessageFromJs>> = Mutex::new(Vec::new());
pub fn push_new_js_message(message: MessageFromJs) {
    let mut l = MESSAGES_FROM_JS.lock().unwrap();
    l.push(message);
}

pub fn read_new_js_messages() -> Vec<MessageFromJs> {
    let mut l = MESSAGES_FROM_JS.lock().unwrap();
    if l.len() > 0 {}
    let mut messages = Vec::new();
    std::mem::swap(&mut *l, &mut messages);
    if messages.len() > 0 {}
    messages
}

pub enum MessageFromJs {
    NexusInitializationFailed(String),
    NexusInitializationSucceeded,
    BridgingFailed(String),
    BridgingStep(String),
    BridgingSucceed,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn nexus_initialization_failed(js_obj: JsObject) {
    let mut message = String::new();

    js_obj.to_string(&mut message);
    push_new_js_message(MessageFromJs::NexusInitializationFailed(message))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn nexus_initialization_succeeded() {
    push_new_js_message(MessageFromJs::NexusInitializationSucceeded)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bridging_failed(js_obj: JsObject) {
    let mut message = String::new();

    js_obj.to_string(&mut message);
    push_new_js_message(MessageFromJs::BridgingFailed(message))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bridging_step(js_obj: JsObject) {
    let mut message = String::new();

    js_obj.to_string(&mut message);
    push_new_js_message(MessageFromJs::BridgingStep(message))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn bridging_succeed() {
    push_new_js_message(MessageFromJs::BridgingSucceed)
}
