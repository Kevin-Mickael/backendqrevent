# QWEN.md - Qrevent Backend

## Project Overview

Qrevent Backend is a Node.js/Express.js application that serves as the backend for the Qrevent wedding invitation platform. It handles user authentication, event management, guest management, and QR code generation and validation. The application integrates with Supabase for PostgreSQL database and authentication services.

### Key Features
- User authentication and authorization using JWT tokens
- Event creation and management for wedding organizers
- Guest management with RSVP functionality
- Secure QR code generation and validation for guest verification
- Attendance tracking at events
- RESTful API endpoints
- Supabase PostgreSQL database integration
- Supabase Auth integration

### Tech Stack
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL with Supabase
- **Authentication**: Supabase Auth and JWT
- **Validation**: Joi and Celebrate for input validation
- **Logging**: Winston for logging
- **Security**: Helmet, rate limiting, XSS protection, parameter pollution prevention
- **File Handling**: Multer for uploads, Sharp for image processing
- **Cloud Storage**: AWS SDK for R2 (Cloudflare) storage
- **QR Codes**: qr-image library for QR code generation
- **Testing**: Jest for unit testing
- **Development**: Nodemon for auto-restart during development

## Building and Running

### Prerequisites
- Node.js (version compatible with the dependencies in package.json)
- npm or pnpm package manager
- Access to a Supabase project with PostgreSQL database
- Cloudflare R2 bucket for file storage (optional but recommended)

### Installation
1. Clone the repository
2. Navigate to the backend directory: `cd /home/kevin/Qrevent/backend`
3. Install dependencies: `npm install`
4. Create a `.env` file based on `.env.example`
5. Run database migrations: `npm run migrate`
6. Start the development server: `npm run dev`

### Scripts
- `npm start` - Start the production server
- `npm run dev` - Start the development server with nodemon
- `npm run migrate` - Run database migrations
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Lint the code
- `npm run seed` - Seed the database with sample data

### API Endpoints

#### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login a user
- `GET /api/auth/profile` - Get current user profile
- `PUT /api/auth/profile` - Update user profile

#### Events
- `GET /api/events` - Get all events for the authenticated user
- `POST /api/events` - Create a new event
- `GET /api/events/:eventId` - Get a specific event
- `PUT /api/events/:eventId` - Update an event
- `DELETE /api/events/:eventId` - Delete an event

#### Guests
- `GET /api/events/:eventId/guests` - Get all guests for an event
- `POST /api/events/:eventId/guests` - Add a guest to an event
- `PUT /api/events/:eventId/guests/:guestId` - Update a guest
- `DELETE /api/events/:eventId/guests/:guestId` - Remove a guest from an event

#### QR Codes
- `POST /api/events/:eventId/generate-qr-codes` - Generate QR codes for all guests
- `POST /api/verify-qr/:qrCode` - Verify a QR code (for scanning at event)

#### Other
- `GET /api/dashboard/summary` - Get dashboard summary statistics
- `POST /api/upload` - Upload a file (image) to R2 storage

## Security Features
- Rate limiting to prevent abuse
- JWT-based authentication with secure session handling
- Secure QR code generation with expiration
- CORS configured for specific origins only
- Helmet security headers
- Input validation using Joi and Celebrate
- Parameter pollution prevention
- Content Security Policy (CSP) middleware
- SQL injection prevention through Supabase client
- XSS protection with xss-clean

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
- `R2_ACCESS_KEY_ID` - R2 access key ID
- `R2_SECRET_ACCESS_KEY` - R2 secret access key
- `R2_BUCKET` - R2 bucket name
- `R2_ENDPOINT` - R2 endpoint URL
- `R2_PUBLIC_URL` - R2 public URL

## Database Tables
- **users**: Stores user accounts (organizers, admins)
- **events**: Stores wedding events created by organizers
- **guests**: Stores guests invited to events
- **qr_codes**: Stores QR codes generated for guest verification
- **attendance**: Tracks when guests arrive at events

## Folder Structure
```
backend/
├── config/              # Configuration files (Supabase, R2, app config)
├── controllers/         # Request handlers (not currently used extensively)
├── middleware/          # Custom middleware (auth, security, upload)
├── migrations/          # Database migration scripts
├── models/              # Data models (empty in current structure)
├── node_modules/        # Dependencies
├── routes/              # API route definitions
├── scripts/             # Utility scripts
├── services/            # Business logic (QR codes, storage, image processing)
├── utils/               # Utility functions and database helpers
│   └── db/              # Individual database model files
├── .env                 # Environment variables
├── .gitignore
├── package.json
├── README.md
├── server.js            # Main application entry point
└── test-sync.js         # Test sync script
```

## Development Guidelines
- Follow the security rules defined in the application
- Use async/await consistently and handle all errors appropriately
- Log important actions for auditing using Winston logger
- Validate all inputs on both frontend and backend using Joi/Celebrate
- Keep frontend and backend data structures synchronized
- Write unit tests for critical functions using Jest
- Use environment variables for secrets and configuration
- Ensure all database operations are properly validated and sanitized
- Follow RESTful API design principles
- Implement proper error handling and return appropriate HTTP status codes
- Use secure coding practices to prevent common vulnerabilities (XSS, CSRF, SQL injection)

## Architecture Notes
- The application follows a service-oriented architecture with business logic separated in the services directory
- Database operations are abstracted through utility functions in the utils/db directory
- Authentication is handled via JWT tokens stored in HTTP-only cookies
- QR codes are generated securely with random values and have expiration times
- File uploads are processed and optimized before being stored in cloud storage
- The application implements comprehensive security measures including rate limiting, input validation, and CSP