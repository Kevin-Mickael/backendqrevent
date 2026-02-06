const mongoose = require('mongoose');

// Guest schema
const guestSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  qrCode: {
    type: String,
    required: [true, 'QR code is required'],
    unique: true,
    index: true
  },
  qrGeneratedAt: {
    type: Date,
    default: Date.now
  },
  qrExpiresAt: {
    type: Date,
    required: true
  },
  rsvpStatus: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending'
  },
  attendanceStatus: {
    type: String,
    enum: ['not_arrived', 'arrived', 'left'],
    default: 'not_arrived'
  },
  attendanceTime: {
    type: Date
  },
  dietaryRestrictions: {
    type: String,
    maxlength: [200, 'Dietary restrictions cannot exceed 200 characters']
  },
  plusOne: {
    type: Boolean,
    default: false
  },
  guestPlusOne: {
    firstName: String,
    lastName: String
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Index for efficient queries
guestSchema.index({ eventId: 1, qrCode: 1 });

module.exports = mongoose.model('Guest', guestSchema);