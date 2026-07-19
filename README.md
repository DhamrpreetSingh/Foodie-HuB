# Foodie-HuB
FoodieHub :- is   my BCA major project for a specific restaurant. It features Google OAuth authentication, real-time order tracking, an admin dashboard, Razorpay payment integration, Google Maps integration, and a DBMS-backed backend with complete CRUD operations for managing menus, customers, and orders.

## Project Credit

This project was created by **Dharmpreet Singh**.

## What This Project Includes

- User authentication
- Admin login and admin panel
- Guest login support
- Signup with OTP flow
- Google sign-in flow
- Menu and category pages
- Cart and checkout experience
- Razorpay checkout integration for online payments
- Profile and saved address handling
- Order tracking and admin order management
- Contact and support pages

## Tech Stack

- Frontend: HTML5, CSS3, JavaScript, Bootstrap 5
- Backend: PHP
- Database: MySQL
- Local server: XAMPP / Apache

## Folder Structure

- `frontend/` - all public UI pages, styles, scripts, and assets
- `backend/` - API, controllers, routes, config, and SQL setup
- `Master.md` - original project master document

## Requirements

To run this project locally, you need:

- XAMPP or another Apache + PHP + MySQL stack
- PHP 8+ recommended
- MySQL/MariaDB
- A browser for testing the frontend

## Local Setup

1. Copy the project into your web server directory.
2. Start Apache and MySQL from XAMPP.
3. Create the database used by the project.
4. Import the SQL files from `backend/sql/` if needed.
5. Configure backend environment values in `backend/.env` or `backend/.env.local`.
6. Open the frontend in your browser and test the app.

## Environment Files

The backend reads configuration from environment files such as:

- `backend/.env`
- `backend/.env.local`
- `backend/.env.example`

Important values may include:

- database connection settings
- Google OAuth client settings
- Razorpay keys
- email delivery settings

For safe sharing, keep real secrets out of public commits and use `.env.example` as a template.

## Demo Accounts

The project includes demo accounts in the SQL seed files for local testing and demonstration.

- Demo user accounts are stored in:
  - `backend/sql/DB_Part_1.sql`
  - `backend/config/db.php`

## Notes for Downloaders

- This project is intended for local development and academic use.
- If you download it from GitHub, review the backend environment values before running it.
- Replace any local-only credentials with your own test values if needed.

## Safe Use

To run the project safely:

- Do not expose `.env` files publicly.
- Use test keys for payment and email integrations.
- Keep database credentials local.
- Review uploaded files and demo data before deployment.

## Final Note

FoodieHub has been completed as a local full-stack project by **Dharmpreet Singh**.
