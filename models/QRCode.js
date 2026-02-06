const mongoose = require('mongoose');

// QR Code schema
const qrCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: [true, 'QR code is required'],
    unique: true,
    index: true,
    minlength: [10, 'QR code must be at least 10 characters'],
    maxlength: [50, 'QR code cannot exceed 50 characters']
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  guestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Guest',
    required: true
  },
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  isValid: {
    type: Boolean,
    default: true
  },
  scanCount: {
    type: Number,
    default: 0
  },
  lastScannedAt: {
    type: Date
  },
  scannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for efficient queries
qrCodeSchema.index({ code: 1 });
qrCodeSchema.index({ eventId: 1, isValid: 1 });
qrCodeSchema.index({ guestId: 1 });

module.exports = mongoose.model('QRCode', qrCodeSchema);