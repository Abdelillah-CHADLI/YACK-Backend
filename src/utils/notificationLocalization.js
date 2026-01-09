/**
 * Localization handler for notifications
 * Supports English, French, and Arabic
 */

export const NotificationLocalization = {
    // Supported languages
    languages: ['en', 'fr', 'ar'],

    // Translation keys
    translations: {
        en: {
            // Contract notifications
            'contract_joined': 'Contract Joined',
            'contract_joined_desc': '{name} joined your contract',
            'contract_signed': 'Contract Signed',
            'contract_signed_desc': '{name} signed the contract',
            'contract_accepted': 'Contract Accepted',
            'contract_accepted_desc': '{name} accepted the contract',
            'contract_completed': 'Contract Completed',
            'contract_completed_desc': 'Contract with {name} has been completed',
            'contract_disputed': 'Contract Disputed',
            'contract_disputed_desc': '{name} disputed the contract',
            
            // Message notifications
            'new_message': 'New Message',
            'new_message_desc': '{name} sent you a message',
            
            // Media notifications
            'new_media': 'New Media',
            'new_media_desc': '{name} shared {filename}',
        },
        
        fr: {
            // Contract notifications
            'contract_joined': 'Contrat Rejoint',
            'contract_joined_desc': '{name} a rejoint votre contrat',
            'contract_signed': 'Contrat Signé',
            'contract_signed_desc': '{name} a signé le contrat',
            'contract_accepted': 'Contrat Accepté',
            'contract_accepted_desc': '{name} a accepté le contrat',
            'contract_completed': 'Contrat Terminé',
            'contract_completed_desc': 'Le contrat avec {name} a été terminé',
            'contract_disputed': 'Contrat Contesté',
            'contract_disputed_desc': '{name} a contesté le contrat',
            
            // Message notifications
            'new_message': 'Nouveau Message',
            'new_message_desc': '{name} vous a envoyé un message',
            
            // Media notifications
            'new_media': 'Nouveau Média',
            'new_media_desc': '{name} a partagé {filename}',
        },
        
        ar: {
            // Contract notifications
            'contract_joined': 'انضم إلى العقد',
            'contract_joined_desc': 'انضم {name} إلى عقدك',
            'contract_signed': 'تم توقيع العقد',
            'contract_signed_desc': 'وقع {name} العقد',
            'contract_accepted': 'تم قبول العقد',
            'contract_accepted_desc': 'قبل {name} العقد',
            'contract_completed': 'تم إكمال العقد',
            'contract_completed_desc': 'تم إكمال العقد مع {name}',
            'contract_disputed': 'تم الاعتراض على العقد',
            'contract_disputed_desc': 'اعترض {name} على العقد',
            
            // Message notifications
            'new_message': 'رسالة جديدة',
            'new_message_desc': 'أرسل لك {name} رسالة',
            
            // Media notifications
            'new_media': 'ملف جديد',
            'new_media_desc': 'شارك {name} {filename}',
        }
    },

    get(key, language = 'en', params = {}) {
        // Default to English if language not supported
        if (!this.languages.includes(language)) {
            language = 'en';
        }

        // Get translation
        let text = this.translations[language]?.[key] || this.translations.en[key] || key;

        // Replace parameters
        if (params) {
            Object.keys(params).forEach(param => {
                text = text.replace(`{${param}}`, params[param]);
            });
        }

        return text;
    },

    getNotification(notificationType, language = 'en', params = {}) {
        const titleKey = notificationType;
        const bodyKey = `${notificationType}_desc`;

        return {
            title: this.get(titleKey, language, params),
            body: this.get(bodyKey, language, params)
        };
    }
};
