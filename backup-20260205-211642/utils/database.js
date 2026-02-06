const userDb = require('./db/users');
const eventDb = require('./db/events');
const guestDb = require('./db/guests');
const qrCodeDb = require('./db/qrCodes');
const attendanceDb = require('./db/attendance');
const familyDb = require('./db/families');
const familyInvitationDb = require('./db/familyInvitations');
const familyRsvpDb = require('./db/familyRsvp');
const storyEventsDb = require('./db/storyEvents');
const gamesDb = require('./db/games');


module.exports = {
  users: userDb,
  events: eventDb,
  guests: guestDb,
  qrCodes: qrCodeDb,
  attendance: attendanceDb,
  families: familyDb,
  familyInvitations: familyInvitationDb,
  familyRsvp: familyRsvpDb,
  storyEvents: storyEventsDb,
  games: gamesDb

};