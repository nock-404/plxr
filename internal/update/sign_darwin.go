//go:build darwin

package update

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// zertName ist die Identität, mit der plxr sich auf dieser Maschine ausweist.
const zertName = "plxr Code Signing"

// nachbereiten signiert das ausgetauschte Bündel mit einer gleichbleibenden
// lokalen Identität.
//
// Ohne das trägt die App nur eine Ad-hoc-Signatur, und ihr Ausweis gegenüber
// macOS ist der Code-Hash — der sich bei jedem Bau ändert. Folge: nach jedem
// Update fragt das System die Berechtigungen erneut ab, als wäre es ein
// fremdes Programm. Mit einem festen Zertifikat lautet der Ausweis
// "identifier + certificate leaf" und bleibt über alle Fassungen gleich.
//
// Das Zertifikat ist selbst ausgestellt und liegt nur im Schlüsselbund dieses
// Nutzers. Es macht die App nicht vertrauenswürdiger — es macht sie nur
// wiedererkennbar.
func nachbereiten(ort string) error {
	if !strings.HasSuffix(ort, ".app") {
		return nil // nur Bündel tragen eine Signatur
	}
	if err := zertifikatSicherstellen(); err != nil {
		return err
	}
	// Ohne das hält Gatekeeper die Datei für heruntergeladen und blockiert.
	exec.Command("xattr", "-dr", "com.apple.quarantine", ort).Run()

	return exec.Command("codesign", "--force", "--deep",
		"--sign", zertName, "--identifier", "dev.plxr.app", ort).Run()
}

func zertifikatSicherstellen() error {
	out, err := exec.Command("security", "find-identity", "-p", "codesigning").Output()
	if err == nil && strings.Contains(string(out), zertName) {
		return nil
	}

	tmp, err := os.MkdirTemp("", "plxr-zert-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)

	cnf := filepath.Join(tmp, "ext.cnf")
	os.WriteFile(cnf, []byte(`[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = `+zertName+`
[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
`), 0o600)

	key := filepath.Join(tmp, "key.pem")
	crt := filepath.Join(tmp, "cert.pem")
	if err := exec.Command("openssl", "req", "-x509", "-newkey", "rsa:2048",
		"-keyout", key, "-out", crt, "-days", "7300", "-nodes", "-config", cnf).Run(); err != nil {
		return err
	}

	p12 := filepath.Join(tmp, "id.p12")
	// macOS liest die neueren Voreinstellungen von openssl nicht.
	if err := exec.Command("openssl", "pkcs12", "-export",
		"-inkey", key, "-in", crt, "-out", p12,
		"-passout", "pass:plxr", "-name", zertName,
		"-macalg", "sha1", "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES").Run(); err != nil {
		return err
	}

	home, _ := os.UserHomeDir()
	return exec.Command("security", "import", p12,
		"-k", filepath.Join(home, "Library", "Keychains", "login.keychain-db"),
		"-P", "plxr", "-T", "/usr/bin/codesign").Run()
}
