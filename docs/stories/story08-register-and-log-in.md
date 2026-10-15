# Story 08 - Register and Log In

> **Status audit — 2026-10-14:** Részleges; helyi OIDC tesztelt. OIDC és SNAuth mód van. Supabase/Clerk onboarding, Google/GitHub login, regisztráció/profil/reset nincs. Admin használat az aktuális cél.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US008 – Register and Log In**
> As a user, I want to register and log in using email or a third-party service, so my timelines are saved.

## Acceptance Criteria
- [ ] User can register with email and password
- [ ] User can log in with email and password
- [ ] User can register/login with Google
- [ ] User can register/login with GitHub
- [ ] User sessions are maintained securely
- [ ] User can log out
- [ ] User can reset password
- [ ] User profile is created on registration

## Technical Requirements
- Implement authentication system (Supabase Auth or Clerk)
- Create registration form
- Create login form
- Add social login providers
- Implement session management
- Add password reset functionality
- Create user profile management

## Priority
High - Required for user data persistence

## Dependencies
- Authentication provider setup
- User database schema
- Security and session management
