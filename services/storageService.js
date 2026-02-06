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
        // The public URL might need to be configured separately if it differs from the endpoint
        // For R2, if a custom domain is set up, it should be in config.
        // If not, we might be able to construct it or return the R2.dev URL if enabled.
        // Assuming for now we want to return the public access URL.
        // Ideally, config.js should have a PUBLIC_URL for assets.
        // If not, we'll try to use the bucket public URL.
        this.publicUrl = process.env.R2_PUBLIC_URL || config.r2Endpoint.replace('https://', `https://${config.r2Bucket}.`);
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
     * Uploads a file to R2
     * @param {Object} file - The file object from multer (buffer, originalname, mimetype)
     * @param {string} folder - Optional folder prefix (e.g., 'events', 'avatars')
     * @returns {Promise<string>} The public URL of the uploaded file
     */
    async uploadFile(file, folder = '') {
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
     * Deletes a file from R2
     * @param {string} fileUrlOrKey - The full URL or the key of the file to delete
     * @returns {Promise<void>}
     */
    async deleteFile(fileUrlOrKey) {
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
