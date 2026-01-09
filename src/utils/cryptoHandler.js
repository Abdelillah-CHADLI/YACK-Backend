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
            const keyData = JSON.parse(jsonStr);
            
            // Extract modulus and exponent
            const n = BigInt(keyData.n);
            const e = BigInt(keyData.e);
            
            // Convert to Buffer for DER encoding
            const nBuffer = Buffer.from(n.toString(16).padStart(512, '0'), 'hex');
            const eBuffer = Buffer.from(e.toString(16).padStart(6, '0'), 'hex');
            
            // Create DER structure for RSA public key
            // This is a simplified approach - for production, consider using 'node-forge' library
            const derKey = crypto.createPublicKey({
                key: {
                    n: nBuffer,
                    e: eBuffer
                },
                format: 'jwk',
                type: 'pkcs1'
            });
            
            return derKey.export({ type: 'spki', format: 'pem' });
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
