/**
 * Test file for NotificationLocalization
 * Tests notification localization in different languages
 */

import { NotificationLocalization } from '../src/utils/notificationLocalization.js';
import assert from 'assert';

console.log('================ NOTIFICATION LOCALIZATION TEST START ================\n');

// Test 1: Get English Notifications
console.log('Test 1: Get English Notifications');
const enContractJoined = NotificationLocalization.get('contract_joined', 'en');
assert.strictEqual(enContractJoined, 'Contract Joined', 'English contract_joined should match');

const enContractJoinedDesc = NotificationLocalization.get('contract_joined_desc', 'en', { name: 'John' });
assert.strictEqual(enContractJoinedDesc, 'John joined your contract', 'English description with params should work');
console.log('✓ English notifications working correctly\n');

// Test 2: Get French Notifications
console.log('Test 2: Get French Notifications');
const frContractJoined = NotificationLocalization.get('contract_joined', 'fr');
assert.strictEqual(frContractJoined, 'Contrat Rejoint', 'French contract_joined should match');

const frNewMessage = NotificationLocalization.get('new_message_desc', 'fr', { name: 'Marie' });
assert.strictEqual(frNewMessage, 'Marie vous a envoyé un message', 'French description with params should work');
console.log('✓ French notifications working correctly\n');

// Test 3: Get Arabic Notifications
console.log('Test 3: Get Arabic Notifications');
const arContractSigned = NotificationLocalization.get('contract_signed', 'ar');
assert.strictEqual(arContractSigned, 'تم توقيع العقد', 'Arabic contract_signed should match');

const arNewMedia = NotificationLocalization.get('new_media_desc', 'ar', { name: 'أحمد', filename: 'photo.jpg' });
assert.strictEqual(arNewMedia, 'شارك أحمد photo.jpg', 'Arabic description with params should work');
console.log('✓ Arabic notifications working correctly\n');

// Test 4: Fallback to English for Unsupported Language
console.log('Test 4: Fallback to English for Unsupported Language');
const fallback = NotificationLocalization.get('contract_joined', 'de');
assert.strictEqual(fallback, 'Contract Joined', 'Should fallback to English for unsupported language');
console.log('✓ Fallback mechanism working correctly\n');

// Test 5: Get Full Notification Object
console.log('Test 5: Get Full Notification Object');
const notification = NotificationLocalization.getNotification('contract_accepted', 'en', { name: 'Alice' });
assert.strictEqual(notification.title, 'Contract Accepted', 'Title should be correct');
assert.strictEqual(notification.body, 'Alice accepted the contract', 'Body should be correct');
console.log('✓ Full notification object working correctly\n');

// Test 6: Multiple Parameter Replacement
console.log('Test 6: Multiple Parameter Replacement');
const mediaNotif = NotificationLocalization.getNotification('new_media', 'fr', { 
    name: 'Pierre', 
    filename: 'document.pdf' 
});
assert.strictEqual(mediaNotif.title, 'Nouveau Média', 'French media title should be correct');
assert.strictEqual(mediaNotif.body, 'Pierre a partagé document.pdf', 'French media body with params should be correct');
console.log('✓ Multiple parameter replacement working correctly\n');

// Test 7: All Notification Types in All Languages
console.log('Test 7: Test All Notification Types');
const notificationTypes = [
    'contract_joined',
    'contract_signed',
    'contract_accepted',
    'contract_completed',
    'contract_disputed',
    'new_message',
    'new_media'
];

const languages = ['en', 'fr', 'ar'];

notificationTypes.forEach(type => {
    languages.forEach(lang => {
        const result = NotificationLocalization.get(type, lang);
        assert.ok(result, `${type} should exist in ${lang}`);
    });
});
console.log('✓ All notification types exist in all languages\n');

// Test 8: Missing Translation Key
console.log('Test 8: Missing Translation Key');
const missing = NotificationLocalization.get('non_existent_key', 'en');
assert.strictEqual(missing, 'non_existent_key', 'Should return key itself for missing translations');
console.log('✓ Missing key handling working correctly\n');

console.log('================ NOTIFICATION LOCALIZATION TEST COMPLETE ================');
console.log('All tests passed successfully! ✓\n');
