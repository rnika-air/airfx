# Security

Please report security problems privately: open a **private vulnerability report** on this repository (Security › Report a vulnerability), not a public issue. Include the steps to reproduce, and what an attacker could reach.

How AirFx protects accounts and data:

- **Isolation:** every table and file is protected by row-level security. A user can only read and change their own rows and their own storage folder. The tests are in `supabase/tests/`.
- **Browser key:** the browser only has Supabase's public anon key. The service-role key is never in the app or this repository.
- **Media stays on the device:** media is processed in the browser. Only what a user chooses to save to their account is uploaded, and it is stored privately.
- **Error reports:** they contain no media or project content, and cannot be read through the public API.
