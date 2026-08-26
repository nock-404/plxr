#!/bin/bash
# Signiert die App mit einer gleichbleibenden Identität.
#
# Wails signiert selbst nur ad-hoc. Dabei ändert sich der Code-Hash bei jedem
# Build, macOS hält die App für eine neue und fragt die Berechtigungen erneut
# ab — bei jedem Start aufs Neue. Mit einem festen selbstsignierten Zertifikat
# und stabiler Bundle-ID merkt sich das System die Entscheidung.
set -e
CERT="plxr Code Signing"
APP="${1:-build/bin/plxr.app}"

if ! security find-identity -p codesigning | grep -q "$CERT"; then
	TMP=$(mktemp -d)
	cat > "$TMP/ext.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = $CERT
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
	openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
		-days 7300 -nodes -config "$TMP/ext.cnf" >/dev/null 2>&1
	# macOS kann die neueren pkcs12-Voreinstellungen von openssl nicht lesen
	openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/id.p12" \
		-passout pass:plxrtmp -name "$CERT" \
		-macalg sha1 -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES >/dev/null 2>&1
	security import "$TMP/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" \
		-P plxrtmp -T /usr/bin/codesign >/dev/null
	rm -rf "$TMP"
	echo "  selbstsigniertes Zertifikat angelegt"
fi

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
codesign --force --deep --sign "$CERT" --identifier dev.plxr.app "$APP"
echo "  signiert als dev.plxr.app"
