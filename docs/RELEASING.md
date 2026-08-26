# Releasing TriRegex

This checklist is a local gate for an owner-authorized release. It does not
claim that any publication has occurred.

## Local gate

1. Start from a clean working tree and confirm the intended branch and commit.
2. Install the locked dependencies with `npm ci`.
3. Run `npm test`, including the release-document contract.
4. Review the version in `package.json`, the exported `VERSION`, and the
   applicable `CHANGELOG.md` entry together.
5. Confirm that release notes describe only the changes actually included.

## Owner-controlled publication

Creating a tag, publishing to npm, and creating a GitHub release are
owner-controlled actions. Do not perform any of them from this checklist
without the owner's explicit authorization and release credentials.

## Post-publication verification

After an owner performs publication, verify the intended tag, published package
version, release notes, and package contents through the relevant public
surfaces. Record any mismatch as a release incident and avoid treating local
success as proof of registry or GitHub state.
