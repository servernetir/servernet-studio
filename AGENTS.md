# ServerNet Studio

- Read `SERVERNET.md` and `servernet/ARCHITECTURE.md` before changing integration code.
- Preserve upstream license and copyright notices. Studio changes are AGPL-3.0-only.
- Keep ServerNet billing, wallet settlement and provider credentials in `servernetir/server`; this repository consumes its customer-scoped API.
- Never commit real keys, customer messages, datasets, production logs, cookies or `.env` files.
- Use independent request idempotency keys; do not use a thread ID for multiple completion bodies. Unknown billable outcomes must be reconciled before retrying.
- Do not invent wallet/SSO endpoints or advertise modality/tool capabilities without a verified contract.
- Work from `develop` after the new GitHub repository exists; keep `upstream` pointing to Unsloth. No force-push or overwriting concurrent work.
- Run `python -m pytest -c servernet/pytest.ini servernet/tests -q` for connector changes. Mock all outbound model calls. Run the relevant frontend checks for UI changes.
- Distinguish local code, GitHub publication, installation and live acceptance. Production installs and paid tests are separate operations.
