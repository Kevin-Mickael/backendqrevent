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
     * 🛡️ Sécurité: Valide le chemin pour éviter le path traversal
     * @param {string} filePath 
     * @returns {boolean}
     */
    isValidPath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return false;
        }
        
        // Normaliser le chemin
        const normalized = path.normalize(filePath);
        
        // Rejeter les chemins qui:
        // 1. Commencent par .. (retour au dossier parent)
        // 2. Commencent par / (chemin absolu)
        // 3. Contiennent des caractères suspects
        if (normalized.startsWith('..') || 
            normalized.startsWith('/') || 
            normalized.includes('../') ||
            /[<>:"|?*]/.test(normalized)) {
            return false;
        }
        
        return true;
    }

    /**
     * 🛡️ Sécurité: Extrait et valide la clé depuis une URL
     * @param {string} fileUrl 
     * @returns {string|null}
     */
    extractKeyFromUrl(fileUrl) {
        if (!fileUrl.startsWith('http')) {
            // Si ce n'est pas une URL, valider directement comme clé
            return this.isValidPath(fileUrl) ? fileUrl : null;
        }
        
        try {
            const urlObj = new URL(fileUrl);
            let key = urlObj.pathname.substring(1); // Retirer le leading /
            
            // Vérifier que l'URL appartient bien à notre domaine R2
            if (process.env.R2_PUBLIC_URL) {
                const publicUrlObj = new URL(process.env.R2_PUBLIC_URL);
                const allowedDomains = [
                    publicUrlObj.hostname,
                    `${config.r2Bucket}.r2.cloudflarestorage.com`,
                    'r2.cloudflarestorage.com'
                ];
                
                if (!allowedDomains.includes(urlObj.hostname)) {
                    console.error('[R2 Security] Domaine non autorisé:', urlObj.hostname);
                    return null;
                }
            }
            
            return this.isValidPath(key) ? key : null;
        } catch (e) {
            console.error('[R2 Security] Erreur parsing URL:', e);
            return null;
        }
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

        // 🛡️ Valider le dossier pour éviter le path traversal
        if (folder && !this.isValidPath(folder)) {
            throw new Error('Invalid folder path');
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
            uploadParams.Metadata = {
                'Content-Type': file.mimetype,
            };
        } else {
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

        console.log('[R2 Delete] Original URL/key:', fileUrlOrKey);
        
        // 🛡️ Extraire et valider la clé
        const key = this.extractKeyFromUrl(fileUrlOrKey);
        
        if (!key) {
            console.error('[R2 Security] Tentative de suppression avec chemin invalide:', fileUrlOrKey);
            throw new Error('Invalid file path for deletion');
        }

        console.log('[R2 Delete] Final validated key:', { bucket: this.bucket, key });

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
