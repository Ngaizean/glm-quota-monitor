use std::collections::HashMap;
use std::sync::LazyLock;

/// 数据来源：https://open.bigmodel.cn/pricing 旗舰模型输出价（取最常见档位）
static PRICING: LazyLock<HashMap<&'static str, f64>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    // GLM-5 系列（输入<32k 档位输出价）
    m.insert("glm-5.1", 24.0);
    m.insert("glm-5-turbo", 22.0);
    m.insert("glm-5", 18.0);
    // GLM-4 系列（输入<32k, 输出>0.2k 档位）
    m.insert("glm-4.7", 14.0);
    m.insert("glm-4.5-air", 6.0);
    m.insert("glm-4.7-flashx", 3.0);
    m.insert("glm-4.7-flash", 0.0);
    m.insert("glm-4-plus", 5.0);
    m.insert("glm-4-air", 0.5);
    m.insert("glm-4-flashx", 0.1);
    m.insert("glm-4-long", 1.0);
    m
});

/// 兜底单价：元/百万tokens（Coding Plan 常用模型的加权均值）
pub const DEFAULT_UNIT_PRICE: f64 = 10.0;

/// 获取模型输出价格（元/百万tokens）
pub fn get_price(model_code: &str) -> f64 {
    PRICING
        .get(model_code.to_lowercase().as_str())
        .copied()
        .unwrap_or(DEFAULT_UNIT_PRICE)
}

/// 根据账号 level 推算套餐月费
/// 来源：https://open.bigmodel.cn/glm-coding（连续包季 9 折推算月费）
pub fn plan_price_for_level(level: &str) -> f64 {
    match level.to_lowercase().as_str() {
        "lite" => 49.0,
        "pro" => 149.0,
        "max" => 469.0,
        _ => 200.0,
    }
}
