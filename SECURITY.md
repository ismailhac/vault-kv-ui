# Security Policy

## Scope

Vault KV UI is a **local development tool** intended for use on single-user machines or in trusted environments. It runs a BFF server on localhost and opens a browser to interact with your Vault instance.

The application is designed for:
- Local secret browsing and management
- Development and testing environments
- Single-user workstations with network access to Vault

## Security Considerations

### Authentication

- **OIDC flows** are completed in your browser directly with your Vault instance. The BFF acts only as a callback server.
- Tokens are stored in-memory and persisted only to `~/.vault-kv-ui/` (user-readable files).
- Pre-set tokens via `VAULT_TOKEN` environment variable or `~/.env` file are read on startup.

### API Authorization

- Admin endpoints (`/api/admin/logs`, `/api/auth/logout`) require a valid Vault token.
- Secret read/write operations respect your Vault ACL policies.
- All audit logs record the namespace and token display name of the actor.

### Audit Logging

- All write, delete, and login events are logged to `~/.vault-kv-ui/audit-logs.json`.
- Logs include secret paths and key names, but not their values (for bulk operations).
- Full before/after values are recorded for individual secret edits and are persisted in the audit log.
- Restore functionality allows rolling back any write or deletion.

### Limitations

- **Localhost binding only** — the BFF binds to `127.0.0.1:3001` and is not accessible from other machines.
- **Single-user session** — there is no per-user authentication within the app; whoever runs it has full access to all configured namespaces.
- **Unencrypted storage** — config and logs are stored in plain-text JSON in `~/.vault-kv-ui/`.
- **No rate limiting** — no throttling on API requests to Vault.

## Reporting Security Issues

If you discover a security vulnerability, please email **imil.dev01@gmail.com** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

Do **not** open a public GitHub issue for security vulnerabilities.

## Future Hardening

Potential improvements for future versions:
- Encrypted audit log storage
- Per-request CSRF tokens
- Vault token TTL enforcement and auto-refresh
- Request rate limiting
