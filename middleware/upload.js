const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// 🛡️ SECURITY: Enhanced file filter to prevent XSS and support media files
const fileFilter = (req, file, cb) => {
    // Whitelist strict des extensions autorisées pour images et vidéos
    const allowedImageTypes = /jpeg|jpg|png|webp/;
    const allowedVideoTypes = /mp4|mov|webm|avi/;
    const extname = path.extname(file.originalname).toLowerCase();
    
    const isImageExtValid = allowedImageTypes.test(extname);
    const isVideoExtValid = allowedVideoTypes.test(extname);
    
    // Whitelist strict des MIME types
    const allowedImageMimetypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const allowedVideoMimetypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/avi'];
    
    const isImageMimeValid = allowedImageMimetypes.includes(file.mimetype);
    const isVideoMimeValid = allowedVideoMimetypes.includes(file.mimetype);

    // 🛡️ Vérification supplémentaire: bloquer les fichiers contenant du JavaScript
    const dangerousExtensions = /\.svg|\.svgz|\.html|\.htm|\.xhtml|\.js|\.jsx/i;
    const hasDangerousExtension = dangerousExtensions.test(file.originalname.toLowerCase());

    console.log('File filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: extname,
        isImageExtValid,
        isVideoExtValid,
        isImageMimeValid,
        isVideoMimeValid,
        hasDangerousExtension: hasDangerousExtension
    });

    // Rejeter si l'extension est dangereuse
    if (hasDangerousExtension) {
        console.warn('[SECURITY] Rejected dangerous file type:', file.originalname);
        return cb(new Error('File type not allowed for security reasons'), false);
    }

    // Accepter si c'est une image ou vidéo valide
    if ((isImageExtValid && isImageMimeValid) || (isVideoExtValid && isVideoMimeValid)) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files (JPEG, PNG, WebP) and video files (MP4, MOV, WebM, AVI) are allowed!'), false);
    }
};

// Dynamic file size limit based on file type
const dynamicLimits = (req, file, cb) => {
    const isVideo = file.mimetype.startsWith('video/');
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB for videos, 10MB for images
    cb(null, maxSize);
};

// Initialize multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // Maximum 50MB (pour les vidéos)
    },
    fileFilter: fileFilter,
});

module.exports = upload;
