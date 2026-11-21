fn main() {
    let args: Vec<String> = std::env::args().collect();
    let entry = keyring::Entry::new(&args[2], "synthetic-update-check").unwrap();
    match args[1].as_str() {
        "write" => {
            entry.set_password("synthetic-signing-check-only").unwrap();
            assert_eq!(entry.get_password().unwrap(), "synthetic-signing-check-only");
        },
        "read" => assert_eq!(entry.get_password().unwrap(), "synthetic-signing-check-only"),
        "delete" => entry.delete_credential().unwrap(),
        _ => panic!("unknown isolated test action"),
    }
    println!("Isolated Keychain check passed.");
}
