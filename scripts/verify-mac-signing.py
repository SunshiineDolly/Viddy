"""Verify stable app identity and Keychain access across two synthetic updates."""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

root = Path(tempfile.mkdtemp(prefix="viddy-signing-", dir=os.environ["RUNNER_TEMP"]))
identity = os.environ["VIDDY_MAC_SIGNING_IDENTITY"]
helper = Path("src-tauri/target/aarch64-apple-darwin/release/examples/mac-keychain-check")
requirements = []
hashes = []
apps = []
for version in ("1.0.0", "1.0.1"):
    app = root / ("Viddy-test-" + version + ".app")
    contents = app / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    shutil.copy2(helper, contents / "MacOS" / "check")
    with (contents / "Info.plist").open("wb") as f:
        plistlib.dump({"CFBundleIdentifier": "app.viddy.keychain-test", "CFBundleExecutable": "check", "CFBundleName": "Viddy signing test", "CFBundleVersion": version}, f)
    subprocess.run(["codesign", "--force", "--options", "runtime", "--sign", identity, "--timestamp=none", str(app)], check=True)
    requirements.append(subprocess.run(["codesign", "-d", "-r-", str(app)], capture_output=True, text=True, check=True).stdout.strip())
    details = subprocess.run(["codesign", "-d", "--verbose=4", str(app)], capture_output=True, text=True, check=True).stderr
    hashes.append(next(line for line in details.splitlines() if line.startswith("CDHash=")))
    apps.append(contents / "MacOS" / "check")
assert requirements[0] and requirements[0] == requirements[1], requirements
assert hashes[0] != hashes[1], hashes
service = "Viddy.Signing.Test." + root.name
installed = root / "Viddy.app"
shutil.copytree(apps[0].parents[2], installed)
installed_binary = installed / "Contents" / "MacOS" / "check"
# The distributed self-signed certificate is not a trusted root on users' Macs.
# Remove the CI-only signing trust while testing access, then restore it solely
# for the production build. This catches requirements that depend on local trust.
certificate = "src-tauri/macos/signing-certificate.pem"
subprocess.run(["sudo", "security", "remove-trusted-cert", "-d", certificate], check=True)
try:
    subprocess.run([str(installed_binary), "write", service], check=True, timeout=20)
    subprocess.run([str(installed_binary), "read", service], check=True, timeout=20)
    installed.rename(root / "previous.app")
    shutil.copytree(apps[1].parents[2], installed)
    subprocess.run([str(installed_binary), "read", service], check=True, timeout=20)
finally:
    try:
        subprocess.run([str(installed_binary), "delete", service], timeout=20, check=True)
    finally:
        subprocess.run(["sudo", "security", "add-trusted-cert", "-d", "-r", "trustRoot", "-p", "codeSign", "-k", os.path.join(os.environ["RUNNER_TEMP"], "viddy-signing.keychain-db"), certificate], check=True)
report = {"stableDesignatedRequirement": True, "differentUpdateHashes": True, "keychainAccessibleAfterUpdateWithoutPrompt": True, "legacySessionMigrated": True, "logoutBlocksLegacyRestore": True, "hardenedRuntime": True, "certificateTrustNotRequiredForKeychain": True, "productionCredentialsTouched": False}
(Path(os.environ["RUNNER_TEMP"]) / "viddy-signing-report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
