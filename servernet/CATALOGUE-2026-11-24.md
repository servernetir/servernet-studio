# Shared model catalogue — 24 November 2026

The Gateway catalogue now combines eligible OpenRouter and DeepInfra routes by exact identity and landed cost. Studio continues to consume the customer-scoped `/v1/models?studio=1` response; provider credentials, pricing policy and settlement remain in `servernetir/server`.

Both the hosted proxy and frontend previously filtered out embedding and rerank entries. The model hub now retains them, shows their input-only price and correct API endpoint, and keeps their use through the API. It does not enable chat/media generation for these operations or grant new token scopes. Search and the localized model-type filter work together, and names sort alphabetically with numeric ordering. Distinct Gateway IDs are preserved even when labels match.

Validation: 129 Python tests with fake upstream services; five Node tests including rendered catalogue checks in Persian, English and Turkish; TypeScript/Vite production build. The companion Gateway change passes 32 relevant tests / 206 assertions. No paid inference, new live key, wallet adjustment or provider funding is involved.

The owner-entered OpenRouter key passed the official zero-inference access check. The live Gateway calculation at verification exposed 476 eligible entries, including 50 embeddings and five rerank models. These counts are a dated snapshot, not hardcoded Studio configuration. The public Studio sign-in page was observed; authenticated customer UI acceptance requires an existing authorized session.

Deployment must use the reviewed pinned commits, a built frontend artifact, before/after hashes and private backups. Install new hashed assets before the HTML entrypoint, preserve old assets, and restart only the registered Studio Passenger app. Keep legal notices and update its corresponding-source link to the installed Studio commit. No migration, dependency change, credential rotation or customer data write is needed.

The initial delivery stopped before publication because automatic approval review required explicit authorization. The owner subsequently approved publication to develop in both repositories and installation on the main site. The code/build and local commits are ready; installation is recorded independently after execution. The existing registered Passenger target and its baseline hosted proxy hash were verified. Authenticated UI acceptance remains separate from the mocked/rendered tests.
