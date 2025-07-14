# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |

## Reporting a Vulnerability

The Timeline Theories team takes security bugs seriously. We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please create a GitHub Security Advisory or contact the maintainers through GitHub issues marked as security-related.

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information in your report:

- Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

### Preferred Languages

We prefer all communications to be in English.

## Security Considerations

### Authentication & Authorization
- Timeline Theories uses OIDC (OpenID Connect) for secure authentication
- All user data is protected by role-based access controls
- Session management follows industry best practices

### Data Protection
- Sensitive configuration is managed through environment variables
- API keys and secrets are never committed to the repository
- All external API communications use HTTPS

### Third-Party Dependencies
- Dependencies are regularly updated to address security vulnerabilities
- We use tools like npm audit to monitor for known vulnerabilities
- Critical dependencies are carefully vetted before inclusion

### Infrastructure Security
- SenseNet ECM provides enterprise-grade security features
- Netlify Functions provide serverless security isolation
- All deployments use secure HTTPS connections

## Security Best Practices for Contributors

When contributing to Timeline Theories, please follow these security guidelines:

1. **Never commit secrets**: Use environment variables for API keys, passwords, and other sensitive data
2. **Validate input**: Always validate and sanitize user input
3. **Follow least privilege**: Only request the minimum permissions necessary
4. **Use secure defaults**: Default configurations should be secure
5. **Handle errors safely**: Don't expose sensitive information in error messages

## Security Updates

Security updates will be communicated through:
- GitHub Security Advisories
- Release notes for patches
- Project documentation updates

Thank you for helping keep Timeline Theories and our users safe!
