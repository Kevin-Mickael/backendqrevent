const sharp = require('sharp');

/**
 * Image processing service
 */
class ImageService {
    /**
     * Optimize an image for use as an avatar
     * Resizes to 500x500 max, converts to WebP, quality 80
     * @param {Buffer} buffer - The image buffer
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeAvatar(buffer) {
        try {
            const optimizedBuffer = await sharp(buffer)
                .resize({
                    width: 500,
                    height: 500,
                    fit: 'cover', // Crop to cover 500x500
                    position: 'center' // Crop from center
                })
                .webp({ quality: 80 })
                .toBuffer();

            return {
                buffer: optimizedBuffer,
                mimetype: 'image/webp',
                extension: '.webp'
            };
        } catch (error) {
            console.error('Image optimization error:', error);
            throw new Error('Failed to optimize image');
        }
    }

    /**
     * Optimize an image for general use
     * Resizes to 1200x1200 max (for web), converts to WebP, quality 85
     * @param {Buffer} buffer - The image buffer
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeGeneralImage(buffer) {
        try {
            const optimizedBuffer = await sharp(buffer)
                .resize({
                    width: 1200,
                    height: 1200,
                    fit: 'inside', // Maintain aspect ratio
                    withoutEnlargement: true // Don't enlarge if smaller than dimensions
                })
                .webp({ quality: 85 })
                .toBuffer();

            return {
                buffer: optimizedBuffer,
                mimetype: 'image/webp',
                extension: '.webp'
            };
        } catch (error) {
            console.error('General image optimization error:', error);
            throw new Error('Failed to optimize image');
        }
    }

    /**
     * Optimize an image for cover/banner use (landscape)
     * Resizes to 1920x1080 max, converts to WebP, quality 85
     * @param {Buffer} buffer - The image buffer
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeCoverImage(buffer) {
        try {
            const optimizedBuffer = await sharp(buffer)
                .resize({
                    width: 1920,
                    height: 1080,
                    fit: 'inside', // Maintain aspect ratio
                    withoutEnlargement: true // Don't enlarge if smaller than dimensions
                })
                .webp({ quality: 85 })
                .toBuffer();

            return {
                buffer: optimizedBuffer,
                mimetype: 'image/webp',
                extension: '.webp'
            };
        } catch (error) {
            console.error('Cover image optimization error:', error);
            throw new Error('Failed to optimize cover image');
        }
    }

    /**
     * Optimize an image for banner use (portrait optimized for mobile)
     * Resizes to 1080x1920 max for portrait, converts to WebP, quality 85
     * @param {Buffer} buffer - The image buffer
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeBannerImage(buffer) {
        try {
            // Validate buffer
            if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                console.error('Initial buffer check failed:', {
                    isBuffer: Buffer.isBuffer(buffer),
                    length: buffer ? buffer.length : 'null'
                });
                throw new Error('Invalid or empty image buffer');
            }

            // Get image metadata to determine orientation
            // Use failOnError: false to allow processing of partially corrupted images
            const image = sharp(buffer, { failOnError: false });
            const metadata = await image.metadata();

            const isPortrait = metadata.height > metadata.width;

            let optimizedBuffer;
            if (isPortrait) {
                // For portrait images, optimize for mobile portrait view
                optimizedBuffer = await image
                    .resize({
                        width: 1080,
                        height: 1920,
                        fit: 'inside', // Maintain aspect ratio
                        withoutEnlargement: true // Don't enlarge if smaller
                    })
                    .webp({ quality: 85 })
                    .toBuffer();
            } else {
                // For landscape images, use cover dimensions
                optimizedBuffer = await image
                    .resize({
                        width: 1920,
                        height: 1080,
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .webp({ quality: 85 })
                    .toBuffer();
            }

            return {
                buffer: optimizedBuffer,
                mimetype: 'image/webp',
                extension: '.webp'
            };
        } catch (error) {
            console.error('Banner image optimization error:', error);
            // Log additional details found in error
            if (error.message.includes('Input buffer contains unsupported image format')) {
                console.error('Buffer details on failure:', {
                    length: buffer ? buffer.length : 0,
                    start: buffer ? buffer.slice(0, 20).toString('hex') : 'null'
                });
            }
            throw new Error('Failed to optimize banner image: ' + error.message);
        }
    }

    /**
     * Optimize an image for gallery use
     * Resizes to 1920x1920 max, converts to WebP, quality 90 for high quality gallery photos
     * @param {Buffer} buffer - The image buffer
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeGalleryImage(buffer) {
        try {
            if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                throw new Error('Invalid or empty image buffer');
            }

            const optimizedBuffer = await sharp(buffer, { failOnError: false })
                .resize({
                    width: 1920,
                    height: 1920,
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .webp({ quality: 90 })
                .toBuffer();

            return {
                buffer: optimizedBuffer,
                mimetype: 'image/webp',
                extension: '.webp'
            };
        } catch (error) {
            console.error('Gallery image optimization error:', error);
            throw new Error('Failed to optimize gallery image: ' + error.message);
        }
    }

    /**
     * Optimize an image based on its intended use
     * @param {Buffer} buffer - The image buffer
     * @param {string} usage - The intended usage ('avatar', 'cover', 'banner', 'general', 'gallery')
     * @returns {Promise<{buffer: Buffer, mimetype: string, extension: string}>}
     */
    async optimizeImageByUsage(buffer, usage = 'general') {
        switch (usage) {
            case 'avatar':
                return await this.optimizeAvatar(buffer);
            case 'cover':
                return await this.optimizeCoverImage(buffer);
            case 'banner':
                return await this.optimizeBannerImage(buffer);
            case 'gallery':
                return await this.optimizeGalleryImage(buffer);
            case 'general':
            default:
                return await this.optimizeGeneralImage(buffer);
        }
    }
}

// Create and export instance
const imageService = new ImageService();
module.exports = imageService;
