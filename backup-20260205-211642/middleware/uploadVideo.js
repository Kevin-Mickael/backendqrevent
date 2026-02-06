const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// Filter for video files
const videoFileFilter = (req, file, cb) => {
    // Types MIME vidéo supportés
    const allowedMimetypes = [
        'video/mp4',
        'video/webm', 
        'video/ogg',
        'video/quicktime', // mov
        'video/x-msvideo', // avi
        'video/x-matroska', // mkv
        'video/mpeg'
    ];
    
    // Extensions vidéo supportées
    const allowedExtensions = /\.mp4$|\.webm$|\.mov$|\.ogg$|\.avi$|\.mkv$|\.mpeg$|\.mpg$/i;
    const extname = allowedExtensions.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedMimetypes.includes(file.mimetype);

    console.log('Video file filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: path.extname(file.originalname).toLowerCase(),
        extnameValid: extname,
        mimetypeValid: mimetype
    });

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Seuls les fichiers vidéo sont autorisés (MP4, WebM, MOV, OGG, AVI, MKV)!'), false);
    }
};

// Initialize multer pour les vidéos
const uploadVideo = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit pour les vidéos
    },
    fileFilter: videoFileFilter,
});

module.exports = uploadVideo;
