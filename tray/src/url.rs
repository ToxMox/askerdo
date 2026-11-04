/* The three URLs the server hands the exe, and nothing wider.
 *
 * They are always the loopback form the protocol pins,
 * http://127.0.0.1:<port>/<secret>/..., so this is a splitter rather than a
 * URL library: scheme http only (no TLS anywhere on this wire), no userinfo,
 * no fragment. Anything else is a parse failure, which the argument check
 * turns into exit 2 before a window is ever created.
 */
#[derive(Clone, Debug)]
pub struct Url {
    pub host: String,
    pub port: u16,
    /* the request target, always starting with a slash */
    pub path: String,
}

impl Url {
    pub fn authority(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

pub fn parse(raw: &str) -> Option<Url> {
    let rest = raw.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, "/"),
    };
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok()?),
        None => (authority, 80u16),
    };
    if host.is_empty() {
        return None;
    }
    Some(Url { host: host.to_string(), port, path: path.to_string() })
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn splits_the_loopback_form() {
        let u = parse("http://127.0.0.1:17435/abc123/api/events").unwrap();
        assert_eq!(u.host, "127.0.0.1");
        assert_eq!(u.port, 17435);
        assert_eq!(u.path, "/abc123/api/events");
    }

    #[test]
    fn a_bare_root_still_has_a_path() {
        assert_eq!(parse("http://127.0.0.1:80").unwrap().path, "/");
    }

    #[test]
    fn refuses_what_this_wire_never_carries() {
        assert!(parse("https://127.0.0.1:17435/x").is_none());
        assert!(parse("http://").is_none());
        assert!(parse("http://127.0.0.1:notaport/x").is_none());
        assert!(parse("ws://127.0.0.1:1/x").is_none());
    }
}
