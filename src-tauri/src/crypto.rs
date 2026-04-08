use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::RngCore;
use thiserror::Error;

const KEYRING_SERVICE: &str = "glm-quota-monitor";
const KEYRING_USERNAME: &str = "encryption-key";

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption error: {0}")]
    Encrypt(String),
    #[error("Decryption error: {0}")]
    Decrypt(String),
    #[error("Keyring error: {0}")]
    Keyring(String),
}

/// 从系统 Keychain 获取或创建加密密钥
fn get_or_create_key() -> Result<Vec<u8>, CryptoError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USERNAME)
        .map_err(|e| CryptoError::Keyring(e.to_string()))?;

    match entry.get_password() {
        Ok(key_b64) => BASE64
            .decode(&key_b64)
            .map_err(|e| CryptoError::Keyring(e.to_string())),
        Err(_) => {
            // 首次使用，生成新密钥
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            let key_b64 = BASE64.encode(key);
            entry
                .set_password(&key_b64)
                .map_err(|e| CryptoError::Keyring(e.to_string()))?;
            Ok(key.to_vec())
        }
    }
}

/// 加密 API Key，返回 Base64 编码的 nonce+ciphertext
pub fn encrypt(plaintext: &str) -> Result<String, CryptoError> {
    let key = get_or_create_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;

    // nonce(12 bytes) + ciphertext
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(combined))
}

/// 解密 API Key
pub fn decrypt(encrypted: &str) -> Result<String, CryptoError> {
    let key = get_or_create_key()?;
    let combined = BASE64
        .decode(encrypted)
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;

    if combined.len() < 12 {
        return Err(CryptoError::Decrypt("Invalid encrypted data".to_string()));
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;

    String::from_utf8(plaintext).map_err(|e| CryptoError::Decrypt(e.to_string()))
}
