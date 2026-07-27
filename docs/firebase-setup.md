# Firebase setup

## Current blocker

No accessible Firebase/GCP project had an ID or display name unambiguously tied
to Luke’s Picks. No project was selected and no cloud resource was modified.
The repository uses `demo-lukes-picks-local` only for emulators.

## Authorized project checklist

1. The owner creates or explicitly identifies the intended project.
2. Verify the project name/ID and inspect existing Firestore data, Functions,
   Hosting sites, Auth providers, secrets, APIs, and billing before modification.
3. Use the existing Firestore location; never attempt relocation.
4. Create/verify web, Android `com.mleikam.lukespics`, and iOS
   `com.mleikam.lukespics` app registrations.
5. Run `flutterfire configure` and review generated changes.
6. Enable Google Auth and verify authorized Hosting domains.
7. Add available Android debug/release SHA-1 and SHA-256 fingerprints without
   replacing signing material.
8. Configure iOS reversed client ID/URL scheme.
9. Set server secrets by name; never paste values into repo files.
10. Confirm an already-authorized billing plan before deploying Functions that
    require it. Never add a payment method from this workflow.

## App Check staged rollout

- Web: supported reCAPTCHA Enterprise provider
- Android: Play Integrity; debug provider locally
- iOS: App Attest with supported fallback; debug provider locally

First deploy code that sends tokens, observe valid requests on all platforms,
then enable enforcement for callable Functions and Firestore. Hard enforcement
is a console-only/manual release gate.

## Emulator ports

Ports are declared in `firebase.json`. Use the Auth, Firestore, Functions, and
Hosting emulators together so integration tests exercise the same boundaries as
production.
