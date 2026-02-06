const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// Filter for both image and video files
const fileFilter = (req, file, cb) => {
    // Types MIME images supportés
    const allowedImageMimetypes = [
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'image/bmp',
        'image/tiff'
    ];
    
    // Types MIME vidéo supportés
    const allowedVideoMimetypes = [
        'video/mp4',
        'video/webm',
        'video/ogg', 
        'video/quicktime', // mov
        'video/x-msvideo', // avi
        'video/x-matroska', // mkv
        'video/mpeg'
    ];
    
    const allAllowedMimetypes = [...allowedImageMimetypes, ...allowedVideoMimetypes];
    
    // Extensions supportées (images + vidéos)
    const allowedImageExtensions = /\.jpeg$|\.jpg$|\.png$|\.webp$|\.gif$|\.svg$|\.bmp$|\.tiff$|\.tif$/i;
    const allowedVideoExtensions = /\.mp4$|\.webm$|\.mov$|\.ogg$|\.avi$|\.mkv$|\.mpeg$|\.mpg$/i;
    
    const ext = path.extname(file.originalname).toLowerCase();
    const isImageExt = allowedImageExtensions.test(ext);
    const isVideoExt = allowedVideoExtensions.test(ext);
    const isValidMime = allAllowedMimetypes.includes(file.mimetype);
    const isImageMime = allowedImageMimetypes.includes(file.mimetype);
    const isVideoMime = allowedVideoMimetypes.includes(file.mimetype);

    console.log('File filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: ext,
        isImageExt,
        isVideoExt,
        isValidMime,
        fileType: isImageMime ? 'image' : isVideoMime ? 'video' : 'unknown'
    });

    // Accepter si l'extension OU le mimetype est valide
    if ((isImageExt || isVideoExt) && (isValidMime || file.mimetype === 'application/octet-stream')) {
        return cb(null, true);
    } else {
        cb(new Error('Type de fichier non supporté! Formats acceptés: Images (JPEG, PNG, WebP, GIF) et Vidéos (MP4, WebM, MOV, OGG, AVI, MKV)'), false);
    }
};

// Initialize multer
const uploadAny = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max (pour les vidéos)
    },
    fileFilter: fileFilter,
});

module.exports = uploadAny;
