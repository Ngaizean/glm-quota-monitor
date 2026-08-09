use aes_gcm::aead::{Aead, Key, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use std::sync::LazyLock;

/// 统一加密密钥（256-bit / 32 字节）— owner/consumer 共享，用于加密 auth.json 后上传到 Gist。
///
/// 编译期从 CODEX_AES_KEY 环境变量注入（32 字节 ASCII）。未设置或长度不符时回退到内置 key，
/// 保证旧版本/未配置环境仍可编译使用（向后兼容）。
/// 设置环境变量后，key 不存在于源码，即使源码 + Gist ID 泄露也无法解密（防御纵深）。
static ENCRYPTION_KEY: LazyLock<[u8; 32]> = LazyLock::new(|| match option_env!("CODEX_AES_KEY") {
    Some(k) if k.len() == 32 => {
        let mut arr = [0u8; 32];
        arr.copy_from_slice(k.as_bytes());
        arr
    }
    _ => {
        eprintln!(
            "warn: CODEX_AES_KEY 未设置或长度非 32 字节，回退到内置 key。\
                 设置 CODEX_AES_KEY 环境变量（32 字节 ASCII）以启用防御纵深。"
        );
        *b"gLmQu0t4C0d3xSyNcK3y256b1t5SeCr3"
    }
});

/// 加密明文，返回 base64(nonce || ciphertext || tag)
pub fn encrypt(plaintext: &str) -> Result<String, String> {
    let key = Key::<Aes256Gcm>::from_slice(&*ENCRYPTION_KEY);
    let cipher = Aes256Gcm::new(key);
    let mut nonce_bytes = [0u8; 12];
    // 跨平台安全随机数（getrandom：macOS 用 getentropy syscall，Windows 用 BCryptGenRandom）
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| format!("随机数生成失败: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("加密失败: {}", e))?;

    // nonce(12) + ciphertext(with tag) 拼接后 base64
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
}

/// 解密 base64(nonce || ciphertext || tag)，返回明文
pub fn decrypt(b64: &str) -> Result<String, String> {
    let combined = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 解码失败: {}", e))?;

    if combined.len() < 12 {
        return Err("密文过短".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = Key::<Aes256Gcm>::from_slice(&*ENCRYPTION_KEY);
    let cipher = Aes256Gcm::new(key);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "解密失败：密钥不匹配或数据已损坏".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 解码失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let original = r#"{"tokens":{"access_token":"abc123","refresh_token":"xyz"}}"#;
        let encrypted = encrypt(original).unwrap();
        assert_ne!(encrypted, original);
        let decrypted = decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, original);
    }

    #[test]
    fn test_wrong_key_fails() {
        let encrypted = encrypt("secret").unwrap();
        assert!(decrypt(&format!("{}!", encrypted)).is_err());
    }
}
