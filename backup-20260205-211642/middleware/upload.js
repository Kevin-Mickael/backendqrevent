const multer = require('multer');
const path = require('path');

// Configure storage
const storage = multer.memoryStorage();

// Filter for image files
const fileFilter = (req, file, cb) => {
    const allowedFileTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedFileTypes.test(path.extname(file.originalname).toLowerCase());
    const allowedMimetypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const mimetype = allowedMimetypes.includes(file.mimetype);

    console.log('File filter check:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extname: path.extname(file.originalname).toLowerCase(),
        extnameValid: extname,
        mimetypeValid: mimetype
    });

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
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
