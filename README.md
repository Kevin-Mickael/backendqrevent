# Qrevent Backend

This is the Node.js backend for the Qrevent wedding invitation platform. It handles user authentication, event management, guest management, and QR code generation and validation, integrated with Supabase for PostgreSQL database and authentication.

## Features

- User authentication and authorization
- Event creation and management
- Guest management with RSVP functionality
- Secure QR code generation and validation
- Attendance tracking
- RESTful API endpoints
- Supabase PostgreSQL database integration
- Supabase Auth integration

## Tech Stack

- Node.js
- Express.js
- PostgreSQL with Supabase
- Supabase Auth
- JWT for authentication
- Joi for validation
- Winston for logging
- Helmet for security
- UUID for unique identifiers

## Installation

1. Clone the repository
2. Navigate to the backend directory: `cd /home/kevin/Qrevent/backend`
3. Install dependencies: `npm install`
4. Create a `.env` file based on `.env.example`
5. Run database migrations: `npm run migrate`
6. Start the development server: `npm run dev`

## Scripts

- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm run migrate` - Run database migrations
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint the code

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login a user
- `GET /api/auth/profile` - Get current user profile
- `PUT /api/auth/profile` - Update user profile

### Events
- `GET /api/events` - Get all events for the authenticated user
- `POST /api/events` - Create a new event
- `GET /api/events/:eventId` - Get a specific event
- `PUT /api/events/:eventId` - Update an event
- `DELETE /api/events/:eventId` - Delete an event

### Guests
- `GET /api/events/:eventId/guests` - Get all guests for an event
- `POST /api/events/:eventId/guests` - Add a guest to an event
- `PUT /api/events/:eventId/guests/:guestId` - Update a guest
- `DELETE /api/events/:eventId/guests/:guestId` - Remove a guest from an event

### QR Codes
- `POST /api/events/:eventId/generate-qr-codes` - Generate QR codes for all guests
- `POST /api/verify-qr/:qrCode` - Verify a QR code (for scanning at event)

## Security Features

- Rate limiting to prevent abuse
- JWT-based authentication
- Secure QR code generation with expiration
- CORS configured for specific origins only
- Helmet security headers
- Input validation using Joi

## Environment Variables

- `PORT` - Port to run the server on (default: 5000)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `SUPABASE_CONNECTION_STRING` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing
- `JWT_EXPIRE` - JWT expiration time
- `BCRYPT_ROUNDS` - Rounds for password hashing
- `QR_CODE_LENGTH` - Length of generated QR codes
- `QR_CODE_EXPIRATION_HOURS` - Hours until QR codes expire
- `ALLOWED_ORIGINS` - Comma-separated list of allowed origins for CORS
- `LOG_LEVEL` - Logging level (default: info)

## Database Tables

- **users**: Stores user accounts (organizers, admins)
- **events**: Stores wedding events created by organizers
- **guests**: Stores guests invited to events
- **qr_codes**: Stores QR codes generated for guest verification
- **attendance**: Tracks when guests arrive at events

## Folder Structure

```
backend/
├── controllers/     # Request handlers
├── migrations/      # Database migration scripts
├── routes/          # API routes
├── services/        # Business logic
├── middleware/      # Custom middleware
├── utils/           # Utility functions
│   └── db/          # Database utility functions
├── config/          # Configuration files
├── logs/            # Log files
├── scripts/         # Utility scripts
├── .env             # Environment variables
├── .gitignore
├── package.json
└── server.js        # Entry point
```

## Development Guidelines

- Follow the security rules defined in `rules.md`
- Use async/await consistently and handle all errors
- Log important actions for auditing
- Validate all inputs on both frontend and backend
- Keep frontend and backend data structures synchronized
- Write unit tests for critical functions
- Use environment variables for secrets and configuration
- Ensure all database operations are properly validated and sanitized