const multer = require('multer');
const path = require('path');

const storage = multer.memoryStorage();
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

const upload = multer({ storage, fileFilter });

// Simulate file object
const mockFile = {
    originalname: 'qrcode.webp',
    mimetype: 'image/webp',
    buffer: Buffer.alloc(10)
};

const mockReq = {};
const mockCb = (error, success) => {
    console.log('Callback result:', { error: error?.message, success });
    process.exit(0);
};

fileFilter(mockReq, mockFile, mockCb);
