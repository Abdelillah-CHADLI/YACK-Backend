import crypto from "crypto";

export class CryptoHandler {

    static generateAESKey() {
        return crypto.randomBytes(32); // 256 bits
    }
    static generateIV() {
        return crypto.randomBytes(16); // 128 bits
    }

    static encryptAES(data, key, iv) {
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return { encrypted, authTag };
    }

    static decryptAES(encrypted, key, iv, authTag) {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]);
    }

    static encryptWithRSA(aesKey, publicKeyPEM) {
        return crypto.publicEncrypt(
            {
                key: publicKeyPEM,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            aesKey
        );
    }

    static decryptWithRSA(encryptedKey, privateKeyPEM) {
        return crypto.privateDecrypt(
            {
                key: privateKeyPEM,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256'
            },
            encryptedKey
        );
    }

    static convertPublicKeyToPEM(base64Key) {
        try {
            // Decode base64 to get JSON string
            const jsonStr = Buffer.from(base64Key, 'base64').toString('utf-8');
            let keyData = JSON.parse(jsonStr);

            // Ensure we have a proper JWK object with required 'kty' property
            // If keyData has 'n' and 'e' but missing 'kty', add it for RSA
            if (keyData.n && keyData.e && !keyData.kty) {
                keyData.kty = 'RSA';
            }

            // Validate that we have a proper JWK
            if (!keyData.kty) {
                throw new Error("Invalid JWK: missing 'kty' property");
            }

            if (keyData.kty !== 'RSA') {
                throw new Error(`Unsupported key type: ${keyData.kty}. Only RSA is supported.`);
            }

            if (!keyData.n || !keyData.e) {
                throw new Error("Invalid RSA JWK: missing 'n' or 'e' property");
            }

            // Create public key from JWK format
            const publicKey = crypto.createPublicKey({
                key: keyData,
                format: 'jwk'
            });
            
            return publicKey.export({ type: 'spki', format: 'pem' });
        } catch (err) {
            throw new Error(`Failed to convert public key to PEM: ${err.message}`);
        }
    }

    static encryptMedia(fileBuffer, publicKeyBase64) {
        // Generate AES key and IV
        const aesKey = this.generateAESKey();
        const iv = this.generateIV();
        
        // Encrypt file with AES
        const { encrypted, authTag } = this.encryptAES(fileBuffer, aesKey, iv);
        
        // Convert public key to PEM and encrypt AES key with RSA
        const publicKeyPEM = this.convertPublicKeyToPEM(publicKeyBase64);
        const encryptedKey = this.encryptWithRSA(aesKey, publicKeyPEM);
        
        return {
            encryptedData: encrypted,
            encryptedKey: encryptedKey,
            iv: iv,
            authTag: authTag
        };
    }

    static decryptMedia(encryptedData, encryptedKey, iv, authTag, privateKeyPEM) {
        // Decrypt AES key with RSA
        const aesKey = this.decryptWithRSA(encryptedKey, privateKeyPEM);
        
        // Decrypt file with AES
        return this.decryptAES(encryptedData, aesKey, iv, authTag);
    }
}
