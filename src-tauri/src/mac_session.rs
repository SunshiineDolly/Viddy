// The old entry was created by ad-hoc signed releases. Create a fresh ACL under
// the stable identity after the system authorizes reading that legacy entry.
const CURRENT: &str = "Viddy.DiscordSession.v2";
const LEGACY: &str = "Viddy.DiscordSession.v1";

fn entry(service: &str, scope: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(service, scope)
}
fn value(entry: &keyring::Entry) -> keyring::Result<Option<String>> {
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error),
    }
}
fn restore<E>(current: Option<String>, legacy: impl FnOnce() -> Result<Option<String>, E>, save: impl FnOnce(&str) -> Result<(), E>) -> Result<Option<String>, E> {
    match current {
        Some(value) => Ok((!value.is_empty()).then_some(value)),
        None => {
            let old = legacy()?;
            if let Some(ref value) = old { save(value)?; }
            Ok(old)
        }
    }
}
pub fn read(scope: &str) -> keyring::Result<Option<String>> {
    let current = entry(CURRENT, scope)?;
    restore(value(&current)?, || value(&entry(LEGACY, scope)?), |raw| current.set_password(raw))
}
pub fn save(scope: &str, raw: &str) -> keyring::Result<()> {
    entry(CURRENT, scope)?.set_password(raw)
}
pub fn clear(scope: &str) -> keyring::Result<()> {
    // A protected tombstone prevents an old v1 entry from restoring a logged-out
    // account, including after reinstalling the app or restoring a local backup.
    save(scope, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migrates_once_and_does_not_read_legacy_when_the_new_entry_exists() {
        let saved=std::cell::RefCell::new(String::new());
        let result: Result<_,()> = restore(None, || Ok(Some("synthetic-session".into())), |raw| { *saved.borrow_mut()=raw.into();Ok(()) });
        assert_eq!(result.unwrap().as_deref(),Some("synthetic-session"));
        assert_eq!(&*saved.borrow(),"synthetic-session");
        let result: Result<_,()> = restore(Some(saved.into_inner()), || panic!("legacy entry must not be queried"), |_| panic!("not a migration"));
        assert_eq!(result.unwrap().as_deref(),Some("synthetic-session"));
    }
    #[test]
    fn logout_tombstone_blocks_legacy_session_resurrection() {
        let result: Result<_,()> = restore(Some(String::new()), || panic!("logged-out legacy session was accessed"), |_| panic!("not a migration"));
        assert_eq!(result.unwrap(),None);
    }
}
