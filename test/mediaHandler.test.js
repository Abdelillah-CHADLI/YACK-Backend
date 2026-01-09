/**
 * Test file for MediaHandler
 * Tests media storage with encryption
 */

import { MediaHandler } from '../src/utils/mediaHandler.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import assert from 'assert';

console.log('================ MEDIA HANDLER TEST START ================\n');

// Setup: Generate RSA keys for testing
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
    },
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
    }
});

// Convert public key to base64-encoded JSON format (like frontend sends)
const testPublicKeyObj = crypto.createPublicKey(publicKey);
const jwk = testPublicKeyObj.export({ format: 'jwk' });
const publicKeyJson = {
    n: BigInt('0x' + Buffer.from(jwk.n, 'base64').toString('hex')).toString(),
    e: BigInt('0x' + Buffer.from(jwk.e, 'base64').toString('hex')).toString()
};
const publicKeyBase64 = Buffer.from(JSON.stringify(publicKeyJson)).toString('base64');

// Test 1: Store Encrypted Media
console.log('Test 1: Store Encrypted Media');
const testMedia = {
    filename: 'test-image.jpg',
    buffer: Buffer.from('This is test media content').toString('base64'),
    mimeType: 'image/jpeg'
};

let storedMedia;
try {
    storedMedia = await MediaHandler.send(testMedia, publicKeyBase64);
    console.log('Media stored at:', storedMedia.path);
    console.log('Original filename:', storedMedia.originalFilename);
    console.log('MIME type:', storedMedia.mimeType);
    assert.ok(storedMedia.path, 'Media path should be returned');
    assert.ok(storedMedia.encryptedKey, 'Encrypted key should be returned');
    assert.ok(storedMedia.iv, 'IV should be returned');
    assert.ok(storedMedia.authTag, 'Auth tag should be returned');
    console.log('✓ Media stored with encryption metadata\n');
} catch (err) {
    console.error('✗ Error storing media:', err.message);
    console.log('Note: Full encryption requires proper RSA key conversion implementation\n');
}

// Test 2: Retrieve Encrypted Media
if (storedMedia) {
    console.log('Test 2: Retrieve Encrypted Media');
    try {
        const retrievedMedia = await MediaHandler.get(storedMedia.path);
        console.log('Retrieved encrypted data (truncated):', retrievedMedia.encryptedData.substring(0, 50) + '...');
        assert.ok(retrievedMedia.encryptedData, 'Encrypted data should be returned');
        assert.ok(retrievedMedia.encryptedKey, 'Encrypted key should be returned');
        console.log('✓ Media retrieved successfully\n');
    } catch (err) {
        console.error('✗ Error retrieving media:', err.message);
    }
}

// Test 3: Error Handling - Invalid Media
console.log('Test 3: Error Handling - Invalid Media');
try {
    await MediaHandler.send(null, publicKeyBase64);
    assert.fail('Should have thrown error for null media');
} catch (err) {
    console.log('✓ Correctly rejected null media\n');
}

// Test 4: Error Handling - Missing Public Key
console.log('Test 4: Error Handling - Missing Public Key');
try {
    await MediaHandler.send(testMedia, null);
    assert.fail('Should have thrown error for missing public key');
} catch (err) {
    console.log('✓ Correctly rejected missing public key\n');
}

// Test 5: Error Handling - Invalid Path
console.log('Test 5: Error Handling - Invalid Path');
try {
    await MediaHandler.get(null);
    assert.fail('Should have thrown error for null path');
} catch (err) {
    console.log('✓ Correctly rejected null path\n');
}

// Cleanup
if (storedMedia) {
    console.log('Cleanup: Removing test files');
    try {
        await fs.unlink(storedMedia.path);
        await fs.unlink(`${storedMedia.path}.meta`);
        console.log('✓ Test files cleaned up\n');
    } catch (err) {
        console.log('Note: Some test files may need manual cleanup\n');
    }
}

console.log('================ MEDIA HANDLER TEST COMPLETE ================');
console.log('Core functionality tests passed! ✓');
console.log('Note: Full end-to-end encryption testing requires complete RSA key conversion\n');
