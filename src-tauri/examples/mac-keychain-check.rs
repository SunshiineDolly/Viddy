#[cfg(target_os = "macos")]
#[path = "../src/mac_session.rs"]
mod mac_session;

#[cfg(target_os = "macos")]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let scope=&args[2];
    assert!(scope.starts_with("Viddy.Signing.Test."));
    let legacy=keyring::Entry::new("Viddy.DiscordSession.v1",scope).unwrap();
    match args[1].as_str() {
        "write" => {
            legacy.set_password("synthetic-signing-check-only").unwrap();
            assert_eq!(mac_session::read(scope).unwrap().as_deref(),Some("synthetic-signing-check-only"));
            legacy.set_password("legacy-must-not-be-read-again").unwrap();
        },
        "read" => assert_eq!(mac_session::read(scope).unwrap().as_deref(),Some("synthetic-signing-check-only")),
        "delete" => {
            mac_session::clear(scope).unwrap();
            assert_eq!(mac_session::read(scope).unwrap(),None);
            legacy.delete_credential().unwrap();
            keyring::Entry::new("Viddy.DiscordSession.v2",scope).unwrap().delete_credential().unwrap();
        },
        _ => panic!("unknown isolated test action"),
    }
    println!("Isolated Keychain migration and update check passed.");
}
#[cfg(not(target_os = "macos"))]
fn main() { panic!("This check requires macOS Keychain"); }
