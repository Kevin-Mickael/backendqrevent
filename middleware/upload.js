const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// 🛡️ SECURITY: Enhanced file filter to prevent XSS via SVG
const fileFilter = (req, file, cb) => {
    // Whitelist strict des extensions autorisées (PAS de SVG!)
    const allowedFileTypes = /jpeg|jpg|png|webp/;  // Retiré: gif, svg
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    
    // Whitelist strict des MIME types
    const allowedMimetypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];  // Retiré: image/gif, image/svg+xml
    const mimetype = allowedMimetypes.includes(file.mimetype);

    // 🛡️ Vérification supplémentaire: bloquer les fichiers contenant du JavaScript
    const dangerousExtensions = /\.svg|\.svgz|\.html|\.htm|\.xhtml|\.js|\.jsx/i;
    const hasDangerousExtension = dangerousExtensions.test(file.originalname.toLowerCase());

    console.log('File filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: path.extname(file.originalname).toLowerCase(),
        extnameValid: extname,
        mimetypeValid: mimetype,
        hasDangerousExtension: hasDangerousExtension
    });

    // Rejeter si l'extension est dangereuse
    if (hasDangerousExtension) {
        console.warn('[SECURITY] Rejected dangerous file type:', file.originalname);
        return cb(new Error('File type not allowed for security reasons'), false);
    }

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files (JPEG, PNG, WebP) are allowed!'), false);
    }
};

// Initialize multer
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit for images
    },
    fileFilter: fileFilter,
});

module.exports = upload;
