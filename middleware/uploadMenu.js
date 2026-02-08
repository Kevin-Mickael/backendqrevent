const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// Filter for menu files (PDF, images)
const fileFilter = (req, file, cb) => {
    // Types MIME supportés pour le menu
    const allowedMimetypes = [
        // PDF
        'application/pdf',
        // Images
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/webp',
        'image/gif',
        'image/svg+xml',
        'image/bmp',
        'image/tiff'
    ];
    
    // Extensions supportées
    const allowedExtensions = /\.pdf$|\.jpeg$|\.jpg$|\.png$|\.webp$|\.gif$|\.svg$|\.bmp$|\.tiff$|\.tif$/i;
    
    const ext = path.extname(file.originalname).toLowerCase();
    const isValidExt = allowedExtensions.test(ext);
    const isValidMime = allowedMimetypes.includes(file.mimetype);

    console.log('[UploadMenu] File filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: ext,
        isValidExt,
        isValidMime
    });

    // Accepter si l'extension ET le mimetype sont valides
    if (isValidExt && isValidMime) {
        return cb(null, true);
    } else {
        cb(new Error('Type de fichier non supporté! Formats acceptés: PDF, JPEG, PNG, WebP, GIF'), false);
    }
};

// Initialize multer
const uploadMenu = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max pour les menus
    },
    fileFilter: fileFilter,
});

module.exports = uploadMenu;
