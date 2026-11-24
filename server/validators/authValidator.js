import { z } from 'zod'; // Imports the Zod validation library[cite: 13]
import uiPrefsUpdateSchema from './uiPrefsSchema.js';

export const loginSchema = z.object({ // Exports the schema for login validation[cite: 13]
  email: z.string().min(1, 'Username or email is required.').max(255), // Validates that the email/username is a non-empty string up to 255 characters
  password: z.string().min(1, 'Password is required.'), // Validates that the password is a non-empty string[cite: 13]
}); // Closes the login schema object[cite: 13]

// Per-user UI preferences (PLAN.MD §13 P1) — schema derived from the
// preferences registry mirror; unknown keys are stripped so the stored
// users.ui_prefs blob can never hold unregistered preferences.
export const updatePreferencesSchema = uiPrefsUpdateSchema;

export const changePasswordSchema = z.object({ // Exports the schema for changing passwords[cite: 13]
  newPassword: z // Defines the validation for the new password[cite: 13]
    .string() // Ensures the password is a string[cite: 13]
    .min(8, 'Password must be at least 8 characters long.') // Enforces a minimum length of 8 characters[cite: 13]
    .max(128, 'Password must not exceed 128 characters.'), // Enforces a maximum length of 128 characters[cite: 13]
}); // Closes the change password schema object[cite: 13]