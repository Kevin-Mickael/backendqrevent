const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client } = require('../config/r2');
const config = require('../config/config');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class StorageService {
    constructor() {
        this.client = r2Client;
        this.bucket = config.r2Bucket;
        this.endpoint = config.r2Endpoint;
        
        // 🛡️ Gestion du cas où R2 n'est pas configuré
        if (process.env.R2_PUBLIC_URL) {
            this.publicUrl = process.env.R2_PUBLIC_URL;
        } else if (config.r2Endpoint && config.r2Bucket) {
            this.publicUrl = config.r2Endpoint.replace('https://', `https://${config.r2Bucket}.`);
        } else {
            // Mode sans R2 - les uploads retourneront une erreur explicative
            this.publicUrl = null;
            console.warn('[Storage] R2 not configured. File uploads will be disabled.');
        }
    }
    
    /**
     * Check if storage is configured
     */
    isConfigured() {
        return !!(this.client && this.bucket && this.endpoint);
    }

    /**
     * Generates a unique file name to prevent collisions
     * @param {string} originalName 
     * @returns {string} Unique file name
     */
    generateUniqueFileName(originalName) {
        const ext = path.extname(originalName);
        const uniqueId = uuidv4();
        return `${uniqueId}${ext}`;
    }

    /**
     * Détecte si le fichier est une vidéo
     * @param {string} mimetype 
     * @returns {boolean}
     */
    isVideoFile(mimetype) {
        return mimetype && mimetype.startsWith('video/');
    }

    /**
     * Détecte si le fichier est une image
     * @param {string} mimetype 
     * @returns {boolean}
     */
    isImageFile(mimetype) {
        return mimetype && mimetype.startsWith('image/');
    }

    /**
     * Uploads a file to R2 with structured path
     * @param {Object} file - The file object from multer (buffer, originalname, mimetype)
     * @param {string} userId - User ID for path building
     * @param {string} eventId - Event ID (optional)
     * @param {string} type - File type (avatars, menus, banners, etc.)
     * @param {string} category - Category (optional, for menus)
     * @returns {Promise<string>} The public URL of the uploaded file
     */
    async uploadFileStructured(file, userId, eventId = null, type, category = null) {
        if (!this.isConfigured()) {
            throw new Error('Storage service not configured. Set R2 environment variables.');
        }
        
        if (!file) {
            throw new Error('No file provided');
        }

        const pathBuilder = require('./pathBuilder');
        
        // Validation des paramètres
        pathBuilder.validateParams(userId, eventId);

        const isVideo = this.isVideoFile(file.mimetype);
        const isImage = this.isImageFile(file.mimetype);

        console.log(`Uploading ${isVideo ? 'video' : isImage ? 'image' : 'file'} to R2:`, {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'unknown',
            userId,
            eventId,
            type,
            category
        });

        // Construction du chemin structuré
        let folder;
        switch (type) {
            case 'avatars':
                folder = pathBuilder.buildAvatarPath(userId);
                break;
            case 'banners':
                folder = pathBuilder.buildBannerPath(userId, eventId);
                break;
            case 'covers':
                folder = pathBuilder.buildCoverPath(userId, eventId);
                break;
            case 'menus':
                folder = pathBuilder.buildMenuPath(userId, eventId, category);
                break;
            case 'gallery':
                folder = pathBuilder.buildGalleryPath(userId, eventId);
                break;
            case 'qr-codes':
                folder = pathBuilder.buildQrCodePath(userId, eventId);
                break;
            case 'messages':
                folder = pathBuilder.buildMessagePath(userId, eventId);
                break;
            case 'temp':
                folder = pathBuilder.buildTempPath(userId);
                break;
            default:
                throw new Error(`Type de fichier non supporté: ${type}`);
        }

        const fileName = pathBuilder.generateUniqueFileName(file.originalname, type);
        const key = `${folder}/${fileName}`;

        // Configuration de base pour tous les fichiers
        const uploadParams = {
            Bucket: this.bucket,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: {
                'user-id': userId,
                'event-id': eventId || '',
                'file-type': type,
                'category': category || '',
                'original-name': file.originalname
            }
        };

        // Headers spécifiques selon le type de fichier
        if (isVideo) {
            uploadParams.Metadata['streaming-support'] = 'true';
        } else {
            uploadParams.Metadata['cors-enabled'] = 'true';
        }

        const command = new PutObjectCommand(uploadParams);

        try {
            await this.client.send(command);
            console.log(`File uploaded successfully to R2: ${key}`);
            
            // Return the public URL
            if (process.env.R2_PUBLIC_URL) {
                return `${process.env.R2_PUBLIC_URL}/${key}`;
            }
            return `${this.publicUrl}/${key}`;
        } catch (error) {
            console.error('Error uploading file to R2:', error);
            throw new Error(`Failed to upload file: ${error.message}`);
        }
    }

    /**
     * Legacy method for backward compatibility
     * @param {Object} file - The file object from multer (buffer, originalname, mimetype)
     * @param {string} folder - Optional folder prefix (e.g., 'events', 'avatars')
     * @returns {Promise<string>} The public URL of the uploaded file
     */
    async uploadFile(file, folder = '') {
        if (!this.isConfigured()) {
            throw new Error('Storage service not configured. Set R2 environment variables.');
        }
        
        if (!file) {
            throw new Error('No file provided');
        }

        const isVideo = this.isVideoFile(file.mimetype);
        const isImage = this.isImageFile(file.mimetype);

        console.log(`Uploading ${isVideo ? 'video' : isImage ? 'image' : 'file'} to R2:`, {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'unknown',
            folder: folder
        });

        const fileName = this.generateUniqueFileName(file.originalname);
        const key = folder ? `${folder}/${fileName}` : fileName;

        // Configuration de base pour tous les fichiers
        const uploadParams = {
            Bucket: this.bucket,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        };

        // Headers spécifiques selon le type de fichier
        if (isVideo) {
            // Headers spéciaux pour les vidéos (streaming, CORS)
            uploadParams.Metadata = {
                'Content-Type': file.mimetype,
            };
        } else {
            // CORS pour les images et autres fichiers
            uploadParams.Metadata = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD',
            };
        }

        const command = new PutObjectCommand(uploadParams);

        try {
            await this.client.send(command);
            console.log(`File uploaded successfully to R2: ${key}`);
            
            // Return the public URL
            if (process.env.R2_PUBLIC_URL) {
                return `${process.env.R2_PUBLIC_URL}/${key}`;
            }
            return `${this.publicUrl}/${key}`;
        } catch (error) {
            console.error('Error uploading file to R2:', error);
            throw new Error(`Failed to upload file: ${error.message}`);
        }
    }

    /**
     * Deletes multiple files from R2 efficiently
     * @param {Array<string>} fileUrlsOrKeys - Array of URLs or keys to delete
     * @returns {Promise<Object>} Result with success count and errors
     */
    async deleteMultipleFiles(fileUrlsOrKeys) {
        if (!this.isConfigured()) {
            return { success: false, deleted: 0, errors: ['R2 not configured'] };
        }

        if (!fileUrlsOrKeys || fileUrlsOrKeys.length === 0) {
            return { success: true, deleted: 0, errors: [] };
        }

        // Convert URLs to keys
        const keys = fileUrlsOrKeys.map(urlOrKey => {
            if (urlOrKey.startsWith('http')) {
                try {
                    const urlObj = new URL(urlOrKey);
                    return urlObj.pathname.substring(1); // Remove leading slash
                } catch (e) {
                    return urlOrKey;
                }
            }
            return urlOrKey;
        }).filter(key => key); // Remove empty keys

        if (keys.length === 0) {
            return { success: true, deleted: 0, errors: [] };
        }

        console.log(`[Storage] Deleting ${keys.length} files from R2`);

        try {
            const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
            
            const command = new DeleteObjectsCommand({
                Bucket: this.bucket,
                Delete: {
                    Objects: keys.map(key => ({ Key: key })),
                    Quiet: true // Return only errors
                }
            });

            const response = await this.client.send(command);
            
            const errors = response.Errors || [];
            const deleted = keys.length - errors.length;

            console.log(`[Storage] Deleted ${deleted}/${keys.length} files successfully`);
            
            if (errors.length > 0) {
                console.warn(`[Storage] ${errors.length} deletion errors:`, errors);
            }

            return {
                success: errors.length === 0,
                deleted,
                errors: errors.map(err => `${err.Key}: ${err.Message}`)
            };

        } catch (error) {
            console.error('[Storage] Batch deletion failed:', error);
            return {
                success: false,
                deleted: 0,
                errors: [error.message]
            };
        }
    }

    /**
     * Deletes a file from R2
     * @param {string} fileUrlOrKey - The full URL or the key of the file to delete
     * @returns {Promise<void>}
     */
    async deleteFile(fileUrlOrKey) {
        if (!this.isConfigured()) {
            console.log('[R2 Delete] Storage not configured, skipping');
            return;
        }
        
        if (!fileUrlOrKey) {
            console.log('[R2 Delete] No URL provided, skipping');
            return;
        }

        let key = fileUrlOrKey;
        
        console.log('[R2 Delete] Original URL/key:', fileUrlOrKey);
        
        // If it's a full URL, extract the key
        if (fileUrlOrKey.startsWith('http')) {
            try {
                const urlObj = new URL(fileUrlOrKey);
                // pathname includes the leading slash, remove it to get the key
                // e.g., /avatars/file.webp -> avatars/file.webp
                key = urlObj.pathname.substring(1);
                
                console.log('[R2 Delete] Parsed URL:', {
                    pathname: urlObj.pathname,
                    hostname: urlObj.hostname,
                    extractedKey: key
                });
                
                // If R2_PUBLIC_URL is set, verify this is our public URL
                if (process.env.R2_PUBLIC_URL) {
                    const publicUrlObj = new URL(process.env.R2_PUBLIC_URL);
                    console.log('[R2 Delete] Comparing hostnames:', {
                        urlHostname: urlObj.hostname,
                        publicHostname: publicUrlObj.hostname,
                        match: urlObj.hostname === publicUrlObj.hostname
                    });
                }
            } catch (e) {
                console.error('[R2 Delete] Error parsing URL for deletion:', e);
                // Not a valid URL, treat as key
                key = fileUrlOrKey;
            }
        }

        if (!key) {
            console.warn('[R2 Delete] Empty key after parsing, skipping delete');
            return;
        }

        console.log('[R2 Delete] Final key to delete:', { bucket: this.bucket, key });

        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        try {
            await this.client.send(command);
            console.log('Successfully deleted file from R2:', key);
        } catch (error) {
            console.error('Error deleting file from R2:', error.message);
            // Don't throw - file might not exist or already deleted
        }
    }
}

module.exports = new StorageService();
