const mongoose = require('mongoose');

// Event schema
const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Event description is required'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  date: {
    type: Date,
    required: [true, 'Event date is required']
  },
  location: {
    address: {
      type: String,
      required: [true, 'Event address is required']
    },
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  coverImage: {
    type: String,
    default: ''
  },
  bannerImage: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    enableRSVP: {
      type: Boolean,
      default: true
    },
    enableGames: {
      type: Boolean,
      default: true
    },
    enablePhotoGallery: {
      type: Boolean,
      default: true
    },
    enableGuestBook: {
      type: Boolean,
      default: true
    },
    enableQRVerification: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Event', eventSchema);