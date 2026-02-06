const mongoose = require('mongoose');

// Attendance schema
const attendanceSchema = new mongoose.Schema({
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
  qrCode: {
    type: String,
    required: true
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['arrived', 'left'],
    required: true
  },
  location: {
    coordinates: {
      lat: Number,
      lng: Number
    },
    ip: String
  }
}, {
  timestamps: true
});

// Index for efficient queries
attendanceSchema.index({ eventId: 1, guestId: 1 });
attendanceSchema.index({ qrCode: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);